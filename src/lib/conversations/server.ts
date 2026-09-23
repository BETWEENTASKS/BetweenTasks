/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { guestAlias, hashSecret, secureToken } from "./security";
import {
  listGuestMessagesCore,
  sendGuestMessageCore,
  submitContactCore,
  type ContactType,
  type GuestConversationStore,
} from "./core";

const db = supabaseAdmin as any;
const failed = () => new Error("write_failed");

export async function chatEnabled(agentId: string) {
  const [{ data: settings, error: settingsError }, { data: agent, error: agentError }] =
    await Promise.all([
      db.from("anonymous_chat_settings").select("global_enabled").maybeSingle(),
      db.from("agents").select("anonymous_chat_enabled,status").eq("id", agentId).maybeSingle(),
    ]);
  if (settingsError || agentError) return false;
  return (
    settings?.global_enabled === true &&
    agent?.anonymous_chat_enabled === true &&
    agent?.status === "active"
  );
}

export async function conversationByToken(token: string) {
  if (!/^btc_[a-f0-9]{64}$/.test(token)) return null;
  const { data, error } = await db
    .from("agent_conversations")
    .select("*")
    .eq("guest_access_hash", await hashSecret(token))
    .maybeSingle();
  return error ? null : (data ?? null);
}

const store: GuestConversationStore = {
  conversationByToken,
  chatEnabled,
  async listMessages(conversationId, offset, limit) {
    const { data, count, error } = await db
      .from("conversation_messages")
      .select("id,sender_type,content,created_at,read_at", { count: "exact" })
      .eq("conversation_id", conversationId)
      .order("created_at")
      .range(offset, offset + limit - 1);
    if (error) throw failed();
    return { rows: data ?? [], total: count ?? 0 };
  },
  async countGuestMessages(conversationId, since) {
    const { count, error } = await db
      .from("conversation_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("sender_type", "guest")
      .gte("created_at", since);
    if (error) throw failed();
    return count ?? 0;
  },
  async insertGuestMessage(input) {
    const { data, error } = await db
      .from("conversation_messages")
      .insert({
        conversation_id: input.conversationId,
        sender_type: "guest",
        content: input.content,
        ...(input.clientMessageId ? { client_message_id: input.clientMessageId } : {}),
      })
      .select("id,sender_type,content,created_at")
      .single();
    if (error?.code === "23505") return { duplicate: true };
    if (error || !data) throw failed();
    return { row: data };
  },
  async touchAfterGuestMessage(conversationId, at) {
    const { error } = await db
      .from("agent_conversations")
      .update({ agent_unread: true, last_message_at: at })
      .eq("id", conversationId);
    if (error) throw failed();
  },
  async countRate(bucket, subject, since) {
    const { count, error } = await db
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("bucket", bucket)
      .eq("subject", subject)
      .gte("created_at", since);
    if (error) throw failed();
    return count ?? 0;
  },
  async addRate(bucket, subject) {
    const { error } = await db.from("rate_limit_events").insert({ bucket, subject });
    if (error) throw failed();
  },
  async saveContact(input: {
    conversationId: string;
    type: ContactType;
    value: string;
    consentedAt: string;
  }) {
    const { error } = await db.from("conversation_contacts").upsert(
      {
        conversation_id: input.conversationId,
        contact_type: input.type,
        contact_value: input.value,
        consented_at: input.consentedAt,
      },
      { onConflict: "conversation_id,contact_type" },
    );
    if (error) throw failed();
  },
  async touchAfterContact(conversation, at) {
    const { error } = await db
      .from("agent_conversations")
      .update({
        contact_shared_at: at,
        status: conversation.intent === "hire" ? "owner_attention" : conversation.status,
        owner_attention_at: conversation.intent === "hire" ? at : conversation.owner_attention_at,
      })
      .eq("id", conversation.id);
    if (error) throw failed();
  },
};

export async function createConversation(
  agentId: string,
  intent: "question" | "hire",
  ipSubject: string,
) {
  if (!(await chatEnabled(agentId))) return null;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  if ((await store.countRate("conversation_create_ip", ipSubject, since)) >= 10)
    throw new Error("rate_limited");
  await store.addRate("conversation_create_ip", ipSubject);
  const token = secureToken();
  const { data, error } = await db
    .from("agent_conversations")
    .insert({
      agent_id: agentId,
      intent,
      guest_alias: guestAlias(),
      guest_access_hash: await hashSecret(token),
    })
    .select("id,agent_id,intent,status,guest_alias,created_at")
    .single();
  if (error || !data) throw failed();
  return { conversation: data, token };
}

export async function listGuestMessages(token: string, page = 1, pageSize = 50) {
  const result = await listGuestMessagesCore(store, token, page, pageSize);
  return result ? { ...result, conversation: publicConversation(result.conversation) } : null;
}
export const sendGuestMessage = (token: string, body: unknown, clientMessageId?: string) =>
  sendGuestMessageCore(store, token, body, clientMessageId);
export const submitContact = (
  token: string,
  input: { type: unknown; value: unknown; consent: unknown },
) => submitContactCore(store, token, input);

export function publicConversation(row: any) {
  return {
    id: row.id,
    agent_id: row.agent_id,
    intent: row.intent,
    status: row.status,
    guest_alias: row.guest_alias,
    created_at: row.created_at,
  };
}

export async function privacySubject(request: Request) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const salt =
    process.env["CHAT_IP_HASH_SALT"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    "local-development-only";
  return hashSecret(`${salt}:${ip}`);
}
