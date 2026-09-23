// Administrator server functions for the DeepSeek demonstration-agent system.
//
// Every export goes through `requireSupabaseAuth` + `requireAdmin`, the same
// server-side authorization the rest of the admin dashboard uses. Server-only
// modules are imported dynamically because this file ships to the client bundle.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdmin, requireAdmin } from "@/lib/admin.functions";

const SETTINGS_COLUMNS =
  "id, global_enabled, scheduler_enabled, daily_max_requests, daily_max_posts, daily_max_comments, daily_max_input_tokens, daily_max_output_tokens, max_thread_depth, updated_at";

type RunRow = {
  agent_id: string | null;
  selected_action: string | null;
  status: string;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

function startOfUtcDay(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export const demoAgentsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await requireAdmin(context as never);
    const { readDemoEnv, describeDemoEnv } = await import("@/lib/demo-agents/config.server");
    const { seedProgress } = await import("@/lib/demo-agents/seed.server");

    const since = startOfUtcDay();
    const [settings, configs, stats, todaysRuns, recentRuns, seed] = await Promise.all([
      admin.from("demo_agent_settings").select(SETTINGS_COLUMNS).limit(1).maybeSingle(),
      admin
        .from("demo_agent_configs")
        .select(
          "agent_id, persona_key, current_project, enabled, cooldown_minutes, max_posts_per_day, max_comments_per_day, last_run_at, agents!inner(id, name, username, avatar_url, status, is_demo, can_post, can_comment, can_react)",
        ),
      admin.from("admin_agent_statistics").select("*"),
      admin
        .from("demo_agent_runs")
        .select(
          "agent_id, selected_action, status, model, prompt_tokens, completion_tokens, error_code, error_message, created_at",
        )
        .gte("created_at", since),
      admin.from("demo_agent_runs").select("*").order("created_at", { ascending: false }).limit(50),
      seedProgress(),
    ]);

    const runs = (todaysRuns.data ?? []) as RunRow[];
    const statsById = new Map(
      (stats.data ?? []).map((s: { agent_id: string | null }) => [s.agent_id, s]),
    );

    const perAgent = new Map<
      string,
      {
        posts: number;
        comments: number;
        requests: number;
        inputTokens: number;
        outputTokens: number;
      }
    >();
    for (const run of runs) {
      if (!run.agent_id) continue;
      const entry = perAgent.get(run.agent_id) ?? {
        posts: 0,
        comments: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      if (run.model) entry.requests += 1;
      entry.inputTokens += run.prompt_tokens ?? 0;
      entry.outputTokens += run.completion_tokens ?? 0;
      if (run.status === "completed" && run.selected_action === "create_post") entry.posts += 1;
      if (run.status === "completed" && run.selected_action === "create_comment")
        entry.comments += 1;
      perAgent.set(run.agent_id, entry);
    }

    const lastRunByAgent = new Map<string, RunRow>();
    const lastErrorByAgent = new Map<string, RunRow>();
    for (const run of (recentRuns.data ?? []) as RunRow[]) {
      if (!run.agent_id) continue;
      if (!lastRunByAgent.has(run.agent_id)) lastRunByAgent.set(run.agent_id, run);
      if (run.status === "failed" && !lastErrorByAgent.has(run.agent_id))
        lastErrorByAgent.set(run.agent_id, run);
    }

    const agents = (configs.data ?? []).map((row) => {
      const agent = (row as unknown as { agents: Record<string, unknown> }).agents;
      const agentId = row.agent_id;
      const today = perAgent.get(agentId) ?? {
        posts: 0,
        comments: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      const lastRun = lastRunByAgent.get(agentId);
      const lastError = lastErrorByAgent.get(agentId);
      const totals = statsById.get(agentId) as
        { total_posts: number | null; total_comments: number | null } | undefined;
      return {
        agent_id: agentId,
        persona_key: row.persona_key,
        name: String(agent["name"]),
        username: String(agent["username"]),
        avatar_url: (agent["avatar_url"] as string | null) ?? null,
        status: String(agent["status"]),
        can_post: agent["can_post"] !== false,
        can_comment: agent["can_comment"] !== false,
        can_react: agent["can_react"] !== false,
        enabled: row.enabled,
        current_project: row.current_project,
        cooldown_minutes: row.cooldown_minutes,
        max_posts_per_day: row.max_posts_per_day,
        max_comments_per_day: row.max_comments_per_day,
        last_run_at: row.last_run_at,
        posts_today: today.posts,
        comments_today: today.comments,
        requests_today: today.requests,
        input_tokens_today: today.inputTokens,
        output_tokens_today: today.outputTokens,
        total_posts: totals?.total_posts ?? 0,
        total_comments: totals?.total_comments ?? 0,
        last_action: lastRun?.selected_action ?? null,
        last_status: lastRun?.status ?? null,
        last_error: lastError
          ? `${lastError.error_code}: ${lastError.error_message ?? ""}`.slice(0, 200)
          : null,
      };
    });

    const usage = runs.reduce(
      (acc, run) => ({
        requests: acc.requests + (run.model ? 1 : 0),
        inputTokens: acc.inputTokens + (run.prompt_tokens ?? 0),
        outputTokens: acc.outputTokens + (run.completion_tokens ?? 0),
        posts:
          acc.posts + (run.status === "completed" && run.selected_action === "create_post" ? 1 : 0),
        comments:
          acc.comments +
          (run.status === "completed" && run.selected_action === "create_comment" ? 1 : 0),
      }),
      { requests: 0, inputTokens: 0, outputTokens: 0, posts: 0, comments: 0 },
    );

    return {
      settings: settings.data ?? null,
      // Never contains the key itself — only Configured / Missing.
      environment: describeDemoEnv(readDemoEnv()),
      agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
      usage,
      seed,
      runs: recentRuns.data ?? [],
    };
  });

export const demoRunHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId?: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const limit = Math.min(Math.max(data.limit ?? 50, 1), 200);
    let query = admin
      .from("demo_agent_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (data.agentId) query = query.eq("agent_id", data.agentId);
    const { data: runs } = await query;
    return { runs: runs ?? [] };
  });

const SETTINGS_FIELDS = [
  "daily_max_requests",
  "daily_max_posts",
  "daily_max_comments",
  "daily_max_input_tokens",
  "daily_max_output_tokens",
  "max_thread_depth",
] as const;

export const demoUpdateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      global_enabled?: boolean;
      scheduler_enabled?: boolean;
      daily_max_requests?: number;
      daily_max_posts?: number;
      daily_max_comments?: number;
      daily_max_input_tokens?: number;
      daily_max_output_tokens?: number;
      max_thread_depth?: number;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { data: current } = await admin
      .from("demo_agent_settings")
      .select(SETTINGS_COLUMNS)
      .limit(1)
      .maybeSingle();
    if (!current) {
      return {
        success: false as const,
        message: "Settings row is missing. Apply the demo-agent migration first.",
      };
    }

    const next: Record<string, unknown> = {};
    if (typeof data.global_enabled === "boolean") next["global_enabled"] = data.global_enabled;
    if (typeof data.scheduler_enabled === "boolean")
      next["scheduler_enabled"] = data.scheduler_enabled;
    for (const field of SETTINGS_FIELDS) {
      const value = data[field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value < 0 || value > 1_000_000) {
        return { success: false as const, message: `${field} must be between 0 and 1000000.` };
      }
      next[field] = Math.floor(value);
    }
    if (Object.keys(next).length === 0)
      return { success: false as const, message: "Nothing to update." };

    await admin
      .from("demo_agent_settings")
      .update(next as never)
      .eq("id", current.id);
    await logAdmin(admin, context.userId, null, "demo_settings_update", null, current, next);
    return { success: true as const, message: "Demo settings saved." };
  });

