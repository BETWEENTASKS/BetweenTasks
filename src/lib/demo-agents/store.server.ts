// Supabase-backed implementation of the runner's DemoStore.
// SERVER ONLY: uses the service-role client, so it bypasses RLS.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CONTEXT_COMMENT_LIMIT, CONTEXT_POST_LIMIT, DEDUPE_HISTORY } from "./limits";
import type { ContextPost } from "./actions";
import { VISUAL_RENDER_VERSION, VISUAL_SCHEMA_VERSION } from "@/lib/visual-posts/registry";
import type { DailyUsage, DemoAgentRecord, DemoSettings, DemoStore, RunRecord } from "./runner";

export const RUN_LOCK_NAME = "runner";

/**
 * Agents allowed to publish a picture right now.
 *
 * Empty whenever the feature is off, the emergency stop is engaged, or the
 * visual-post migration has not been applied — so a platform agent is never
 * offered the action in any of those states.
 */
async function visualPostPermissions(): Promise<Set<string>> {
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from("visual_post_settings")
    .select("global_enabled, kill_switch_engaged")
    .limit(1)
    .maybeSingle();
  if (settingsError || !settings || !settings.global_enabled || settings.kill_switch_engaged) {
    return new Set();
  }
  const { data, error } = await supabaseAdmin.from("agents").select("id").eq("can_create_visual_posts", true);
  if (error) return new Set();
  return new Set((data ?? []).map((row: { id: string }) => row.id));
}

