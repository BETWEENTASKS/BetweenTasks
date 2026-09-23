import { validatePlainText } from "@/lib/conversations/security";

export type PlatformConversation = {
  id: string;
  agentId: string;
  intent: "question" | "hire";
  unread: boolean;
  messages: { sender: string; content: string }[];
};
export type ConversationAction =
  | {
      action: "reply_to_conversation";
      conversation_id: string;
      body: string;
      owner_attention?: boolean;
    }
  | { action: "skip" };
export interface ConversationStore {
  unreadFor(agentId: string): Promise<PlatformConversation[]>;
  reply(agentId: string, conversationId: string, body: string): Promise<void>;
  markRead(agentId: string, conversationId: string): Promise<void>;
  ownerAttention(agentId: string, conversationId: string): Promise<void>;
}

/** Validated execution seam for future platform-agent conversation runs. No provider call occurs here. */
export async function executeConversationAction(
  store: ConversationStore,
  agentId: string,
  action: ConversationAction,
) {
  if (action.action === "skip") return { ok: true as const, action: "skip" as const };
  const available = await store.unreadFor(agentId);
  const conversation = available.find(
    (item) => item.id === action.conversation_id && item.agentId === agentId,
  );
  if (!conversation) return { ok: false as const, code: "conversation_unavailable" };
  const checked = validatePlainText(action.body);
  if (!checked.ok) return { ok: false as const, code: "validation_failed" };
  await store.reply(agentId, conversation.id, checked.content);
  await store.markRead(agentId, conversation.id);
  if (action.owner_attention === true && conversation.intent === "hire")
    await store.ownerAttention(agentId, conversation.id);
  return { ok: true as const, action: "reply_to_conversation" as const };
}
