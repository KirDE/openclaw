// Run from a child host process: Vitest's thread pool cannot admit shared-state writes.
import assert from "node:assert/strict";
import { resetPluginStateStoreForTests } from "openclaw/plugin-sdk/plugin-state-test-runtime";
import { closeOpenClawStateDatabaseAsync } from "openclaw/plugin-sdk/sqlite-runtime-testing";
import {
  CODEX_APP_SERVER_BINDING_MAX_ENTRIES,
  createCodexAppServerBindingStore,
} from "./session-binding.js";
import { createCodexSqliteTestBindingStateStore } from "./session-binding.sqlite.test-helpers.js";

const root = process.env.OPENCLAW_STATE_DIR;
if (!root) {
  throw new Error("An isolated OPENCLAW_STATE_DIR is required");
}
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
  assert.equal(
    await fresh.mutate(identity, {
      kind: "clear",
      threadId: "thread-shared",
      clientId: "client-old",
    }),
    false,
  );
  assert.equal(fresh.read(identity)?.clientId, "client-new");

  await closeOpenClawStateDatabaseAsync();
  resetPluginStateStoreForTests();
  const resumed = openStore();
  assert.equal(resumed.read(identity)?.threadId, "thread-shared");
  assert.equal(resumed.read(identity)?.clientId, "client-new");
  assert.equal(
    await resumed.mutate(identity, {
      kind: "clear",
      threadId: "thread-shared",
      clientId: "client-old",
    }),
    false,
  );
  assert.equal(resumed.read(identity)?.clientId, "client-new");
  assert.equal(
    await resumed.mutate(identity, {
      kind: "clear",
      threadId: "thread-shared",
      clientId: "client-new",
    }),
    true,
  );
  assert.equal(resumed.read(identity), undefined);
  process.stdout.write("ok\n");
} finally {
  await closeOpenClawStateDatabaseAsync();
  resetPluginStateStoreForTests();
}
