import { describe, expect, test } from "bun:test";
import {
  canAgentReply,
  listGuestMessagesCore,
  sendGuestMessageCore,
  submitContactCore,
  type ConversationRow,
  type GuestConversationStore,
} from "../core";
import { ensureConversationForFirstMessage, restoreConversationAccess } from "../client";
import { readBoundedJson } from "../security";

function fixture() {
  let globalEnabled = true;
  let agentEnabled = true;
  let contactRate = 0;
  let failContact = false;
  const contacts = new Map<string, string>();
  const conversation: ConversationRow = {
    id: "conversation-1",
    agent_id: "agent-1",
    intent: "hire",
    status: "open",
    guest_alias: "Quiet Fox 0001",
    created_at: new Date().toISOString(),
  };
  const store: GuestConversationStore = {
    conversationByToken: async (token) => (token === "valid" ? conversation : null),
    chatEnabled: async () => globalEnabled && agentEnabled,
    listMessages: async () => ({ rows: [{ id: "message-1" }], total: 1 }),
    countGuestMessages: async () => 0,
    insertGuestMessage: async () => ({ row: { id: "new-message" } }),
    touchAfterGuestMessage: async () => {},
    countRate: async () => contactRate,
    addRate: async () => {
      contactRate += 1;
    },
    saveContact: async ({ type, value }) => {
      if (failContact) throw new Error("write_failed");
      contacts.set(type, value);
    },
    touchAfterContact: async () => {},
  };
  return {
    store,
    conversation,
    contacts,
    disableGlobal: () => {
      globalEnabled = false;
    },
    disableAgent: () => {
      agentEnabled = false;
    },
    setContactRate: (value: number) => {
      contactRate = value;
    },
    failContact: () => {
      failContact = true;
    },
  };
}

describe("conversation runtime review cases", () => {
  test("the global kill switch disables an existing conversation", async () => {
    const f = fixture();
    expect(await listGuestMessagesCore(f.store, "valid", 1, 50)).not.toBeNull();
    f.disableGlobal();
    expect(await listGuestMessagesCore(f.store, "valid", 1, 50)).toBeNull();
    expect(await sendGuestMessageCore(f.store, "valid", "hello")).toBeNull();
    expect(
      await submitContactCore(f.store, "valid", {
        type: "email",
        value: "a@example.com",
        consent: true,
      }),
    ).toBeNull();
  });
  test("per-agent disable disables an existing conversation", async () => {
    const f = fixture();
    f.disableAgent();
    expect(await listGuestMessagesCore(f.store, "valid", 1, 50)).toBeNull();
    expect(await sendGuestMessageCore(f.store, "valid", "hello")).toBeNull();
  });
  test("contact payload is byte-limited without relying on Content-Length", async () => {
    const request = new Request("https://example.test/contact", {
      method: "POST",
      body: JSON.stringify({ value: "🔥".repeat(3_000) }),
    });
    expect(request.headers.get("content-length")).toBeNull();
    const result = await readBoundedJson(request);
    expect(result).toEqual({ ok: false, tooLarge: true });
  });
  test("contact rate limit and per-type upsert prevent unbounded duplicates", async () => {
    const f = fixture();
    await submitContactCore(f.store, "valid", {
      type: "email",
      value: "first@example.com",
      consent: true,
    });
    await submitContactCore(f.store, "valid", {
      type: "email",
      value: "second@example.com",
      consent: true,
    });
    expect(f.contacts.size).toBe(1);
    expect(f.contacts.get("email")).toBe("second@example.com");
    f.setContactRate(5);
    await expectError(
      () =>
        submitContactCore(f.store, "valid", {
          type: "phone",
          value: "+1 555 555 5555",
          consent: true,
        }),
      "rate_limited",
    );
  });
  test("a failed contact insert never becomes success", async () => {
    const f = fixture();
    f.failContact();
    await expectError(
      () =>
        submitContactCore(f.store, "valid", {
          type: "email",
          value: "a@example.com",
          consent: true,
        }),
      "write_failed",
    );
  });
  test("fragment recovery overrides localStorage and opening alone starts nothing", async () => {
    let starts = 0;
    let persisted = "";
    let cleared = false;
    const token = restoreConversationAccess(
      "#access=fragment-token",
      "stored-token",
      (value) => {
        persisted = value;
      },
      () => {
        cleared = true;
      },
    );
    expect(token).toBe("fragment-token");
    expect(persisted).toBe("fragment-token");
    expect(cleared).toBe(true);
    expect(starts).toBe(0);
    expect(
      await ensureConversationForFirstMessage(token, async () => {
        starts += 1;
        return "new-token";
      }),
    ).toBe("fragment-token");
    expect(starts).toBe(0);
    expect(
      await ensureConversationForFirstMessage("", async () => {
        starts += 1;
        return "new-token";
      }),
    ).toBe("new-token");
    expect(starts).toBe(1);
  });
  test("closed and blocked conversations reject agent replies until explicitly reopened", () => {
    expect(canAgentReply("open")).toBe(true);
    expect(canAgentReply("owner_attention")).toBe(true);
    expect(canAgentReply("closed")).toBe(false);
    expect(canAgentReply("blocked")).toBe(false);
  });
});

async function expectError(run: () => Promise<unknown>, message: string) {
  try {
    await run();
    throw new Error("expected rejection");
  } catch (error) {
    expect(error instanceof Error).toBe(true);
    expect((error as Error).message).toBe(message);
  }
}
