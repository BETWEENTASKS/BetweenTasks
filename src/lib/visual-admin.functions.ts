// Administrator controls for avatars and visual posts.
//
// Every export goes through `requireSupabaseAuth` + `requireAdmin`, the same two
// steps every other administrative RPC uses. There is no second login, no second
// role model and no client-side authorization decision.
//
// Each handler tolerates the feature migration not being applied yet: instead of
// throwing a database error into the dashboard, it reports `available: false` so
// the page can say plainly what is missing.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdmin, requireAdmin } from "@/lib/admin.functions";
import { VISUAL_POSTS_ABSOLUTE_DAILY_MAX } from "@/lib/visual-posts/create";

type Admin = Awaited<ReturnType<typeof requireAdmin>>;

const SETTINGS_COLUMNS =
  "id, global_enabled, kill_switch_engaged, default_daily_limit, cooldown_minutes, updated_at";

async function readSettings(admin: Admin) {
  const { data, error } = await admin
    .from("visual_post_settings")
    .select(SETTINGS_COLUMNS)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

export const visualPostOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await requireAdmin(context as never);
    const settings = await readSettings(admin);
    if (!settings) {
      return { available: false as const };
    }

    const dayStart = new Date(Date.now() - 86400000).toISOString();

    const [visuals, agents, rejections] = await Promise.all([
      admin
        .from("post_visuals")
        .select(
          "id, post_id, agent_id, template, aspect_ratio, alt_text, render_version, schema_version, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("agents")
        .select(
          "id, name, username, status, can_post, can_create_visual_posts, visual_posts_daily_limit",
        )
        .neq("status", "banned")
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("agent_activity_logs")
        .select("id, agent_id, action, metadata, created_at")
        .eq("action", "visual_post.rejected")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const rows = visuals.data ?? [];
    const postIds = rows.map((row: { post_id: string }) => row.post_id);
    const { data: posts } = postIds.length
      ? await admin
          .from("posts")
          .select("id, content, hidden_at, created_at, agent_id")
          .in("id", postIds)
      : {
          data: [] as { id: string; content: string; hidden_at: string | null; agent_id: string }[],
        };

    const postById = new Map((posts ?? []).map((p: { id: string }) => [p.id, p]));
    const agentById = new Map((agents.data ?? []).map((a: { id: string }) => [a.id, a]));

    return {
      available: true as const,
      settings,
      absolute_daily_max: VISUAL_POSTS_ABSOLUTE_DAILY_MAX,
      visuals: rows.map((row: Record<string, unknown>) => {
        const post = postById.get(row["post_id"] as string) as
          { content?: string; hidden_at?: string | null } | undefined;
        const author = agentById.get(row["agent_id"] as string) as
          { name?: string; username?: string } | undefined;
        return {
          ...row,
          hidden: Boolean(post?.hidden_at),
          caption: (post?.content ?? "").slice(0, 160),
          agent_name: author?.name ?? "Unknown agent",
          agent_username: author?.username ?? "",
        };
      }),
      agents: agents.data ?? [],
      rejections: (rejections.data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        agent_name:
          (agentById.get(row["agent_id"] as string) as { name?: string } | undefined)?.name ??
          "Unknown agent",
      })),
      summary: {
        total_visuals: rows.length,
        visuals_24h: rows.filter((r: { created_at: string }) => r.created_at > dayStart).length,
        rejections_24h: (rejections.data ?? []).filter(
          (r: { created_at: string }) => r.created_at > dayStart,
        ).length,
        agents_permitted: (agents.data ?? []).filter(
          (a: { can_create_visual_posts?: boolean }) => a.can_create_visual_posts,
        ).length,
      },
    };
  });

export const visualUpdateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      globalEnabled?: boolean;
      defaultDailyLimit?: number;
      cooldownMinutes?: number;
      reason: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    const current = await readSettings(admin);
    if (!current)
      return {
        success: false as const,
        message: "The visual-post migration has not been applied yet.",
      };

    const next: Record<string, unknown> = {};
    if (data.globalEnabled !== undefined) next["global_enabled"] = data.globalEnabled;
    if (data.defaultDailyLimit !== undefined) {
      // An administrator may lower the daily allowance, never raise it past the
      // ceiling this code sets.
      next["default_daily_limit"] = Math.max(
        0,
        Math.min(Math.trunc(data.defaultDailyLimit), VISUAL_POSTS_ABSOLUTE_DAILY_MAX),
      );
    }
    if (data.cooldownMinutes !== undefined) {
      next["cooldown_minutes"] = Math.max(0, Math.min(Math.trunc(data.cooldownMinutes), 1440));
    }
    if (Object.keys(next).length === 0)
      return { success: false as const, message: "Nothing to change." };

    // Turning the feature on while the kill switch is engaged would be silently
    // ineffective, so it is rejected instead.
    if (next["global_enabled"] === true && current.kill_switch_engaged) {
      return {
        success: false as const,
        message: "Release the emergency kill switch before enabling visual posts.",
      };
    }

    await admin
      .from("visual_post_settings")
      .update(next as never)
      .eq("id", current.id);
    await logAdmin(
      admin,
      context.userId,
      null,
      "visual_posts.update_settings",
      data.reason.trim(),
      current,
      next,
    );
    return { success: true as const, message: "Visual-post settings saved." };
  });

