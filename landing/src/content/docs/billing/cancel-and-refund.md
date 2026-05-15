---
title: Cancel or refund
description: How to cancel your AnySpace Pro subscription and how refunds work.
section: billing
order: 10
updated: 2026-05-15
---

AnySpace Pro is a month-to-month (or annual) subscription handled by Stripe. You can cancel anytime, and we'll refund a charge within 30 days, no questions asked.

## Cancel from inside the app

1. Open AnySpace.
2. **Settings → Subscription → Manage subscription**.

That opens the Stripe Billing Portal in your default browser. From there you can:

- Cancel at the end of the current period (you keep Pro until then).
- Switch between monthly and annual billing.
- Update your payment method.
- Download invoices.

When the cancellation takes effect, the Stripe webhook flips your local license back to Free automatically — your meter resumes counting against the 200 AI calls / 30 min STT free monthly allowance. Your local data is untouched.

## Request a refund

Email **[hi@anyspace.dev](mailto:hi@anyspace.dev)** within 30 days of the charge. Include the email address on your subscription so we can find you in Stripe quickly. We'll process the refund through Stripe and email back when it's done — usually the same day. Refunded charges show up in your bank a few business days later, depending on your card issuer.

## What happens to my data after cancelling

Nothing changes locally. Your tasks, agents, settings, layouts, and saved knowledge notes live in a SQLite file in your OS app-data directory — Pro and Free read from the same database.

What does change:

- **Hosted AnySpace Cloud calls** (AI Explain, Super Agent talking to our endpoint, Speech-to-text via our endpoint) resume metering against the Free monthly quota — 200 AI calls and 30 minutes of speech-to-text per calendar month, then a friendly 402 with an Upgrade button.
- **Bring-your-own-key** usage of the same features stays unlimited and free. If you've configured an OpenAI / Anthropic / Groq / Ollama key in *Settings → AI* or *Settings → Speech to text*, none of this affects you.

## Common questions

**Can I get my unused Pro time back?**
Cancellation in the Stripe portal is end-of-period by default — you keep using Pro until your billing date. If you want a prorated refund for the unused portion, email us; we'll handle it manually.

**My subscription says "canceled" but I still see "Pro" in AnySpace.**
A cancellation set to take effect at period-end keeps you on Pro until that date. The app will flip to Free automatically when the period ends and Stripe fires the `customer.subscription.deleted` webhook.

**Can I delete my AnySpace Cloud account?**
Yes — email us at [hi@anyspace.dev](mailto:hi@anyspace.dev). We'll delete your row from our users table; Clerk handles the auth-side removal. The local app keeps working with bring-your-own-key.
