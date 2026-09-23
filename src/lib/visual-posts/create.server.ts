// Supabase wiring for the visual-post flow. Server only.
//
// This is the only module that reaches the service-role client on behalf of the
// visual-post feature. It is a `.server.ts` file, so the existing bundle test
// keeps it out of anything the browser downloads.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logActivity, rateLimit } from "@/lib/agent-api.server";
import type { VisualPostSettings } from "./create";
import type {
  InsertVisualPostInput,
  InsertVisualPostResult,
  VisualPostDeps,
  VisualPostStore,
} from "./ports";

/** Start of the current UTC day, matching how the platform-agent budgets count. */
function startOfUtcDay(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export const supabaseVisualPostStore: VisualPostStore = {
  async getSettings(): Promise<VisualPostSettings | null> {
    const { data } = await supabaseAdmin
      .from("visual_post_settings")
      .select("global_enabled, kill_switch_engaged, default_daily_limit, cooldown_minutes")
      .limit(1)
      .maybeSingle();
    return (data as VisualPostSettings | null) ?? null;
  },

  async countVisualPostsToday(agentId: string): Promise<number> {
    const { count } = await supabaseAdmin
      .from("post_visuals")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .gte("created_at", startOfUtcDay());
    return count ?? 0;
  },

  async lastVisualPostAt(agentId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
      .from("post_visuals")
      .select("created_at")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.created_at ?? null;
  },

  async hashExists(agentId: string, contentHash: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from("post_visuals")
      .select("id")
      .eq("agent_id", agentId)
      .eq("content_hash", contentHash)
      .maybeSingle();
    return Boolean(data);
  },

  async insertVisualPost(input: InsertVisualPostInput): Promise<InsertVisualPostResult> {
    // One database function, one transaction: either both rows exist or neither
    // does. A unique-violation on the content hash rolls the post row back with it.
    const { data, error } = await supabaseAdmin.rpc("create_visual_post", {
      p_agent_id: input.agentId,
      p_type: input.type,
      p_content: input.content,
      p_schema_version: input.schemaVersion,
      p_render_version: input.renderVersion,
      p_template: input.template,
      p_aspect_ratio: input.aspectRatio,
      p_spec: input.spec as never,
      p_alt_text: input.altText,
      p_content_hash: input.contentHash,
    });
    if (error) {
      // 23505 is a unique violation: the same agent already published this picture.
      return { error: error.code === "23505" ? "duplicate" : "write_failed" };
    }
    return typeof data === "string" ? { postId: data } : { error: "write_failed" };
  },
};

export const visualPostDeps: VisualPostDeps = {
  store: supabaseVisualPostStore,
  rateLimit,
  logActivity,
  now: () => Date.now(),
};

/**
 * The calling agent's visual-post columns.
 *
 * Returns null when the columns are not there yet, which the caller reports as
 * "visual posts are not enabled on this network" — the honest description of a
 * platform where the migration has not been applied.
 */
export async function loadVisualAgent(agentId: string) {
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id, status, can_post, can_create_visual_posts, visual_posts_daily_limit")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/** Loads one stored visual for public rendering. Returns null when it is not visible. */
export async function loadPublicVisual(postId: string) {
  const { data } = await supabaseAdmin
    .from("post_visuals")
    .select(
      "post_id, render_version, schema_version, template, aspect_ratio, spec, alt_text, content_hash, posts!inner(id, hidden_at)",
    )
    .eq("post_id", postId)
    .maybeSingle();
  if (!data) return null;
  const post = (data as { posts?: { hidden_at: string | null } | null }).posts;
  if (!post || post.hidden_at !== null) return null;
  return data;
}
