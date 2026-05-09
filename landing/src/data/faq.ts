export const FAQS = [
  {
    q: "What platforms are supported?",
    a: "macOS 11 Big Sur+, Windows 10 (build 1809+) with WebView2, and Linux (Debian 12 / Ubuntu 22.04+ — needs glib-2.0 ≥ 2.70 and WebKitGTK 6).",
  },
  {
    q: "Do I need to bring my own AI keys?",
    a: "Yes for AI features (Explain, Super Brain, agent dictation). AnySpace is OpenAI-compatible — point it at OpenAI, Anthropic, Groq, your local Ollama, or any /chat/completions endpoint. The terminal, editor, and preview work without any keys.",
  },
  {
    q: "Where is my data stored?",
    a: "Locally. Tasks, agents, settings, and saved layouts live in a SQLite file in your OS app-data directory. We don't ship telemetry by default. Outbound calls go only to the AI/STT endpoints you configure, optionally through your HTTP/SOCKS5 proxy.",
  },
  {
    q: "Can I use AnySpace without subscribing?",
    a: "Yes. The free tier works forever for solo projects up to 4 panes per workspace and 2 saved layouts. Upgrade only when you need agent orchestration, broadcast, or unlimited workspaces.",
  },
  {
    q: "How does the trial and refund work?",
    a: "Pro starts with 14 days free, no card required up front. After the trial, you'll be billed only if you continue. We offer a 30-day money-back guarantee — email us and we'll refund you, no questions.",
  },
  {
    q: "Is the source available?",
    a: "The frontend is open-source on GitHub. The Pro features (license server, billing, team sync) are closed-source. You can self-build the OSS core, but agent orchestration and broadcast require a Pro license.",
  },
];
