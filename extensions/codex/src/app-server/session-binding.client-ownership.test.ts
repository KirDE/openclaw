import { execFile } from "node:child_process";
// Exact physical-client ownership regressions for the Codex binding store.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resetPluginStateStoreForTests } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import { closeOpenClawStateDatabaseAsync } from "openclaw/plugin-sdk/sqlite-runtime-testing";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexAppServerBindingStore } from "./session-binding.js";
import { createCodexTestBindingStateStore } from "./session-binding.test-helpers.js";

const execFileAsync = promisify(execFile);

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
    try {
      // The shared SQLite writer is admitted by the host broker, not by a
      // Vitest worker thread. Run the real reopen path in a main-thread host.
      const fixture = fileURLToPath(
        new URL("./session-binding.client-ownership.sqlite.test-support.ts", import.meta.url),
      );
      const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", fixture], {
        env: { ...process.env, OPENCLAW_STATE_DIR: root },
        // Cold TSX imports the plugin runtime before exercising the host broker.
        timeout: 90_000,
      });
      expect(stdout.trim()).toBe("ok");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 100_000);
});
