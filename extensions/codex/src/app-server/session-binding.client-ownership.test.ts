// Exact physical-client ownership regressions for the Codex binding store.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetPluginStateStoreForTests } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import { closeOpenClawStateDatabaseAsync } from "openclaw/plugin-sdk/sqlite-runtime-testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_APP_SERVER_BINDING_MAX_ENTRIES,
  createCodexAppServerBindingStore,
} from "./session-binding.js";
import { createCodexSqliteTestBindingStateStore } from "./session-binding.sqlite.test-helpers.js";
import { createCodexTestBindingStateStore } from "./session-binding.test-helpers.js";

afterEach(async () => {
  await closeOpenClawStateDatabaseAsync();
  resetPluginStateStoreForTests();
});

describe("Codex app-server physical-client binding ownership", () => {
  it("clears only the exact physical client owner", async () => {
    const store = createCodexAppServerBindingStore(createCodexTestBindingStateStore());
    const identity = { kind: "session" as const, agentId: "main", sessionId: "session-clear-cas" };
    await store.mutate(identity, {
      kind: "set",
      binding: { threadId: "thread-shared", clientId: "client-new", cwd: "/repo" },
    });

    await expect(
      store.mutate(identity, {
        kind: "clear",
        threadId: "thread-shared",
        clientId: "client-old",
      }),
    ).resolves.toBe(false);
    expect(store.read(identity)).toMatchObject({
      threadId: "thread-shared",
      clientId: "client-new",
    });

    await expect(
      store.mutate(identity, {
        kind: "clear",
        threadId: "thread-shared",
        clientId: "client-new",
      }),
    ).resolves.toBe(true);
    expect(store.read(identity)).toBeUndefined();
  });

  it("persists exact-client cleanup ownership across a SQLite store reopen", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-binding-client-owner-"));
    const identity = {
      kind: "session" as const,
      agentId: "main",
      sessionId: "session-client-owner",
    };
    const openStore = () =>
      createCodexAppServerBindingStore(
        createCodexSqliteTestBindingStateStore({
          namespace: "client-owner-reopen",
          maxEntries: CODEX_APP_SERVER_BINDING_MAX_ENTRIES,
          overflowPolicy: "reject-new",
          env: { ...process.env, OPENCLAW_STATE_DIR: root },
        }),
      );
    try {
      const fresh = openStore();
      await fresh.mutate(identity, {
        kind: "set",
        binding: { threadId: "thread-shared", clientId: "client-new", cwd: "/repo" },
      });
      await expect(
        fresh.mutate(identity, {
          kind: "clear",
          threadId: "thread-shared",
          clientId: "client-old",
        }),
      ).resolves.toBe(false);
      expect(fresh.read(identity)).toMatchObject({ clientId: "client-new" });

      await closeOpenClawStateDatabaseAsync();
      resetPluginStateStoreForTests();
      const resumed = openStore();
      expect(resumed.read(identity)).toMatchObject({
        threadId: "thread-shared",
        clientId: "client-new",
      });
      await expect(
        resumed.mutate(identity, {
          kind: "clear",
          threadId: "thread-shared",
          clientId: "client-old",
        }),
      ).resolves.toBe(false);
      expect(resumed.read(identity)).toMatchObject({ clientId: "client-new" });
      await expect(
        resumed.mutate(identity, {
          kind: "clear",
          threadId: "thread-shared",
          clientId: "client-new",
        }),
      ).resolves.toBe(true);
      expect(resumed.read(identity)).toBeUndefined();
    } finally {
      await closeOpenClawStateDatabaseAsync();
      resetPluginStateStoreForTests();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
