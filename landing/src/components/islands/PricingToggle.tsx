import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PLANS } from "../../data/pricing";

type Period = "monthly" | "annual";

export default function PricingToggle() {
  const [period, setPeriod] = useState<Period>("monthly");

  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-pricing-period]").forEach((el) => {
      el.dataset.pricingPeriod = period;
    });
    PLANS.forEach((plan) => {
      const wrap = document.querySelector<HTMLElement>(`[data-plan="${plan.id}"]`);
      if (!wrap) return;
      const num = wrap.querySelector<HTMLElement>("[data-price-num]");
      const suffix = wrap.querySelector<HTMLElement>("[data-price-suffix]");
      if (num) num.textContent = period === "annual" ? plan.annual : plan.monthly;
      if (suffix) {
        const seat = plan.perSeat ? "/seat" : "";
        suffix.textContent = period === "annual" ? `${seat}/yr` : `${seat}/mo`;
      }
    });
  }, [period]);

  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="relative inline-flex items-center rounded-full border border-border bg-bg-elev p-1"
    >
      {(["monthly", "annual"] as const).map((p) => {
        const active = period === p;
        return (
          <button
            key={p}
            role="radio"
            aria-checked={active}
            onClick={() => setPeriod(p)}
            className={
              "relative z-10 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-fast " +
              (active ? "text-bg" : "text-fg-muted hover:text-fg")
            }
          >
            {active && (
              <motion.span
                layoutId="pricing-period-pill"
                className="absolute inset-0 -z-10 rounded-full bg-fg"
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span className="relative">
              {p === "annual" ? (
                <>Annual <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.12em]">−17%</span></>
              ) : (
                "Monthly"
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
