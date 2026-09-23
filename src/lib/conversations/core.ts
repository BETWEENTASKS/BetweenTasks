import { validatePlainText } from "./security";

export const CONTACT_SUBMISSIONS_PER_HOUR = 5;
export const CONTACT_TYPES = ["email", "telegram", "phone", "other"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];
export type ConversationRow = {
  id: string;
  agent_id: string;
  intent: "question" | "hire";
  status: "open" | "owner_attention" | "closed" | "blocked";
  guest_alias: string;
  created_at: string;
  owner_attention_at?: string | null;
};

export interface GuestConversationStore {
  conversationByToken(token: string): Promise<ConversationRow | null>;
  chatEnabled(agentId: string): Promise<boolean>;
  listMessages(
    conversationId: string,
    offset: number,
    limit: number,
  ): Promise<{ rows: unknown[]; total: number }>;
  countGuestMessages(conversationId: string, since: string): Promise<number>;
  insertGuestMessage(input: {
    conversationId: string;
    content: string;
    clientMessageId?: string;
  }): Promise<{ row?: unknown; duplicate?: boolean }>;
  touchAfterGuestMessage(conversationId: string, at: string): Promise<void>;
  countRate(bucket: string, subject: string, since: string): Promise<number>;
  addRate(bucket: string, subject: string): Promise<void>;
  saveContact(input: {
    conversationId: string;
    type: ContactType;
    value: string;
    consentedAt: string;
  }): Promise<void>;
  touchAfterContact(conversation: ConversationRow, at: string): Promise<void>;
}

export function canAgentReply(status: string) {
  return status === "open" || status === "owner_attention";
}

export async function authorizedGuestConversation(store: GuestConversationStore, token: string) {
  const conversation = await store.conversationByToken(token);
  if (!conversation || !(await store.chatEnabled(conversation.agent_id))) return null;
  return conversation;
}

export async function listGuestMessagesCore(
  store: GuestConversationStore,
  token: string,
  page: number,
  pageSize: number,
) {
  const conversation = await authorizedGuestConversation(store, token);
  if (!conversation) return null;
  const offset = (page - 1) * pageSize;
  const messages = await store.listMessages(conversation.id, offset, pageSize);
  return {
    conversation,
    messages: messages.rows,
    pagination: { page, page_size: pageSize, total: messages.total },
  };
}

export async function sendGuestMessageCore(
  store: GuestConversationStore,
  token: string,
  body: unknown,
  clientMessageId?: string,
) {
  const conversation = await authorizedGuestConversation(store, token);
  if (!conversation || conversation.status === "blocked" || conversation.status === "closed")
    return null;
  const checked = validatePlainText(body);
  if (!checked.ok) throw new Error(`validation:${checked.message}`);
  const now = Date.now();
  for (const [limit, seconds] of [
    [5, 60],
    [30, 3600],
  ] as const) {
    if (
      (await store.countGuestMessages(
        conversation.id,
        new Date(now - seconds * 1000).toISOString(),
      )) >= limit
    )
      throw new Error("rate_limited");
  }
  const result = await store.insertGuestMessage({
    conversationId: conversation.id,
    content: checked.content,
    ...(clientMessageId ? { clientMessageId } : {}),
  });
  if (result.duplicate) return { duplicate: true };
  await store.touchAfterGuestMessage(conversation.id, new Date(now).toISOString());
  return result.row;
}

export async function submitContactCore(
  store: GuestConversationStore,
  token: string,
  input: { type: unknown; value: unknown; consent: unknown },
) {
  const conversation = await authorizedGuestConversation(store, token);
  if (!conversation || conversation.status === "blocked" || conversation.status === "closed")
    return null;
  const type =
    typeof input.type === "string" && CONTACT_TYPES.includes(input.type as ContactType)
      ? (input.type as ContactType)
      : null;
  const value = typeof input.value === "string" ? input.value.trim() : "";
  if (input.consent !== true || !type || !value || value.length > 500)
    throw new Error("validation:Invalid contact submission.");
  const since = new Date(Date.now() - 3_600_000).toISOString();
  if (
    (await store.countRate("conversation_contact", conversation.id, since)) >=
    CONTACT_SUBMISSIONS_PER_HOUR
  )
    throw new Error("rate_limited");
  await store.addRate("conversation_contact", conversation.id);
  const at = new Date().toISOString();
  await store.saveContact({ conversationId: conversation.id, type, value, consentedAt: at });
  await store.touchAfterContact(conversation, at);
  return { success: true as const };
}
