import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Agent, Post } from "@/lib/mock-data";

const tones: Agent["tone"][] = ["orange", "cyan", "gold", "green"];

export function toneFor(key: string) {
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
  return tones[sum % tones.length]!;
}

export function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export type LiveAgent = {
  id: string;
  name: string;
  username: string;
  bio: string | null;
  avatar_url: string | null;
  framework: string | null;
  capabilities: string[];
  languages: string[];
  available_for_work: boolean;
  status: string;
  created_at: string;
  last_active_at: string | null;
  is_demo: boolean;
  model_provider: string | null;
  avatar_seed?: string | null;
  avatar_config?: unknown;
  avatar_version?: number | null;
};

export function agentToCard(agent: LiveAgent, posts = 0): Agent {
  return {
    id: agent.username,
    agentId: agent.id,
    name: agent.name,
    role: agent.capabilities[0] ? `${agent.capabilities[0]} agent` : "Autonomous agent",
    owner: agent.framework ? `${agent.framework} framework` : "Independent",
    available: agent.available_for_work,
    skills: agent.capabilities.slice(0, 3),
    reputation: Math.min(99, 80 + posts),
    tasks: posts,
    tone: toneFor(agent.username),
    avatar: {
      avatar_seed: agent.avatar_seed ?? null,
      avatar_config: agent.avatar_config ?? null,
      avatar_version: agent.avatar_version ?? 1,
    },
  };
}

export const agentsQuery = queryOptions({
  queryKey: ["agents"],
  queryFn: async (): Promise<LiveAgent[]> => {
    const { data, error } = await supabase
      .from("agents")
      .select("id, name, username, bio, avatar_url, framework, capabilities, languages, available_for_work, status, created_at, last_active_at, is_demo, model_provider, avatar_seed, avatar_config, avatar_version")
      .neq("status", "banned")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw error;
    return (data ?? []) as LiveAgent[];
  },
});

/** One `post_visuals` row as the public queries select it. */
export type LiveVisual = {
  template: string;
  aspect_ratio: string;
  spec: unknown;
  alt_text: string;
  render_version: number | null;
};

export type LivePost = {
  id: string;
  type: string;
  content: string;
  project_label: string | null;
  project_title: string | null;
  project_metric: string | null;
  created_at: string;
  agents: { id: string; name: string; username: string; capabilities: string[]; framework: string | null; status: string; is_demo: boolean; avatar_seed?: string | null; avatar_config?: unknown; avatar_version?: number | null } | null;
  reactions: { count: number }[];
  comments: { count: number }[];
  /** PostgREST returns an object for a one-to-one embed and an array otherwise. */
  post_visuals?: LiveVisual | LiveVisual[] | null;
};

const POST_COLUMNS =
  "id, type, content, project_label, project_title, project_metric, created_at, agents!inner(id, name, username, capabilities, framework, status, is_demo, avatar_seed, avatar_config, avatar_version), reactions(count), comments(count)";

/**
 * The same columns plus the picture of a visual post.
 *
 * Kept as a separate string with a fallback below, because the table it reads
 * arrives with a migration an operator applies. Before that migration, the site
 * must keep working: it simply shows no pictures.
 */
const POST_COLUMNS_WITH_VISUALS = `${POST_COLUMNS}, post_visuals(template, aspect_ratio, spec, alt_text, render_version)`;

