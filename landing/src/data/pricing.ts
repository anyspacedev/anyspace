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

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "For solo projects and casual use.",
    monthly: "0",
    annual: "0",
    cta: "Download free",
    features: [
      "Up to 4 panes per workspace",
      "2 saved layouts",
      "Warp-style command blocks",
      "Live preview pane",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For developers shipping with AI agents.",
    monthly: "12",
    annual: "120",
    annualNote: "$10/mo billed annually",
    cta: "Start 14-day free trial",
    featured: true,
    features: [
      "Unlimited panes & workspaces",
      "AI agent orchestration & Kanban",
      "Keystroke broadcast & Super Brain",
      "Speech-to-text dictation",
      "Element picker → agent context",
      "Priority support, BYO API keys",
    ],
  },
  {
    id: "team",
    name: "Team",
    tagline: "Shared agents & layouts for small teams.",
    monthly: "20",
    annual: "200",
    perSeat: true,
    annualNote: "$16.66/seat/mo billed annually",
    cta: "Contact sales",
    features: [
      "Everything in Pro, per seat",
      "Shared agent templates",
      "Workspace presets across the team",
      "SSO (Google, GitHub, Okta)",
      "Centralized billing",
      "Onboarding session",
    ],
  },
];