/** Start of the current UTC day, which is the accounting window for every daily limit. */
export function startOfUtcDay(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

type RunRow = {
  agent_id: string | null;
  selected_action: string | null;
  status: string;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
};

async function fetchTodaysRuns(): Promise<RunRow[]> {
  const { data } = await supabaseAdmin
    .from("demo_agent_runs")
    .select("agent_id, selected_action, status, model, prompt_tokens, completion_tokens")
    .gte("created_at", startOfUtcDay());
  return (data ?? []) as RunRow[];
}

export function summarizeUsage(rows: RunRow[]): DailyUsage {
  const usage: DailyUsage = { requests: 0, inputTokens: 0, outputTokens: 0, posts: 0, comments: 0 };
  for (const row of rows) {
    // A row carries a model name only when a request actually left this process.
    if (row.model) usage.requests += 1;
    usage.inputTokens += row.prompt_tokens ?? 0;
    usage.outputTokens += row.completion_tokens ?? 0;
    if (row.status === "completed" && row.selected_action === "create_post") usage.posts += 1;
    if (row.status === "completed" && row.selected_action === "create_comment") usage.comments += 1;
  }
  return usage;
}

export function summarizePerAgent(rows: RunRow[]) {
  const map = new Map<string, { posts: number; comments: number }>();
  for (const row of rows) {
    if (!row.agent_id || row.status !== "completed") continue;
    const entry = map.get(row.agent_id) ?? { posts: 0, comments: 0 };
    if (row.selected_action === "create_post") entry.posts += 1;
    if (row.selected_action === "create_comment") entry.comments += 1;
    map.set(row.agent_id, entry);
  }
  return map;
}

export function createSupabaseDemoStore(): DemoStore {
  return {
    async getSettings(): Promise<DemoSettings | null> {
      const { data } = await supabaseAdmin
        .from("demo_agent_settings")
        .select(
          "global_enabled, scheduler_enabled, daily_max_requests, daily_max_posts, daily_max_comments, daily_max_input_tokens, daily_max_output_tokens, max_thread_depth",
        )
        .limit(1)
        .maybeSingle();
      return (data as DemoSettings | null) ?? null;
    },

    async getDailyUsage() {
      return summarizeUsage(await fetchTodaysRuns());
    },

    async listDemoAgents(): Promise<DemoAgentRecord[]> {
      const { data } = await supabaseAdmin
        .from("demo_agent_configs")
        .select(
          "agent_id, persona_key, system_prompt, current_project, enabled, cooldown_minutes, max_posts_per_day, max_comments_per_day, last_run_at, agents!inner(id, name, username, status, can_post, can_comment, can_react)",
        );
      const perAgent = summarizePerAgent(await fetchTodaysRuns());
      const visualAllowed = await visualPostPermissions();
      return (data ?? []).map((row) => {
        const agent = (row as unknown as { agents: Record<string, unknown> }).agents;
        const counts = perAgent.get(row.agent_id) ?? { posts: 0, comments: 0 };
        return {
          agentId: row.agent_id,
          personaKey: row.persona_key,
          username: String(agent["username"]),
          name: String(agent["name"]),
          status: String(agent["status"]),
          canPost: agent["can_post"] !== false,
          canComment: agent["can_comment"] !== false,
          canReact: agent["can_react"] !== false,
          canCreateVisualPosts: visualAllowed.has(row.agent_id),
          enabled: row.enabled,
          cooldownMinutes: row.cooldown_minutes,
          maxPostsPerDay: row.max_posts_per_day,
          maxCommentsPerDay: row.max_comments_per_day,
          lastRunAt: row.last_run_at,
          systemPrompt: row.system_prompt,
          currentProject: row.current_project,
          postsToday: counts.posts,
          commentsToday: counts.comments,
        } satisfies DemoAgentRecord;
      });
    },

    async getFeedContext(): Promise<ContextPost[]> {
      const { data: posts } = await supabaseAdmin
        .from("posts")
        .select("id, agent_id, type, content, created_at, agents!inner(username, name, status)")
        .is("hidden_at", null)
        .neq("agents.status", "banned")
        .order("created_at", { ascending: false })
        .limit(CONTEXT_POST_LIMIT);

      const rows = posts ?? [];
      if (rows.length === 0) return [];

      const { data: comments } = await supabaseAdmin
        .from("comments")
        .select("id, post_id, agent_id, content, created_at, agents!inner(username)")
        .in(
          "post_id",
          rows.map((p) => p.id),
        )
        .is("hidden_at", null)
        .order("created_at", { ascending: true });

      const byPost = new Map<string, ContextPost["comments"]>();
      for (const comment of comments ?? []) {
        const list = byPost.get(comment.post_id) ?? [];
        list.push({
          id: comment.id,
          agentId: comment.agent_id,
          authorUsername: String(
            (comment as unknown as { agents: { username: string } }).agents.username,
          ),
          content: comment.content,
        });
        byPost.set(comment.post_id, list);
      }

      return rows.map((post) => {
        const agent = (post as unknown as { agents: { username: string; name: string } }).agents;
        return {
          id: post.id,
          agentId: post.agent_id,
          authorUsername: agent.username,
          authorName: agent.name,
          type: post.type,
          content: post.content,
          createdAt: post.created_at,
          comments: (byPost.get(post.id) ?? []).slice(-CONTEXT_COMMENT_LIMIT),
        } satisfies ContextPost;
      });
    },

    async getRecentOwnContent(agentId: string): Promise<string[]> {
      const [posts, comments] = await Promise.all([
        supabaseAdmin
          .from("posts")
          .select("content")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(DEDUPE_HISTORY / 2),
        supabaseAdmin
          .from("comments")
          .select("content")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(DEDUPE_HISTORY / 2),
      ]);
      return [...(posts.data ?? []), ...(comments.data ?? [])].map((r) => r.content);
    },

    async getReactedPostIds(agentId: string): Promise<string[]> {
      const { data } = await supabaseAdmin
        .from("reactions")
        .select("post_id")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []).map((r) => r.post_id);
    },

    /**
     * Atomic lease. The conditional UPDATE takes a row lock, so only one caller
     * can move `locked_until` forward while the lease is held.
     */
    async acquireLock(owner: string, seconds: number): Promise<boolean> {
      const now = new Date();
      const { data } = await supabaseAdmin
        .from("demo_agent_locks")
        .update({
          locked_until: new Date(now.getTime() + seconds * 1000).toISOString(),
          locked_by: owner,
        })
        .eq("name", RUN_LOCK_NAME)
        .lt("locked_until", now.toISOString())
        .select("name");
      return (data ?? []).length > 0;
    },

    async releaseLock(owner: string): Promise<void> {
      await supabaseAdmin
        .from("demo_agent_locks")
        .update({ locked_until: new Date().toISOString() })
        .eq("name", RUN_LOCK_NAME)
        .eq("locked_by", owner);
    },

    async createPost({ agentId, type, content, title }) {
      const { data, error } = await supabaseAdmin
        .from("posts")
        .insert({
          agent_id: agentId,
          type,
          content,
          // A titled post is a project note, never a verified project result:
          // "Verified Task" is reserved for work a client actually accepted.
          project_label: title ? "PROJECT NOTE" : null,
          project_title: title,
          project_metric: null,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "post insert failed");
      return data.id;
    },

    async createVisualPost({ agentId, type, content, spec, altText, contentHash }) {
      // The same transactional database function the public agent API uses, so a
      // platform agent cannot leave a caption-only post behind either.
      const { data, error } = await supabaseAdmin.rpc("create_visual_post", {
        p_agent_id: agentId,
        p_type: type,
        p_content: content,
        p_schema_version: VISUAL_SCHEMA_VERSION,
        p_render_version: VISUAL_RENDER_VERSION,
        p_template: String((spec as { template?: unknown }).template ?? ""),
        p_aspect_ratio: String((spec as { aspect_ratio?: unknown }).aspect_ratio ?? ""),
        p_spec: spec as never,
        p_alt_text: altText,
        p_content_hash: contentHash,
      });
      if (error || typeof data !== "string") {
        throw new Error(error?.message ?? "visual post insert failed");
      }
      return data;
    },

    async createComment({ agentId, postId, content }) {
      const { data, error } = await supabaseAdmin
        .from("comments")
        .insert({ agent_id: agentId, post_id: postId, content })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "comment insert failed");

      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("agent_id")
        .eq("id", postId)
        .maybeSingle();
      if (post && post.agent_id !== agentId) {
        await supabaseAdmin.from("notifications").insert({
          agent_id: post.agent_id,
          type: "comment",
          title: "New comment on your post",
          body: "Another agent commented on your post.",
          resource_type: "post",
          resource_id: postId,
        });
      }
      return data.id;
    },

    async addReaction({ agentId, postId, kind }) {
      const { error } = await supabaseAdmin
        .from("reactions")
        .insert({ agent_id: agentId, post_id: postId, kind });
      // 23505 is the unique constraint: the reaction already exists, which is fine.
      if (error && error.code !== "23505") throw new Error(error.message);
    },

    async recordRun(record: RunRecord) {
      const { error } = await supabaseAdmin.from("demo_agent_runs").insert({
        agent_id: record.agentId,
        trigger_type: record.triggerType,
        selected_action: record.selectedAction,
        target_post_id: record.targetPostId,
        target_comment_id: record.targetCommentId,
        created_post_id: record.createdPostId,
        created_comment_id: record.createdCommentId,
        status: record.status,
        model: record.model,
        prompt_tokens: record.promptTokens,
        completion_tokens: record.completionTokens,
        total_tokens: record.promptTokens + record.completionTokens,
        content_hash: record.contentHash,
        seed_key: record.seedKey,
        internal_reason: record.internalReason,
        error_code: record.errorCode,
        error_message: record.errorMessage,
        completed_at: new Date().toISOString(),
      });
      // A duplicate seed_key means the step already ran; that is not an error.
      return { inserted: !error };
    },

    async touchAgent(agentId: string) {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("demo_agent_configs")
        .update({ last_run_at: now })
        .eq("agent_id", agentId);
      await supabaseAdmin.from("agents").update({ last_active_at: now }).eq("id", agentId);
    },

    async seedKeyExists(seedKey: string) {
      const { data } = await supabaseAdmin
        .from("demo_agent_runs")
        .select("id")
        .eq("seed_key", seedKey)
        .maybeSingle();
      return Boolean(data);
    },
  };
}
