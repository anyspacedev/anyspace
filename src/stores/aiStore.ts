import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";
import { useSttStore } from "./sttStore";

export type AiSettings = {
  endpoint: string;
  apiKey: string;
  model: string;
  presetId: "openai" | "groq" | "openrouter" | "custom";
  systemPrompt: string;
};

const DEFAULT_SYSTEM_PROMPT =
  "You are a terminal assistant. Explain the user's command and its output " +
  "concisely. If the command failed, suggest a likely fix. Keep replies short " +
  "and use plain text — no markdown formatting.";

const DEFAULT_SETTINGS: AiSettings = {
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  presetId: "openai",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
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
      // First run: borrow the STT API key as a sensible default so the
      // user doesn't retype it. Wait for STT to finish loading so the
      // seed isn't an empty string from racing the parallel load.
      const stt = useSttStore.getState();
      if (!stt.loaded) await stt.load();
      const sttKey = useSttStore.getState().settings.apiKey;
      set({
        settings: { ...DEFAULT_SETTINGS, apiKey: sttKey },
        loaded: true,
      });
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
