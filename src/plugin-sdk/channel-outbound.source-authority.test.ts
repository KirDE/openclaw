import { describe, expect, it, vi } from "vitest";

const { sendCore, withCore } = vi.hoisted(() => ({
  sendCore: vi.fn(async (_params: unknown) => ({ status: "suppressed" })),
  withCore: vi.fn(async (_params: unknown, run: () => Promise<unknown>) => await run()),
}));
vi.mock("../channels/message/runtime.js", () => ({
  sendDurableMessageBatchCore: sendCore,
  withDurableMessageSendContextCore: withCore,
}));

import { sendDurableMessageBatch, withDurableMessageSendContext } from "./channel-outbound.js";

const attemptedAuthority = {
  cfg: {},
  channel: "matrix",
  to: "!room:example",
  payloads: [{ text: "hello" }],
  sourceGeneration: { sessionKey: "agent:main:main", sessionId: "spoofed" },
};

describe("plugin durable send boundary", () => {
  it("strips a forged source generation on both public send paths", async () => {
    const params = attemptedAuthority as unknown as Parameters<typeof sendDurableMessageBatch>[0];
    await sendDurableMessageBatch(params);
    await withDurableMessageSendContext(params, async () => "ok");
    expect(sendCore).toHaveBeenCalledOnce();
    expect(withCore).toHaveBeenCalledOnce();
    expect(sendCore.mock.calls[0]?.[0]).not.toHaveProperty("sourceGeneration");
    expect(withCore.mock.calls[0]?.[0]).not.toHaveProperty("sourceGeneration");
    expect(attemptedAuthority.sourceGeneration.sessionId).toBe("spoofed");
  });
});
