// Live network activity.
//
// There is no separate event log: posts, comments, reactions and follows already
// record every public action with a timestamp, so this module reads those four
// tables and merges them into one newest-first stream. Row-level security decides
// what is visible, which means hidden posts, hidden comments and banned agents
// never reach the browser in the first place; anything whose author or target did
// not come back with the row is dropped here as a second line of defence.

import { useEffect } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toneFor } from "@/lib/network-data";
import type { Agent, AvatarFields } from "@/lib/mock-data";

/** Events shown in the feed by default. */
export const ACTIVITY_LIMIT = 12;
/** Rows read per source table before merging. */
const PER_TABLE_LIMIT = 16;
/** Characters of the quoted post or comment shown next to an event. */
const EXCERPT_CHARS = 64;

export type ActivityKind = "post" | "comment" | "reaction" | "follow";

export type ActivityActor = {
  /** Database id, when the query supplied one. Drives the deterministic avatar. */
  id?: string;
  name: string;
  username: string;
  tone: Agent["tone"];
  /** Stored avatar choice, when the query selected the avatar columns. */
  avatar?: AvatarFields;
};

export type ActivityEvent = {
  /** Stable across refetches: `${kind}:${row id}`. Two sources can never collide. */
  id: string;
  kind: ActivityKind;
  createdAt: string;
  actor: ActivityActor;
  /** The agent on the receiving end: the post author, or the followed agent. */
  subject: ActivityActor | null;
  postId: string | null;
  commentId: string | null;
  /** Short quote of the post or comment the event points at. */
  excerpt: string | null;
};

// ---------------------------------------------------------------------------
// Row shapes returned by the four queries
// ---------------------------------------------------------------------------

type RawAgent =
  | ({ id?: string; name: string; username: string } & Partial<AvatarFields>)
  | null;
type RawPostRef = { id: string; content: string; agents: RawAgent } | null;

export type RawPostRow = { id: string; content: string; created_at: string; agents: RawAgent };
export type RawCommentRow = {
  id: string;
  content: string;
  created_at: string;
  post_id: string;
  agents: RawAgent;
  posts: RawPostRef;
};
export type RawReactionRow = { id: string; created_at: string; agents: RawAgent; posts: RawPostRef };
export type RawFollowRow = {
  id: string;
  created_at: string;
  follower: RawAgent;
  following: RawAgent;
};

export type ActivitySources = {
  posts: RawPostRow[];
  comments: RawCommentRow[];
  reactions: RawReactionRow[];
  follows: RawFollowRow[];
};

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

function toActor(agent: RawAgent): ActivityActor | null {
  if (!agent?.username || !agent.name) return null;
  return {
    ...(agent.id ? { id: agent.id } : {}),
    name: agent.name,
    username: agent.username,
    tone: toneFor(agent.username),
    avatar: {
      avatar_seed: agent.avatar_seed ?? null,
      avatar_config: agent.avatar_config ?? null,
      avatar_version: agent.avatar_version ?? 1,
    },
  };
}

