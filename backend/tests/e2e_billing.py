"""End-to-end billing flow against a real uvicorn server.

Boots the actual ASGI app on a loopback port with a throwaway SQLite DB and
drives it over real HTTP (routing, CORS, DB writes, signature short-circuit
all exercised for real). The two *external* services we can't reach from a
test box — Clerk and Stripe — are stubbed at their SDK boundary:

  * `verify_clerk_jwt` → canned claims (no live Clerk round-trip)
  * the `stripe.*` SDK calls → fakes (no Stripe account needed)

Everything in between — `services/stripe_billing.py`, the routers, the
`subscriptions` table, `/v1/license` — runs unmodified.

Run:  uv run python tests/e2e_billing.py
Exits 0 on success, 1 on the first failed assertion.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

# --- env must be set before importing the app (settings is lru_cached) -------
_DB = Path("/tmp/anyspace-e2e-billing.db")
for suffix in ("", "-wal", "-shm"):
    p = Path(str(_DB) + suffix)
    if p.exists():
        p.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_DB}"
os.environ["LOG_LEVEL"] = "warning"
os.environ["CLERK_FRONTEND_API"] = "https://e2e.clerk.example"
os.environ["STRIPE_SECRET_KEY"] = "sk_test_e2e"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_e2e"
os.environ["STRIPE_PRICE_ID_MONTHLY"] = "price_monthly_e2e"
os.environ["STRIPE_PRICE_ID_ANNUAL"] = "price_annual_e2e"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
import stripe  # noqa: E402
import uvicorn  # noqa: E402

from app import deps as deps_module  # noqa: E402
from app import main as main_module  # noqa: E402
from app.services import clerk as clerk_module  # noqa: E402

PORT = 9133
BASE = f"http://127.0.0.1:{PORT}"
PERIOD_END_TS = 1900000000  # far-future unix ts

_failures: list[str] = []


def check(label: str, cond: bool, extra: str = "") -> None:
    mark = "ok  " if cond else "FAIL"
    print(f"  [{mark}] {label}{(' — ' + extra) if extra else ''}")
    if not cond:
        _failures.append(label)


# --- stub the two external services -----------------------------------------

_CLAIMS = {"sub": "user_e2e_billing", "email": "e2e@example.com"}
deps_module.verify_clerk_jwt = lambda _token: dict(_CLAIMS)  # type: ignore[assignment]
clerk_module.verify_clerk_jwt = lambda _token: dict(_CLAIMS)  # type: ignore[assignment]

# Skip the sherpa-onnx model load — irrelevant to billing, and slow.
main_module.build_recognizer = object  # type: ignore[assignment]

# Fake the Stripe SDK surface that services/stripe_billing.py touches. The
# service module itself (customer dedup, the subscription upsert, price→plan
# mapping) runs for real against the test DB.
_stripe_state = {"customers": 0}


def _fake_customer_create(**kwargs):
    _stripe_state["customers"] += 1
    return {"id": "cus_e2e_1", "metadata": kwargs.get("metadata", {})}


def _fake_checkout_create(**kwargs):
    return {"url": "https://checkout.stripe.test/cs_e2e_1", "id": "cs_e2e_1"}


def _fake_portal_create(**kwargs):
    return {"url": "https://billing.stripe.test/bps_e2e_1"}


_SUB_OBJECT = {
    "id": "sub_e2e_1",
    "customer": "cus_e2e_1",
    "status": "active",
    "cancel_at_period_end": False,
    "items": {
        "data": [
            {
                "price": {"id": "price_monthly_e2e"},
                "current_period_end": PERIOD_END_TS,
            },
        ],
    },
}

stripe.Customer.create = staticmethod(_fake_customer_create)  # type: ignore[assignment]
stripe.checkout.Session.create = staticmethod(_fake_checkout_create)  # type: ignore[assignment]
stripe.billing_portal.Session.create = staticmethod(_fake_portal_create)  # type: ignore[assignment]
stripe.Subscription.retrieve = staticmethod(lambda _id: dict(_SUB_OBJECT))  # type: ignore[assignment]
# Webhook signature verification can't work without a real Stripe-signed
# payload, so bypass it — the event body is what we'd have received.
_webhook_event = {"type": "", "data": {"object": {}}}
stripe.Webhook.construct_event = staticmethod(  # type: ignore[assignment]
    lambda payload, sig, secret: _webhook_event,
)


# --- migrations + server boot ------------------------------------------------


def _apply_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")


def _serve(server: uvicorn.Server) -> None:
    server.run()


def main() -> int:
    _apply_migrations()

    config = uvicorn.Config(
        main_module.app, host="127.0.0.1", port=PORT, log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=_serve, args=(server,), daemon=True)
    thread.start()

    # Wait for the server to come up.
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            if httpx.get(f"{BASE}/healthz", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.2)
    else:
        print("server did not start within 15s")
        return 1

    auth = {"Authorization": "Bearer e2e-token"}
    try:
        with httpx.Client(base_url=BASE, timeout=5) as c:
            print("\n1. health + auth gating")
            r = c.get("/healthz")
            check("GET /healthz → 200", r.status_code == 200)
            r = c.get("/v1/license")
            check("GET /v1/license without auth → 401", r.status_code == 401)
            r = c.post("/v1/billing/checkout")
            check("POST /v1/billing/checkout without auth → 401",
                  r.status_code == 401)

            print("\n2. user bootstrap + starts on Free")
            r = c.get("/v1/me", headers=auth)
            check("GET /v1/me → 200", r.status_code == 200, r.text)
            r = c.get("/v1/license", headers=auth)
            check("GET /v1/license → 200", r.status_code == 200)
            check("plan is 'free' before checkout",
                  r.json().get("plan") == "free", r.text)

            print("\n3. checkout creates a Stripe customer + subscriptions row")
            r = c.post("/v1/billing/checkout", headers=auth,
                       json={"interval": "monthly"})
            check("POST /v1/billing/checkout → 200", r.status_code == 200, r.text)
            check("checkout returns a Stripe URL",
                  r.json().get("url", "").startswith("https://checkout.stripe"),
                  r.text)
            check("exactly one Stripe customer was created",
                  _stripe_state["customers"] == 1)

            print("\n4. checkout is idempotent (reuses the customer)")
            r = c.post("/v1/billing/checkout", headers=auth)
            check("second checkout → 200", r.status_code == 200)
            check("no duplicate Stripe customer",
                  _stripe_state["customers"] == 1,
                  f'created={_stripe_state["customers"]}')

            print("\n5. annual interval rejected when no annual price... "
                  "(annual IS configured here, so it should pass)")
            r = c.post("/v1/billing/checkout", headers=auth,
                       json={"interval": "annual"})
            check("annual checkout → 200 (annual price configured)",
                  r.status_code == 200, r.text)
            r = c.post("/v1/billing/checkout", headers=auth,
                       json={"interval": "weekly"})
            check("unknown interval → 400", r.status_code == 400)

            print("\n6. webhook bad signature → 401")
            _stub_construct_raises()
            r = c.post("/v1/billing/webhook",
                       headers={"stripe-signature": "t=1,v1=bad"},
                       content=b"{}")
            check("bad-signature webhook → 401", r.status_code == 401, r.text)
            _stub_construct_ok()

            print("\n7. customer.subscription.created webhook → license flips to Pro")
            _webhook_event["type"] = "customer.subscription.created"
            _webhook_event["data"]["object"] = dict(_SUB_OBJECT)
            r = c.post("/v1/billing/webhook",
                       headers={"stripe-signature": "t=1,v1=ok"},
                       content=b"{}")
            check("subscription.created webhook → 200", r.status_code == 200, r.text)
            r = c.get("/v1/license", headers=auth)
            body = r.json()
            check("plan is 'pro' after webhook", body.get("plan") == "pro", r.text)
            check("license active", body.get("active") is True)
            check("status is 'active'", body.get("status") == "active")
            check("current_period_end populated",
                  body.get("current_period_end") is not None)

            print("\n8. portal session for the now-subscribed customer")
            r = c.post("/v1/billing/portal", headers=auth)
            check("POST /v1/billing/portal → 200", r.status_code == 200, r.text)
            check("portal returns a Stripe URL",
                  r.json().get("url", "").startswith("https://billing.stripe"))

            print("\n9. subscription.deleted webhook → license drops to Free")
            deleted = dict(_SUB_OBJECT)
            deleted["status"] = "canceled"
            _webhook_event["type"] = "customer.subscription.deleted"
            _webhook_event["data"]["object"] = deleted
            r = c.post("/v1/billing/webhook",
                       headers={"stripe-signature": "t=1,v1=ok"},
                       content=b"{}")
            check("subscription.deleted webhook → 200", r.status_code == 200)
            r = c.get("/v1/license", headers=auth)
            body = r.json()
            check("plan back to 'free' after cancel", body.get("plan") == "free",
                  r.text)
            check("status reflects 'canceled'", body.get("status") == "canceled")

            print("\n10. license/refresh matches license")
            got = c.get("/v1/license", headers=auth).json()
            refreshed = c.post("/v1/license/refresh", headers=auth).json()
            check("/v1/license/refresh == /v1/license", got == refreshed)
    finally:
        server.should_exit = True
        thread.join(timeout=5)

    print()
    if _failures:
        print(f"E2E FAILED — {len(_failures)} check(s) failed: {_failures}")
        return 1
    print("E2E PASSED — all checks green")
    return 0


def _stub_construct_raises() -> None:
    def _raise(payload, sig, secret):
        raise stripe.SignatureVerificationError("bad sig", sig)

    stripe.Webhook.construct_event = staticmethod(_raise)  # type: ignore[assignment]


def _stub_construct_ok() -> None:
    stripe.Webhook.construct_event = staticmethod(  # type: ignore[assignment]
        lambda payload, sig, secret: _webhook_event,
    )


if __name__ == "__main__":
    sys.exit(main())