export const demoKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    if (!data.reason?.trim()) return { success: false as const, message: "A reason is required." };
    const { data: current } = await admin
      .from("demo_agent_settings")
      .select(SETTINGS_COLUMNS)
      .limit(1)
      .maybeSingle();
    if (!current) return { success: false as const, message: "Settings row is missing." };

    await admin
      .from("demo_agent_settings")
      .update({ global_enabled: false, scheduler_enabled: false })
      .eq("id", current.id);
    // Also pause every persona so re-enabling the switch cannot resume activity by accident.
    await admin.from("demo_agent_configs").update({ enabled: false }).neq("agent_id", "");
    await logAdmin(admin, context.userId, null, "demo_kill_switch", data.reason.trim(), current, {
      global_enabled: false,
      scheduler_enabled: false,
      all_agents_paused: true,
    });
    return {
      success: true as const,
      message: "All demo activity stopped and every demo agent paused.",
    };
  });

export const demoSeedAgents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await requireAdmin(context as never);
    const { ensureDemoAgents } = await import("@/lib/demo-agents/seed.server");
    const result = await ensureDemoAgents();
    await logAdmin(admin, context.userId, null, "demo_seed_agents", null, null, result);
    const parts = [
      `${result.created.length} created`,
      `${result.refreshed.length} refreshed`,
      result.conflicts.length > 0
        ? `${result.conflicts.length} username conflict(s): ${result.conflicts.join(", ")}`
        : "",
    ].filter(Boolean);
    return { success: true as const, message: `Demo agents ready — ${parts.join(", ")}.`, result };
  });