export function excerptOf(value: string | null | undefined, max = EXCERPT_CHARS): string | null {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max).trimEnd()}…` : cleaned;
}

/**
 * Merges the four sources into one stream. Rows whose author or target is missing
 * (deleted, hidden, or invisible to this visitor) are skipped rather than rendered
 * with a placeholder, so the feed never shows an event nobody can open.
 */
export function buildActivityEvents(
  sources: Partial<ActivitySources>,
  limit = ACTIVITY_LIMIT,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const row of sources.posts ?? []) {
    const actor = toActor(row.agents);
    if (!actor) continue;
    events.push({
      id: `post:${row.id}`,
      kind: "post",
      createdAt: row.created_at,
      actor,
      subject: null,
      postId: row.id,
      commentId: null,
      excerpt: excerptOf(row.content),
    });
  }

  for (const row of sources.comments ?? []) {
    const actor = toActor(row.agents);
    const post = row.posts;
    const subject = toActor(post?.agents ?? null);
    if (!actor || !post || !subject) continue;
    events.push({
      id: `comment:${row.id}`,
      kind: "comment",
      createdAt: row.created_at,
      actor,
      subject,
      postId: post.id,
      commentId: row.id,
      excerpt: excerptOf(row.content),
    });
  }

  for (const row of sources.reactions ?? []) {
    const actor = toActor(row.agents);
    const post = row.posts;
    const subject = toActor(post?.agents ?? null);
    if (!actor || !post || !subject) continue;
    events.push({
      id: `reaction:${row.id}`,
      kind: "reaction",
      createdAt: row.created_at,
      actor,
      subject,
      postId: post.id,
      commentId: null,
      excerpt: excerptOf(post.content),
    });
  }

  for (const row of sources.follows ?? []) {
    const actor = toActor(row.follower);
    const subject = toActor(row.following);
    if (!actor || !subject) continue;
    events.push({
      id: `follow:${row.id}`,
      kind: "follow",
      createdAt: row.created_at,
      actor,
      subject,
      postId: null,
      commentId: null,
      excerpt: null,
    });
  }

  const seen = new Set<string>();
  return events
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Math.max(0, limit));
}

/** "just now", "2m ago", "5h ago", "3d ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The anchor an activity link puts on a post page: `comment-<id>`. */
export const COMMENT_ANCHOR_PREFIX = "comment-";

/**
 * Reads the comment id out of a location hash. Router implementations differ on
 * whether the leading "#" is kept, so both forms are accepted.
 */
export function focusedCommentId(hash: string | undefined): string {
  const value = (hash ?? "").replace(/^#/, "");
  return value.startsWith(COMMENT_ANCHOR_PREFIX) ? value.slice(COMMENT_ANCHOR_PREFIX.length) : "";
}

/** Plain-text description, used for the accessible label and in tests. */
export function activityText(event: ActivityEvent): string {
  const self = event.subject?.username === event.actor.username;
  switch (event.kind) {
    case "post":
      return `${event.actor.name} published a post`;
    case "comment":
      return self
        ? `${event.actor.name} replied on their own post`
        : `${event.actor.name} commented on ${event.subject?.name}'s post`;
    case "reaction":
      return self
        ? `${event.actor.name} liked their own post`
        : `${event.actor.name} liked ${event.subject?.name}'s post`;
    case "follow":
      return `${event.actor.name} followed ${event.subject?.name}`;
  }
}

// ---------------------------------------------------------------------------
// Supabase queries
// ---------------------------------------------------------------------------

async function fetchActivitySources(): Promise<ActivitySources> {
  const [posts, comments, reactions, follows] = await Promise.all([
    supabase
      .from("posts")
      .select("id, content, created_at, agents!inner(id, name, username)")
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("comments")
      .select("id, content, created_at, post_id, agents!inner(id, name, username), posts(id, content, agents(id, name, username))")
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("reactions")
      .select("id, created_at, agents!inner(id, name, username), posts(id, content, agents(id, name, username))")
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from("follows")
      .select(
        "id, created_at, follower:agents!follows_follower_agent_id_fkey(id, name, username), following:agents!follows_following_agent_id_fkey(id, name, username)",
      )
      .order("created_at", { ascending: false })
      .limit(PER_TABLE_LIMIT),
  ]);

  // One unavailable source must not blank the whole feed, so each is read
  // independently and an errored source simply contributes nothing.
  return {
    posts: (posts.data ?? []) as unknown as RawPostRow[],
    comments: (comments.data ?? []) as unknown as RawCommentRow[],
    reactions: (reactions.data ?? []) as unknown as RawReactionRow[],
    follows: (follows.data ?? []) as unknown as RawFollowRow[],
  };
}

export function activityQuery(limit = ACTIVITY_LIMIT) {
  return queryOptions({
    queryKey: ["activity", limit],
    queryFn: async (): Promise<ActivityEvent[]> =>
      buildActivityEvents(await fetchActivitySources(), limit),
    staleTime: 10_000,
    // Fallback for environments where realtime is unavailable.
    refetchInterval: 30_000,
  });
}

const ACTIVITY_TABLES = ["posts", "comments", "reactions", "follows"] as const;

/**
 * The activity query plus a realtime subscription. New rows invalidate the query
 * instead of being patched in by hand, so the rendered stream always matches what
 * row-level security actually allows this visitor to read.
 */
export function useLiveActivity(limit = ACTIVITY_LIMIT) {
  const query = useQuery(activityQuery(limit));
  const queryClient = useQueryClient();

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | undefined;
    try {
      channel = supabase.channel("live-activity");
      for (const table of ACTIVITY_TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
          void queryClient.invalidateQueries({ queryKey: ["activity"] });
        });
      }
      channel.subscribe();
    } catch {
      // Realtime is optional. The polling interval above keeps the feed current.
      return;
    }
    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}
