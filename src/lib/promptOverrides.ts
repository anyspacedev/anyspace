/**
 * Tiny runtime helper used by every feature file that has a customizable
 * prompt. Lives in its own module (away from `prompts.ts`) so feature files
 * don't pull in the full registry — that would create an import cycle
 * because `prompts.ts` imports each feature file's `*_DEFAULT` constant.
 *
 * Callers pass their compiled-in default explicitly so we never have to
 * round-trip through the registry; that keeps this module's only dependency
 * the Zustand store.
 */

import { usePromptsStore } from "../stores/promptsStore";

export type PromptId =
  | "superBrain"
  | "aiSuggestSuperAgent"
  | "aiSuggestTemplateSetup"
  | "aiSuggestTeamDecompose"
  | "aiSuggestKanbanTask"
  | "superAgentAutoName"
  | "superAgentBackgroundSuffix"
  | "teamCommonRules"
  | "teamCoordinator"
  | "teamBuilder"
  | "teamScout"
  | "teamReviewer"
  | "teamCustom"
  | "operatorInboxHandoff"
  | "agentApiHint";

/** Sync read: live override if present, otherwise the caller-supplied default. */
export function getPrompt(id: PromptId, fallback: string): string {
  const override = usePromptsStore.getState().settings.overrides[id];
  return override !== undefined ? override : fallback;
}
