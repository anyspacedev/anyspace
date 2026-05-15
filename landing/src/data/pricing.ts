export type Plan = {
  id: string;
  name: string;
  tagline: string;
  monthly: string;
  annual: string;
  perSeat?: boolean;
  annualNote?: string;
  cta: string;
  featured?: boolean;
  features: string[];
};

// Two plans, one boundary. Pro doesn't unlock features — it removes the meter
// on hosted AnySpace Cloud (STT + AI chat). Every local feature and BYO-API-key
// usage stays free forever. See `~/.claude/plans/business-strategy-pro-tier-and-quotas.md`
// + `backend/README.md#pricing-model` for the rationale.
export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "The whole desktop app, plus a taste of the cloud.",
    monthly: "0",
    annual: "0",
    cta: "Download free",
    features: [
      "Every local feature — unlimited",
      "Bring your own OpenAI / Anthropic / Groq / Ollama key — unlimited",
      "200 AnySpace Cloud AI calls / month",
      "30 min of AnySpace Cloud speech-to-text / month",
      "Multi-agent Team mode, Super Agent, Kanban, Live Preview",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Unmetered cloud for when AI joins your loop.",
    monthly: "9.90",
    annual: "99",
    annualNote: "$8.25/mo billed annually — 17% off",
    cta: "Upgrade to Pro",
    featured: true,
    features: [
      "Everything in Free",
      "Unlimited AnySpace Cloud AI calls",
      "Unlimited AnySpace Cloud speech-to-text",
      "No API keys to manage — sign in and go",
      "Priority support",
      "Cancel anytime via Stripe Billing Portal",
    ],
  },
];
