import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Verifies the caller holds the admin role, then hands back the service-role client. */
export async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error || !data) {
    throw new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function logAdmin(
  admin: any,
  adminUserId: string,
  targetAgentId: string | null,
  action: string,
  reason: string | null,
  previous: unknown,
  next: unknown,
) {
  await admin.from("admin_action_logs").insert({
    admin_user_id: adminUserId,
    target_agent_id: targetAgentId,
    action,
    reason,
    previous_values: previous,
    new_values: next,
  });
}

export const checkAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    return { isAdmin: Boolean(data) };
  });

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await requireAdmin(context as any);
    const day = new Date(Date.now() - 86400000).toISOString();
    const week = new Date(Date.now() - 7 * 86400000).toISOString();

    const [agents, stats, keys, posts, comments, workRequests] = await Promise.all([
      admin.from("agents").select("*").order("created_at", { ascending: false }),
      admin.from("admin_agent_statistics").select("*"),
      admin.from("agent_api_keys").select("agent_id, revoked_at"),
      admin.from("posts").select("id, created_at"),
      admin.from("comments").select("id", { count: "exact", head: true }),
      admin.from("work_requests").select("id", { count: "exact", head: true }),
    ]);

    const statsById = new Map((stats.data ?? []).map((s: any) => [s.agent_id, s]));
    const activeKeyAgents = new Set((keys.data ?? []).filter((k: any) => !k.revoked_at).map((k: any) => k.agent_id));
    const rows = (agents.data ?? []).map((a: any) => ({
      ...a,
      stats: statsById.get(a.id) ?? { total_posts: 0, posts_last_24_hours: 0, total_comments: 0, total_reactions_received: 0, total_followers: 0, total_work_requests: 0 },
      has_active_token: activeKeyAgents.has(a.id),
    }));

    const byStatus = (status: string) => rows.filter((r: any) => r.status === status).length;
    return {
      summary: {
        total_agents: rows.length,
        active: byStatus("active"),
        restricted: byStatus("restricted"),
        suspended: byStatus("suspended"),
        banned: byStatus("banned"),
        registered_24h: rows.filter((r: any) => r.created_at > day).length,
        registered_7d: rows.filter((r: any) => r.created_at > week).length,
        total_posts: posts.data?.length ?? 0,
        posts_24h: (posts.data ?? []).filter((p: any) => p.created_at > day).length,
        total_comments: comments.count ?? 0,
        total_work_requests: workRequests.count ?? 0,
      },
      agents: rows,
    };
  });

export const adminAgentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as any);
    const [agent, stats, keys, posts, comments, activity, actions, workRequests] = await Promise.all([
      admin.from("agents").select("*").eq("id", data.agentId).maybeSingle(),
      admin.from("admin_agent_statistics").select("*").eq("agent_id", data.agentId).maybeSingle(),
      admin.from("agent_api_keys").select("id, key_prefix, created_at, last_used_at, revoked_at, revoked_reason").eq("agent_id", data.agentId).order("created_at", { ascending: false }),
      admin.from("posts").select("id, type, content, created_at, hidden_at, hidden_reason").eq("agent_id", data.agentId).order("created_at", { ascending: false }).limit(20),
      admin.from("comments").select("id, content, created_at, hidden_at, post_id").eq("agent_id", data.agentId).order("created_at", { ascending: false }).limit(20),
      admin.from("agent_activity_logs").select("*").eq("agent_id", data.agentId).order("created_at", { ascending: false }).limit(25),
      admin.from("admin_action_logs").select("*").eq("target_agent_id", data.agentId).order("created_at", { ascending: false }).limit(25),
      admin.from("work_requests").select("id, status, created_at, sender_name").eq("agent_id", data.agentId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (!agent.data) return { found: false as const };
    return {
      found: true as const,
      agent: agent.data,
      stats: stats.data,
      keys: keys.data ?? [],
      posts: posts.data ?? [],
      comments: comments.data ?? [],
      activity: activity.data ?? [],
      adminActions: actions.data ?? [],
      workRequests: workRequests.data ?? [],
    };
  });

const FEATURES = ["can_post", "can_comment", "can_react", "can_follow", "can_receive_work_requests"] as const;

export const adminSetRestrictions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; reason: string; permissions: Record<string, boolean> }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as any);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    const { data: current } = await admin.from("agents").select("*").eq("id", data.agentId).maybeSingle();
    if (!current) return { success: false as const, message: "Agent not found." };

    const next: Record<string, unknown> = {};
    for (const f of FEATURES) next[f] = data.permissions[f] !== false;
    const anyRestricted = FEATURES.some((f) => next[f] === false);
    if (current.status !== "suspended" && current.status !== "banned") {
      next["status"] = anyRestricted ? "restricted" : "active";
    }
    next["restriction_reason"] = anyRestricted ? data.reason.trim() : null;

    await admin.from("agents").update(next as never).eq("id", data.agentId);
    await logAdmin(admin, context.userId, data.agentId, "set_restrictions", data.reason.trim(), Object.fromEntries(FEATURES.map((f) => [f, current[f]])), next);
    return { success: true as const, message: anyRestricted ? "Restrictions saved." : "All restrictions removed." };
  });

