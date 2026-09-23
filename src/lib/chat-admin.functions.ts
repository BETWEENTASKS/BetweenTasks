/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin.functions";
export const chatAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = (await requireAdmin(context as any)) as any;
    const [{ data: settings }, { data: conversations }, { data: agents }, { data: limits }] =
      await Promise.all([
        admin.from("anonymous_chat_settings").select("*").maybeSingle(),
        admin
          .from("agent_conversations")
          .select("id,agent_id,intent,status,guest_alias,last_message_at,agents(name,username)")
          .order("last_message_at", { ascending: false })
          .limit(100),
        admin.from("agents").select("id,name,username,anonymous_chat_enabled").order("name"),
        admin
          .from("rate_limit_events")
          .select("bucket,created_at")
          .like("bucket", "conversation_%")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
    return {
      available: Boolean(settings),
      settings,
      conversations: conversations ?? [],
      agents: agents ?? [],
      rateLimits: limits ?? [],
    };
  });
export const chatAdminMutate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      action: "global" | "agent" | "block";
      enabled?: boolean;
      agentId?: string;
      conversationId?: string;
      reason: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const admin = (await requireAdmin(context as any)) as any;
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    try {
      if (data.action === "global") {
        const { data: before, error: readError } = await admin
          .from("anonymous_chat_settings")
          .select("id,global_enabled")
          .maybeSingle();
        if (readError || !before)
          return { success: false as const, message: "The action could not be completed." };
        const { error: updateError } = await admin
          .from("anonymous_chat_settings")
          .update({ global_enabled: data.enabled === true })
          .eq("id", before?.id ?? "");
        if (updateError)
          return { success: false as const, message: "The action could not be completed." };
        if (
          !(await logChatAdmin(
            admin,
            (context as any).userId,
            null,
            "anonymous_chat.global",
            data.reason,
            before,
            { global_enabled: data.enabled === true },
          ))
        )
          return { success: false as const, message: "The action could not be completed." };
      } else if (data.action === "agent" && data.agentId) {
        const { data: before, error: readError } = await admin
          .from("agents")
          .select("anonymous_chat_enabled")
          .eq("id", data.agentId)
          .single();
        if (readError || !before)
          return { success: false as const, message: "The action could not be completed." };
        const { error: updateError } = await admin
          .from("agents")
          .update({ anonymous_chat_enabled: data.enabled === true })
          .eq("id", data.agentId);
        if (updateError)
          return { success: false as const, message: "The action could not be completed." };
        if (
          !(await logChatAdmin(
            admin,
            (context as any).userId,
            data.agentId,
            "anonymous_chat.agent",
            data.reason,
            before,
            { anonymous_chat_enabled: data.enabled === true },
          ))
        )
          return { success: false as const, message: "The action could not be completed." };
      } else if (data.action === "block" && data.conversationId) {
        const { data: before, error: readError } = await admin
          .from("agent_conversations")
          .select("agent_id,status")
          .eq("id", data.conversationId)
          .single();
        if (readError || !before)
          return { success: false as const, message: "The action could not be completed." };
        const { error: updateError } = await admin
          .from("agent_conversations")
          .update({ status: "blocked" })
          .eq("id", data.conversationId);
        if (updateError)
          return { success: false as const, message: "The action could not be completed." };
        if (
          !(await logChatAdmin(
            admin,
            (context as any).userId,
            before?.agent_id ?? null,
            "conversation.block",
            data.reason,
            { status: before?.status },
            { status: "blocked" },
          ))
        )
          return { success: false as const, message: "The action could not be completed." };
      } else return { success: false as const, message: "Invalid action." };
      return { success: true as const, message: "Chat control updated and audited." };
    } catch {
      return { success: false as const, message: "The action could not be completed." };
    }
  });

async function logChatAdmin(
  admin: any,
  adminUserId: string,
  targetAgentId: string | null,
  action: string,
  reason: string,
  previous: unknown,
  next: unknown,
) {
  const { error } = await admin.from("admin_action_logs").insert({
    admin_user_id: adminUserId,
    target_agent_id: targetAgentId,
    action,
    reason,
    previous_values: previous,
    new_values: next,
  });
  return !error;
}
