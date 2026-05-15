export const FAQS = [
  {
    q: "What platforms are supported?",
    a: "macOS 11 Big Sur+, Windows 10 (build 1809+) with WebView2, and Linux (Debian 12 / Ubuntu 22.04+ — needs glib-2.0 ≥ 2.70 and WebKitGTK 6).",
  },
  {
    q: "Do I need an AI key?",
    a: "No — sign in and you get 200 AnySpace Cloud AI calls and 30 minutes of speech-to-text every month, free. Past that, upgrade to Pro for unlimited cloud, or paste your own OpenAI / Anthropic / Groq / Ollama key — bring-your-own-key usage is always unlimited and free. The terminal, editor, preview, Kanban, and Team mode work without any keys at all.",
  },
  {
    q: "Where is my data stored?",
    a: "Locally. Tasks, agents, settings, and saved layouts live in a SQLite file in your OS app-data directory. We don't ship telemetry by default. Outbound calls go only to the AI/STT endpoints you configure, optionally through your HTTP/SOCKS5 proxy.",
  },
  {
    q: "Can I use AnySpace without paying?",
    a: "Yes. Every local feature works forever on Free — terminal, editor, live preview, Kanban, multi-agent Team mode, Super Agent, SSH, the whole app. Pro only removes the meter on hosted AnySpace Cloud; bring-your-own-key usage of those same features is free.",
  },
  {
    q: "How does cancellation work?",
    a: "Cancel anytime from the desktop app: Settings → Subscription → Manage subscription opens the Stripe Billing Portal. You keep Pro through the end of your current billing period. Need a refund? Email hi@anyspace.dev within 30 days of the charge. Full details in /docs/billing/cancel-and-refund.",
  },
  {
    q: "Is the source available?",
    a: "The desktop app is open-source on GitHub. The cloud backend (license, billing, hosted AI/STT) is closed-source. You can self-build the desktop app from source — but anything routed through AnySpace Cloud requires sign-in.",
  },
];