export const demoSeedActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { maxSteps?: number }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { seedDemoActivity } = await import("@/lib/demo-agents/seed.server");
    const maxSteps = Math.min(Math.max(data.maxSteps ?? 4, 1), 8);
    const result = await seedDemoActivity(maxSteps);
    await logAdmin(admin, context.userId, null, "demo_seed_activity", null, null, {
      steps: result.ran.length,
      remaining: result.remaining,
    });
    return {
      success: true as const,
      message: `Ran ${result.ran.length} seed step(s). ${result.remaining} of ${result.totalSteps} remaining.`,
      result,
    };
  });

export const demoRunOnce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId?: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { rateLimit } = await import("@/lib/agent-api.server");
    if (!(await rateLimit("demo_manual_run", context.userId, 30, 3600))) {
      return {
        success: false as const,
        message: "Too many manual runs this hour. Wait before retrying.",
        outcome: null,
      };
    }
    const { runOneDemoAction } = await import("@/lib/demo-agents/runner.server");
    const outcome = await runOneDemoAction({
      triggerType: "manual",
      ...(data.agentId ? { agentId: data.agentId } : {}),
    });
    await logAdmin(admin, context.userId, data.agentId ?? null, "demo_run_once", null, null, {
      status: outcome.status,
      code: outcome.code,
    });
    return { success: outcome.status !== "blocked", message: outcome.message, outcome };
  });

export const demoSetAgentEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; enabled: boolean }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { data: current } = await admin
      .from("demo_agent_configs")
      .select("id, enabled")
      .eq("agent_id", data.agentId)
      .maybeSingle();
    if (!current)
      return { success: false as const, message: "That demo agent has no configuration." };
    await admin.from("demo_agent_configs").update({ enabled: data.enabled }).eq("id", current.id);
    await logAdmin(
      admin,
      context.userId,
      data.agentId,
      data.enabled ? "demo_agent_enable" : "demo_agent_pause",
      null,
      { enabled: current.enabled },
      { enabled: data.enabled },
    );
    return {
      success: true as const,
      message: data.enabled ? "Demo agent enabled." : "Demo agent paused.",
    };
  });

export const demoUpdateAgentProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; currentProject: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const project = data.currentProject.trim();
    if (project.length < 5 || project.length > 200) {
      return {
        success: false as const,
        message: "The current project must be 5 to 200 characters.",
      };
    }
    const { data: current } = await admin
      .from("demo_agent_configs")
      .select("id, current_project, persona_key")
      .eq("agent_id", data.agentId)
      .maybeSingle();
    if (!current)
      return { success: false as const, message: "That demo agent has no configuration." };

    // Rebuild the private system prompt so the persona and its project stay consistent.
    const { findPersona, buildSystemPrompt } = await import("@/lib/demo-agents/personas.server");
    const persona = findPersona(current.persona_key);
    const update: Record<string, unknown> = { current_project: project };
    if (persona) update["system_prompt"] = buildSystemPrompt(persona, project);

    await admin
      .from("demo_agent_configs")
      .update(update as never)
      .eq("id", current.id);
    await logAdmin(
      admin,
      context.userId,
      data.agentId,
      "demo_agent_project",
      null,
      { current_project: current.current_project },
      { current_project: project },
    );
    return { success: true as const, message: "Current project updated." };
  });

export const demoResetCooldown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string }) => input)
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    await admin
      .from("demo_agent_configs")
      .update({ last_run_at: null })
      .eq("agent_id", data.agentId);
    await logAdmin(admin, context.userId, data.agentId, "demo_reset_cooldown", null, null, null);
    return { success: true as const, message: "Cooldown reset." };
  });
