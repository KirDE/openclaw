import path from "node:path";
import type { HarnessContextEngine as ContextEngine } from "openclaw/plugin-sdk/agent-harness-runtime";
import { openFileBackedSessionManagerForTest } from "openclaw/plugin-sdk/agent-runtime-test-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  assistantMessage,
  setupRunAttemptTestHooks,
  tempDir,
  threadStartResult,
  userMessage,
} from "./run-attempt-test-harness.js";
import {
  createContextEngine,
  createParams,
  createStartedThreadHarness,
  makeThreadBootstrapBinding,
  requireRecord,
  runCodexAppServerAttempt,
  writeCodexAppServerBinding,
} from "./run-attempt.context-engine.test-support.js";
import {
  readCodexAppServerBinding,
  testCodexAppServerBindingStore,
} from "./session-binding.test-helpers.js";
import * as sharedClientModule from "./shared-client.js";
import { getCodexAppServerTurnRouter } from "./turn-router.js";

setupRunAttemptTestHooks();

describe("Codex context overflow binding cleanup", () => {
  it("releases startup resources when stale authority rejects overflow recovery", async () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const workspaceDir = path.join(tempDir, "workspace");
    openFileBackedSessionManagerForTest(sessionFile, { sessionId: "session-1" }).appendMessage(
      assistantMessage("pre-compaction context", Date.now()) as never,
    );
    await writeCodexAppServerBinding(
      sessionFile,
      makeThreadBootstrapBinding({
        threadId: "thread-old",
        cwd: workspaceDir,
        policyFingerprint:
          '{"schemaVersion":1,"engineId":"lossless-claw","ownsCompaction":true,"contextTokenBudget":400000,"projectionMaxChars":1000000}',
        epoch: "epoch-before",
      }),
    );
    const compact = vi.fn<ContextEngine["compact"]>(async () => ({
      ok: true,
      compacted: true,
      result: { summary: "summary", firstKeptEntryId: "entry-1", tokensBefore: 100_000 },
    }));
    const assemble = vi.fn(
      async ({ messages, prompt }: Parameters<ContextEngine["assemble"]>[0]) => ({
        messages: [...messages, userMessage(prompt ?? "", 11)],
        estimatedTokens: 42,
        systemPromptAddition: "context-engine system",
        contextProjection: { mode: "thread_bootstrap" as const, epoch: "epoch-before" },
      }),
    );
    const contextEngine = createContextEngine({ assemble, compact });
    const releaseLease = vi.spyOn(sharedClientModule, "releaseLeasedSharedCodexAppServerClient");
    const bindingStore = {
      ...testCodexAppServerBindingStore,
      mutate: vi.fn(async (...args: Parameters<typeof testCodexAppServerBindingStore.mutate>) => {
        const mutation = args[1];
        if (mutation.kind === "clear" && mutation.threadId === "thread-old") {
          throw new Error("Codex session generation is no longer current: session-1");
        }
        return await testCodexAppServerBindingStore.mutate(...args);
      }),
    };
    const harness = createStartedThreadHarness(
      async (method, requestParams) => {
        if (method === "thread/resume") {
          return threadStartResult("thread-old");
        }
        if (method === "turn/start") {
          const request = requireRecord(requestParams, `${method} params`);
          if (request.threadId === "thread-old") {
            await writeCodexAppServerBinding(sessionFile, {
              threadId: "thread-new",
              cwd: workspaceDir,
              dynamicToolsFingerprint: "[]",
            });
            throw new Error("Codex ran out of room in the model's context window");
          }
        }
        if (method === "thread/start") {
          return threadStartResult("thread-fresh");
        }
        return undefined;
      },
      { persistedThreads: ["thread-old"] },
    );
    const params = createParams(sessionFile, workspaceDir);
    params.contextEngine = contextEngine;
    params.contextTokenBudget = 400_000;

    await expect(runCodexAppServerAttempt(params, { bindingStore })).rejects.toThrow(
      "Codex session generation is no longer current: session-1",
    );

    expect(compact).not.toHaveBeenCalled();
    expect(harness.requests.map((request) => request.method)).toEqual([
      "config/read",
      "configRequirements/read",
      "thread/read",
      "thread/resume",
      "thread/inject_items",
      "turn/start",
      "thread/unsubscribe",
    ]);
    const savedBinding = await readCodexAppServerBinding(sessionFile);
    expect(savedBinding?.threadId).toBe("thread-new");
    const replacementRoute = getCodexAppServerTurnRouter(harness.client).reserveThread({
      threadId: "thread-old",
    });
    replacementRoute.release();
    expect(releaseLease).toHaveBeenCalledWith(harness.client);
  });
});