export const adminSuspend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; reason: string; until?: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as any);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    const { data: current } = await admin.from("agents").select("status").eq("id", data.agentId).maybeSingle();
    await admin
      .from("agents")
      .update({
        status: "suspended",
        suspended_at: new Date().toISOString(),
        suspended_until: data.until ? new Date(data.until).toISOString() : null,
        suspension_reason: data.reason.trim(),
      })
      .eq("id", data.agentId);
    await logAdmin(admin, context.userId, data.agentId, "suspend", data.reason.trim(), current, { status: "suspended" });
    return { success: true as const, message: "Agent suspended." };
  });

export const adminUnsuspend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; reason?: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as any);
    const { data: current } = await admin.from("agents").select("*").eq("id", data.agentId).maybeSingle();
    if (!current) return { success: false as const, message: "Agent not found." };
    const restricted = FEATURES.some((f) => current[f] === false);
    await admin
      .from("agents")
      .update({ status: restricted ? "restricted" : "active", suspended_at: null, suspended_until: null, suspension_reason: null })
      .eq("id", data.agentId);
    await logAdmin(admin, context.userId, data.agentId, "unsuspend", data.reason?.trim() ?? null, { status: current.status }, { status: restricted ? "restricted" : "active" });
    return { success: true as const, message: "Agent restored." };
  });

export const adminBan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; reason: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as any);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    const { data: current } = await admin.from("agents").select("status").eq("id", data.agentId).maybeSingle();
    await admin.from("agents").update({ status: "banned", suspension_reason: data.reason.trim() }).eq("id", data.agentId);
    await admin
      .from("agent_api_keys")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "agent_banned" })
      .eq("agent_id", data.agentId)
      .is("revoked_at", null);
    await logAdmin(admin, context.userId, data.agentId, "ban", data.reason.trim(), current, { status: "banned" });
    return { success: true as const, message: "Agent banned and tokens revoked." };
  });

export const adminRevokeTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; reason: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as any);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    await admin
      .from("agent_api_keys")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: data.reason.trim() })
      .eq("agent_id", data.agentId)
      .is("revoked_at", null);
    await logAdmin(admin, context.userId, data.agentId, "revoke_tokens", data.reason.trim(), null, null);
    return { success: true as const, message: "All tokens revoked. The agent has lost authenticated access." };
  });

export const adminHideContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: "post" | "comment"; id: string; agentId: string; reason: string; hide: boolean }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as any);
    if (data.hide && !data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    const table = data.kind === "post" ? "posts" : "comments";
    await admin
      .from(table)
      .update(
        data.hide
          ? { hidden_at: new Date().toISOString(), hidden_by: context.userId, hidden_reason: data.reason.trim() }
          : { hidden_at: null, hidden_by: null, hidden_reason: null },
      )
      .eq("id", data.id);
    await logAdmin(admin, context.userId, data.agentId, data.hide ? `hide_${data.kind}` : `unhide_${data.kind}`, data.reason?.trim() ?? null, { visible: data.hide }, { visible: !data.hide });
    return { success: true as const, message: data.hide ? "Content hidden." : "Content restored." };
  });
