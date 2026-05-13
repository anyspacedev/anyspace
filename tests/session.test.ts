import { describe, expect, it, beforeEach, vi } from "vitest";

import { ensureBackgroundSession } from "../src/lib/backgroundWatcher/session";
import { useSuperAgentStore } from "../src/stores/superAgentStore";
import { useSuperAgentSettingsStore } from "../src/stores/superAgentSettingsStore";

let createSessionCallCount = 0;

beforeEach(() => {
  createSessionCallCount = 0;
  useSuperAgentSettingsStore.setState({
    settings: {
      ...useSuperAgentSettingsStore.getState().settings,
      backgroundSessionId: undefined,
    },
    loaded: true,
  } as Parameters<typeof useSuperAgentSettingsStore.setState>[0]);
  useSuperAgentStore.setState({
    sessions: [],
    activeSessionId: null,
    messagesBySession: {},
    panelOpen: false,
    pauseToolCalls: false,
    activeStreamId: null,
    loaded: true,
    createSession: vi.fn(async (name?: string) => {
      createSessionCallCount++;
      const id = `bg-${createSessionCallCount}`;
      const session = {
        id,
        name: name ?? "x",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSuperAgentStore.setState((s) => ({
        sessions: [session, ...s.sessions],
      }));
      return session;
    }),
  } as Parameters<typeof useSuperAgentStore.setState>[0]);
});

describe("ensureBackgroundSession", () => {
  it("creates a new session on first call and stamps the settings id", async () => {
    const id = await ensureBackgroundSession();
    expect(id).toBe("bg-1");
    expect(createSessionCallCount).toBe(1);
    expect(
      useSuperAgentSettingsStore.getState().settings.backgroundSessionId,
    ).toBe("bg-1");
    expect(
      useSuperAgentStore.getState().sessions.find((s) => s.id === "bg-1")?.name,
    ).toBe("Background Watcher");
  });

  it("reuses the existing session on subsequent calls", async () => {
    const id1 = await ensureBackgroundSession();
    const id2 = await ensureBackgroundSession();
    expect(id1).toBe(id2);
    expect(createSessionCallCount).toBe(1);
  });

  it("is race-safe — concurrent callers share the same in-flight promise", async () => {
    const [a, b, c] = await Promise.all([
      ensureBackgroundSession(),
      ensureBackgroundSession(),
      ensureBackgroundSession(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(createSessionCallCount).toBe(1);
  });

  it("re-creates the session if the stored id no longer exists", async () => {
    useSuperAgentSettingsStore.setState({
      settings: {
        ...useSuperAgentSettingsStore.getState().settings,
        backgroundSessionId: "stale-id",
      },
    } as Parameters<typeof useSuperAgentSettingsStore.setState>[0]);
    // sessions array is empty, so "stale-id" won't be found.
    const id = await ensureBackgroundSession();
    expect(id).toBe("bg-1");
    expect(createSessionCallCount).toBe(1);
  });

  it("adopts an existing 'Background Watcher' session by name (legacy install)", async () => {
    useSuperAgentStore.setState({
      sessions: [
        {
          id: "legacy-session-id",
          name: "Background Watcher",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as Parameters<typeof useSuperAgentStore.setState>[0]);
    const id = await ensureBackgroundSession();
    expect(id).toBe("legacy-session-id");
    expect(createSessionCallCount).toBe(0);
    expect(
      useSuperAgentSettingsStore.getState().settings.backgroundSessionId,
    ).toBe("legacy-session-id");
  });
});
