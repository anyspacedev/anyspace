/**
 * Pi `AgentTool[]` registry — adapts the legacy Super Agent tool registry in
 * `../tools.ts` into the shape pi-agent-core expects. Phase 2 of the
 * pi-agent-framework refactor.
 *
 * Why adapt instead of port:
 *   pi-ai's `validateToolArguments` (utils/validation.js) explicitly accepts
 *   raw JSON-Schema objects when no TypeBox metadata is present, falling back
 *   to `coerceWithJsonSchema`. So our existing JSON-Schema `parameters` shape
 *   passes through unchanged. Handler logic stays in `tools.ts` until phase 6
 *   cleanup — only the surface gets rewrapped here.
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  ImageContent,
  TextContent,
  TSchema,
} from "@earendil-works/pi-ai";

import { TOOLS as legacyTools, type Tool as LegacyTool, type ToolHandlerResult } from "../tools";
import { humanLabel, pathToBase64 } from "./shared";

export type PiToolDetails = {
  /** Raw `resultText` from the legacy handler — preserved verbatim. */
  resultText: string;
  /** Legacy tool name for UI lookups. */
  name: string;
  /** Original file paths of any image attachments (UI may want to link them). */
  imagePaths?: { path: string; mediaType: string }[];
};

async function toAgentResult(
  name: string,
  legacy: ToolHandlerResult,
): Promise<AgentToolResult<PiToolDetails>> {
  const blocks: (TextContent | ImageContent)[] = [
    { type: "text", text: legacy.resultText },
  ];
  const imagePaths: { path: string; mediaType: string }[] = [];
  for (const img of legacy.images ?? []) {
    const data = await pathToBase64(img.path);
    if (data) {
      blocks.push({ type: "image", data, mimeType: img.mediaType });
      imagePaths.push({ path: img.path, mediaType: img.mediaType });
    }
  }
  return {
    content: blocks,
    details: {
      resultText: legacy.resultText,
      name,
      ...(imagePaths.length ? { imagePaths } : {}),
    },
  };
}

export function adaptTool(
  legacy: LegacyTool,
): AgentTool<TSchema, PiToolDetails> {
  return {
    name: legacy.name,
    label: humanLabel(legacy.name),
    description: legacy.description,
    parameters: legacy.parameters as TSchema,
    execute: async (_toolCallId, params) => {
      const args = (params ?? {}) as Record<string, unknown>;
      const result = await legacy.handler(args);
      return toAgentResult(legacy.name, result);
    },
  };
}

/** Full registry — every legacy tool wrapped as an `AgentTool`. */
export const piTools: AgentTool<TSchema, PiToolDetails>[] = legacyTools.map(adaptTool);

/**
 * Filter the registry by the user's per-tool enable map. A tool is enabled
 * unless its name maps to a literal `false` — matches the runner's existing
 * `isToolEnabled` semantics (`map[name] !== false`).
 */
export function filterEnabledTools(
  toolEnabled: Record<string, boolean | undefined>,
): AgentTool<TSchema, PiToolDetails>[] {
  return piTools.filter((t) => toolEnabled[t.name] !== false);
}