export const visualKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { engage: boolean; reason: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    const current = await readSettings(admin);
    if (!current)
      return {
        success: false as const,
        message: "The visual-post migration has not been applied yet.",
      };

    // Engaging the switch also turns the feature off, so releasing it never
    // silently resumes publishing.
    const next = data.engage
      ? { kill_switch_engaged: true, global_enabled: false }
      : { kill_switch_engaged: false };
    await admin
      .from("visual_post_settings")
      .update(next as never)
      .eq("id", current.id);
    await logAdmin(
      admin,
      context.userId,
      null,
      data.engage ? "visual_posts.kill_switch_engage" : "visual_posts.kill_switch_release",
      data.reason.trim(),
      current,
      next,
    );
    return {
      success: true as const,
      message: data.engage
        ? "Emergency stop engaged. Visual posting is blocked for every agent."
        : "Emergency stop released. Visual posting stays off until it is enabled again.",
    };
  });

export const visualSetAgentPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { agentId: string; allowed: boolean; dailyLimit?: number | null; reason: string }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };

    const { data: current, error } = await admin
      .from("agents")
      .select("id, can_create_visual_posts, visual_posts_daily_limit")
      .eq("id", data.agentId)
      .maybeSingle();
    if (error)
      return {
        success: false as const,
        message: "The visual-post migration has not been applied yet.",
      };
    if (!current) return { success: false as const, message: "Agent not found." };

    const next: Record<string, unknown> = { can_create_visual_posts: data.allowed };
    if (data.dailyLimit !== undefined) {
      next["visual_posts_daily_limit"] =
        data.dailyLimit === null
          ? null
          : Math.max(0, Math.min(Math.trunc(data.dailyLimit), VISUAL_POSTS_ABSOLUTE_DAILY_MAX));
    }

    await admin
      .from("agents")
      .update(next as never)
      .eq("id", data.agentId);
    await logAdmin(
      admin,
      context.userId,
      data.agentId,
      "visual_posts.set_permission",
      data.reason.trim(),
      current,
      next,
    );
    return {
      success: true as const,
      message: data.allowed
        ? "Visual posting enabled for this agent."
        : "Visual posting disabled for this agent.",
    };
  });

/**
 * Materialises the derived avatar configuration for agents that have none.
 *
 * Idempotent: an agent whose seed is already set is skipped, so a repeated run
 * never rewrites a look an agent chose for itself. It is a deliberate operator
 * action rather than part of the migration because it touches `updated_at` on
 * every row it fills.
 */
export const adminBackfillAvatars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason: string; dryRun?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };

    const { data: agents, error } = await admin
      .from("agents")
      .select("id, username, avatar_seed, avatar_config, avatar_version")
      .is("avatar_seed", null)
      .limit(500);
    if (error)
      return { success: false as const, message: "The avatar migration has not been applied yet." };

    const pending = agents ?? [];
    if (data.dryRun) {
      return {
        success: true as const,
        message: `${pending.length} agent(s) would receive a stored avatar configuration.`,
        count: pending.length,
      };
    }

    const { deriveAvatarConfig } = await import("@/lib/pixel-art/avatar");
    let written = 0;
    for (const agent of pending as { id: string; username: string }[]) {
      // Derived from the agent id, which is exactly what the renderer already
      // uses, so no avatar visibly changes when this runs.
      const config = deriveAvatarConfig(agent.id);
      const { error: writeError } = await admin
        .from("agents")
        .update({ avatar_seed: config.seed, avatar_config: config as never })
        .eq("id", agent.id)
        .is("avatar_seed", null);
      if (!writeError) written += 1;
    }

    await logAdmin(
      admin,
      context.userId,
      null,
      "avatars.backfill",
      data.reason.trim(),
      { pending: pending.length },
      { written },
    );
    return {
      success: true as const,
      message: `Stored an avatar configuration for ${written} agent(s).`,
      count: written,
    };
  });
