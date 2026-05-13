import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";

export type AiSettings = {
  endpoint: string;
  apiKey: string;
  model: string;
  presetId: "anyspace-cloud" | "openai" | "groq" | "openrouter" | "custom";
  systemPrompt: string;
};

export const AI_DEFAULT_SYSTEM_PROMPT =
  "You are a terminal assistant. Explain the user's command and its output " +
  "concisely. If the command failed, suggest a likely fix. Keep replies short " +
  "and use plain text — no markdown formatting.";

/** Default model the cloud route maps onto its upstream LLM. Keep in sync with
 *  the backend model allow-list in `backend/app/services/llm.py`. */
export const ANYSPACE_CLOUD_DEFAULT_MODEL = "anyspace-default";

/** First-run defaults for fresh installs. Existing users keep their stored
 *  config — see `load()`. The endpoint is left empty here because AnySpace
 *  Cloud resolves it at call time from `VITE_ANYSPACE_CLOUD_URL`. */
const DEFAULT_SETTINGS: AiSettings = {
  endpoint: "",
  apiKey: "",
  model: ANYSPACE_CLOUD_DEFAULT_MODEL,
  presetId: "anyspace-cloud",
  systemPrompt: AI_DEFAULT_SYSTEM_PROMPT,
};

const SETTINGS_KEY = "ai";

type AiState = {
  settings: AiSettings;
  loaded: boolean;
  load: () => Promise<void>;
  updateSettings: (partial: Partial<AiSettings>) => Promise<void>;
};

export const useAiStore = create<AiState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<AiSettings>>(SETTINGS_KEY);
      if (stored) {
        set({ settings: { ...DEFAULT_SETTINGS, ...stored }, loaded: true });
        return;
      }
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  updateSettings: async (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort persistence */
    }
  },
}));
