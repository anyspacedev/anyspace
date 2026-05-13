// Test bootstrap: mock every @tauri-apps/* surface the app touches so the
// React stores + library modules can be exercised in plain happy-dom.
//
// Mocks are deliberately minimal — each test that exercises a specific
// Tauri command sets its own fake via vi.mocked(...).mockResolvedValueOnce.

import { vi } from "vitest";

// ----- @tauri-apps/api/core -----
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    // Default: pretend every command returns null. Tests override per-case.
    if (cmd === "settings_get") return null;
    if (cmd === "settings_set") return null;
    return null;
  }),
}));

// ----- @tauri-apps/api/event -----
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
  emit: vi.fn(async () => undefined),
}));

// ----- @tauri-apps/api/app -----
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.0.0-test"),
}));

// ----- @tauri-apps/plugin-sql -----
// Fake DB with an in-memory rows array per call. The store tests don't
// exercise the SQL surface deeply; they only need .execute and .select
// to not blow up.
class FakeDB {
  rows: Record<string, unknown>[] = [];
  async execute(_sql: string, _params?: unknown[]) {
    return { rowsAffected: 0, lastInsertId: 0 };
  }
  async select<T>(_sql: string, _params?: unknown[]): Promise<T> {
    return [] as unknown as T;
  }
}
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(async () => new FakeDB()),
  },
}));

// ----- @tauri-apps/plugin-fs -----
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async () => ""),
  writeTextFile: vi.fn(async () => undefined),
  exists: vi.fn(async () => false),
  mkdir: vi.fn(async () => undefined),
}));

// ----- @tauri-apps/plugin-clipboard-manager -----
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(async () => undefined),
  readText: vi.fn(async () => ""),
}));

// ----- @tauri-apps/plugin-dialog -----
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
  message: vi.fn(async () => undefined),
}));

// ----- @tauri-apps/plugin-os -----
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "linux"),
  type: vi.fn(() => "Linux"),
}));
