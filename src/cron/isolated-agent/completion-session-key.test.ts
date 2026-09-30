import { describe, expect, it } from "vitest";
import { isDetachedCronSessionTarget } from "../session-target.js";
import { resolveCronExecCompletionSession } from "./completion-session-key.js";

describe("resolveCronExecCompletionSession", () => {
  it("does not isolate normal main-session completions", () => {
    expect(
      resolveCronExecCompletionSession({
        usesDetachedRunSession: isDetachedCronSessionTarget("main"),
        runSessionKey: "agent:main:main",
        completionSessionKey: "agent:main:telegram:group:-1001:topic:47",
        sessionStore: {},
      }),
    ).toEqual({});
  });

  it("does not isolate when the completion and run sessions are identical", () => {
    expect(
      resolveCronExecCompletionSession({
        usesDetachedRunSession: true,
        runSessionKey: "agent:main:main",
        completionSessionKey: "agent:main:main",
        sessionStore: {},
      }),
    ).toEqual({});
  });

  it("isolates a detached completion owned by a distinct source session", () => {
    expect(
      resolveCronExecCompletionSession({
        usesDetachedRunSession: true,
        runSessionKey: "agent:main:cron:topic-cron:run:test-run-id",
        completionSessionKey: "agent:main:telegram:group:-1001:topic:47",
        sessionStore: {
          "agent:main:telegram:group:-1001:topic:47": { sessionId: "source-session" },
        },
      }),
    ).toEqual({
      sessionKey: "agent:main:telegram:group:-1001:topic:47",
      generation: { sessionId: "source-session", lifecycleRevision: undefined },
    });
  });

  it("captures only an existing saved completion session generation", () => {
    const params = {
      usesDetachedRunSession: true,
      runSessionKey: "agent:main:cron:topic-cron",
      completionSessionKey: "agent:main:telegram:group:-1001:topic:47",
    };
    expect(resolveCronExecCompletionSession({ ...params, sessionStore: {} })).toEqual({});
    expect(
      resolveCronExecCompletionSession({
        ...params,
        sessionStore: {
          [params.completionSessionKey]: {
            sessionId: "source-session",
            lifecycleRevision: "source-revision",
          },
        },
      }),
    ).toEqual({
      sessionKey: params.completionSessionKey,
      generation: {
        sessionId: "source-session",
        lifecycleRevision: "source-revision",
      },
    });
  });
});
