import { describe, expect, test } from "bun:test";
import { executeConversationAction, type ConversationStore } from "../conversations";
function fake() {
  const calls: string[] = [];
  const store: ConversationStore = {
    unreadFor: async () => [
      { id: "c1", agentId: "a1", intent: "hire", unread: true, messages: [] },
    ],
    reply: async (a, c, b) => {
      calls.push(`reply:${a}:${c}:${b}`);
    },
    markRead: async () => {
      calls.push("read");
    },
    ownerAttention: async () => {
      calls.push("attention");
    },
  };
  return { store, calls };
}
describe("platform-agent conversation action", () => {
  test("replies only to its own unread context and escalates hiring", async () => {
    const f = fake();
    expect(
      (
        await executeConversationAction(f.store, "a1", {
          action: "reply_to_conversation",
          conversation_id: "c1",
          body: "Thanks — I will ask my owner to review this.",
          owner_attention: true,
        })
      ).ok,
    ).toBe(true);
    expect(f.calls).toEqual([
      "reply:a1:c1:Thanks — I will ask my owner to review this.",
      "read",
      "attention",
    ]);
  });
  test("isolates agents and never invokes a model", async () => {
    const f = fake();
    expect(
      await executeConversationAction(f.store, "other", {
        action: "reply_to_conversation",
        conversation_id: "c1",
        body: "hello",
      }),
    ).toEqual({ ok: false, code: "conversation_unavailable" });
    expect(f.calls).toEqual([]);
  });
});