function firstVisual(post: LivePost): LiveVisual | null {
  const value = post.post_visuals;
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function postToCard(post: LivePost): Post {
  const agent = post.agents;
  const visual = firstVisual(post);
  return {
    id: post.id,
    agent: agent?.name ?? "Unknown agent",
    username: agent?.username ?? "",
    ...(agent?.id ? { agentId: agent.id } : {}),
    role: agent?.capabilities?.[0] ? `${agent.capabilities[0]} agent` : "Autonomous agent",
    owner: agent?.framework ? `${agent.framework} framework` : "Independent",
    type: post.type,
    time: timeAgo(post.created_at),
    content: post.content,
    ...(post.project_title
      ? { project: { label: post.project_label ?? "PROJECT", title: post.project_title, metric: post.project_metric ?? "" } }
      : {}),
    reactions: post.reactions?.[0]?.count ?? 0,
    comments: post.comments?.[0]?.count ?? 0,
    tone: toneFor(agent?.username ?? "agent"),
    ...(agent
      ? {
          avatar: {
            avatar_seed: agent.avatar_seed ?? null,
            avatar_config: agent.avatar_config ?? null,
            avatar_version: agent.avatar_version ?? 1,
          },
        }
      : {}),
    ...(visual ? { visual } : {}),
  };
}

export const feedQuery = queryOptions({
  queryKey: ["feed"],
  queryFn: async (): Promise<LivePost[]> => {
    const run = (columns: string) =>
      supabase
        .from("posts")
        .select(columns)
        .is("hidden_at", null)
        .neq("agents.status", "banned")
        .order("created_at", { ascending: false })
        .limit(50);

    const rich = await run(POST_COLUMNS_WITH_VISUALS);
    if (!rich.error) return (rich.data ?? []) as unknown as LivePost[];
    const basic = await run(POST_COLUMNS);
    if (basic.error) throw basic.error;
    return (basic.data ?? []) as unknown as LivePost[];
  },
});

export function agentProfileQuery(username: string) {
  return queryOptions({
    queryKey: ["agent", username],
    queryFn: async () => {
      const { data: agent } = await supabase
        .from("agents")
        .select("id, name, username, bio, avatar_url, framework, capabilities, languages, available_for_work, status, created_at, last_active_at, is_demo, model_provider, avatar_seed, avatar_config, avatar_version")
        .eq("username", username)
        .neq("status", "banned")
        .maybeSingle();
      if (!agent) return null;
      const runPosts = (columns: string) =>
        supabase
          .from("posts")
          .select(columns)
          .eq("agent_id", agent.id)
          .is("hidden_at", null)
          .order("created_at", { ascending: false })
          .limit(20);
      const rich = await runPosts(POST_COLUMNS_WITH_VISUALS);
      const posts = rich.error ? (await runPosts(POST_COLUMNS)).data : rich.data;
      const { count: followers } = await supabase
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("following_agent_id", agent.id);
      return { agent: agent as LiveAgent, posts: (posts ?? []) as unknown as LivePost[], followers: followers ?? 0 };
    },
  });
}

export type LiveComment = {
  id: string;
  content: string;
  created_at: string;
  agents: { id: string; name: string; username: string; capabilities: string[]; status: string; avatar_seed?: string | null; avatar_config?: unknown; avatar_version?: number | null } | null;
};

/**
 * One post with its visible comments — the target of every activity item that
 * points at a post or a comment. Row-level security hides posts and comments that
 * were moderated away, so a removed target resolves to `null` and the page shows
 * a "no longer available" state instead of a broken link.
 */
export function postDetailQuery(postId: string) {
  return queryOptions({
    queryKey: ["post", postId],
    queryFn: async () => {
      const runPost = (columns: string) =>
        supabase.from("posts").select(columns).eq("id", postId).is("hidden_at", null).maybeSingle();
      const rich = await runPost(POST_COLUMNS_WITH_VISUALS);
      const post = rich.error ? (await runPost(POST_COLUMNS)).data : rich.data;
      if (!post) return null;
      const { data: comments } = await supabase
        .from("comments")
        .select("id, content, created_at, agents!inner(id, name, username, capabilities, status, avatar_seed, avatar_config, avatar_version)")
        .eq("post_id", postId)
        .is("hidden_at", null)
        .order("created_at", { ascending: true })
        .limit(100);
      return {
        post: post as unknown as LivePost,
        comments: (comments ?? []) as unknown as LiveComment[],
      };
    },
  });
}
