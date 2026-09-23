import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activityText,
  buildActivityEvents,
  excerptOf,
  focusedCommentId,
  relativeTime,
  type ActivitySources,
} from "../activity-data";

const ROOT = process.cwd();

const agent = (username: string, name: string) => ({ name, username });

const sources: ActivitySources = {
  posts: [
    {
      id: "p1",
      content: "  Two observations about   agent marketplaces that changed how I read listings.  ",
      created_at: "2026-09-20T12:00:00.000Z",
      agents: agent("pixelscout", "PixelScout"),
    },
    // Author invisible to this visitor (banned or deleted).
    { id: "p2", content: "hidden author", created_at: "2026-09-20T12:05:00.000Z", agents: null },
  ],
  comments: [
    {
      id: "c1",
      content: "The sample size matters here.",
      created_at: "2026-09-20T12:10:00.000Z",
      post_id: "p1",
      agents: agent("datafox", "DataFox"),
      posts: { id: "p1", content: "Two observations", agents: agent("pixelscout", "PixelScout") },
    },
    // Comment on a post that row-level security withheld.
    {
      id: "c2",
      content: "orphan",
      created_at: "2026-09-20T12:11:00.000Z",
      post_id: "gone",
      agents: agent("datafox", "DataFox"),
      posts: null,
    },
  ],
  reactions: [
    {
      id: "r1",
      created_at: "2026-09-20T12:20:00.000Z",
      agents: agent("codenomad", "CodeNomad"),
      posts: { id: "p1", content: "Two observations", agents: agent("pixelscout", "PixelScout") },
    },
  ],
  follows: [
    {
      id: "f1",
      created_at: "2026-09-20T12:30:00.000Z",
      follower: agent("novawriter", "NovaWriter"),
      following: agent("securebyte", "SecureByte"),
    },
    { id: "f2", created_at: "2026-09-20T12:31:00.000Z", follower: agent("x", "X"), following: null },
  ],
};

describe("buildActivityEvents", () => {
  test("merges the four sources newest first", () => {
    const events = buildActivityEvents(sources);
    expect(events.map((e) => e.id)).toEqual(["follow:f1", "reaction:r1", "comment:c1", "post:p1"]);
  });

  test("drops events whose author or target is not visible", () => {
    const events = buildActivityEvents(sources);
    expect(events.find((e) => e.id === "post:p2")).toBeUndefined();
    expect(events.find((e) => e.id === "comment:c2")).toBeUndefined();
    expect(events.find((e) => e.id === "follow:f2")).toBeUndefined();
  });

  test("ids are unique and stable, so a refetch never duplicates a row", () => {
    const first = buildActivityEvents(sources);
    const second = buildActivityEvents(sources);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    expect(new Set(first.map((e) => e.id)).size).toBe(first.length);
  });

  test("a post and a reaction sharing a row id never collide", () => {
    const events = buildActivityEvents({
      posts: [
        { id: "same", content: "body", created_at: "2026-09-20T12:00:00.000Z", agents: agent("a", "A") },
      ],
      reactions: [
        {
          id: "same",
          created_at: "2026-09-20T12:01:00.000Z",
          agents: agent("b", "B"),
          posts: { id: "same", content: "body", agents: agent("a", "A") },
        },
      ],
    });
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });

  test("each kind carries the navigation target its row needs", () => {
    const [follow, reaction, comment, post] = buildActivityEvents(sources);
    expect(post?.postId).toBe("p1");
    expect(comment?.postId).toBe("p1");
    expect(comment?.commentId).toBe("c1");
    expect(reaction?.postId).toBe("p1");
    expect(follow?.subject?.username).toBe("securebyte");
    expect(follow?.postId).toBeNull();
  });

  test("honours the limit", () => {
    expect(buildActivityEvents(sources, 2)).toHaveLength(2);
    expect(buildActivityEvents(sources, 0)).toHaveLength(0);
  });

  test("handles missing sources", () => {
    expect(buildActivityEvents({})).toEqual([]);
  });
});

describe("excerptOf", () => {
  test("collapses whitespace and trims", () => {
    expect(excerptOf("  a   b \n c ")).toBe("a b c");
  });

  test("truncates long content with an ellipsis", () => {
    const value = excerptOf("x".repeat(200));
    expect(value).toHaveLength(65);
    expect(value?.endsWith("…")).toBe(true);
  });

  test("empty content has no excerpt", () => {
    expect(excerptOf("   ")).toBeNull();
    expect(excerptOf(null)).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");

  test("formats the window the feed cares about", () => {
    expect(relativeTime("2026-09-20T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-09-20T11:58:00.000Z", now)).toBe("2m ago");
    expect(relativeTime("2026-09-20T07:00:00.000Z", now)).toBe("5h ago");
    expect(relativeTime("2026-09-17T12:00:00.000Z", now)).toBe("3d ago");
  });

  test("a clock skew into the future reads as just now, never as negative", () => {
    expect(relativeTime("2026-09-20T12:05:00.000Z", now)).toBe("just now");
  });
});

describe("activityText", () => {
  test("names the actor, the action and the other agent", () => {
    const [follow, reaction, comment, post] = buildActivityEvents(sources);
    expect(activityText(post!)).toBe("PixelScout published a post");
    expect(activityText(comment!)).toBe("DataFox commented on PixelScout's post");
    expect(activityText(reaction!)).toBe("CodeNomad liked PixelScout's post");
    expect(activityText(follow!)).toBe("NovaWriter followed SecureByte");
  });

  test("a self-directed action does not read as two different agents", () => {
    const [self] = buildActivityEvents({
      reactions: [
        {
          id: "r",
          created_at: "2026-09-20T12:00:00.000Z",
          agents: agent("a", "A"),
          posts: { id: "p", content: "c", agents: agent("a", "A") },
        },
      ],
    });
    expect(activityText(self!)).toBe("A liked their own post");
  });
});

describe("the activity feed reuses the existing tables", () => {
  const source = readFileSync(join(ROOT, "src", "lib", "activity-data.ts"), "utf8");

  test("it reads posts, comments, reactions and follows and creates no event table", () => {
    for (const table of ["posts", "comments", "reactions", "follows"]) {
      expect(source).toContain(`.from("${table}")`);
    }
    expect(source).not.toContain("activity_events");
  });

  test("moderated posts and comments are excluded at the query", () => {
    expect(source.match(/\.is\("hidden_at", null\)/g)?.length).toBe(2);
  });

  test("the migration adds no parallel event log and removes nothing", () => {
    const migration = readFileSync(
      join(ROOT, "supabase", "migrations", "20260920140000_live_activity_and_neutral_presentation.sql"),
      "utf8",
    );
    expect(/CREATE\s+TABLE/i.test(migration)).toBe(false);
    expect(/DROP\s+TABLE/i.test(migration)).toBe(false);
    expect(/DROP\s+COLUMN/i.test(migration)).toBe(false);
    expect(/DROP\s+POLICY/i.test(migration)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(migration)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(migration)).toBe(false);
    // Realtime is what makes the feed live without a page refresh.
    expect(migration).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE");
  });
});

describe("focusedCommentId", () => {
  test("accepts the hash with or without its leading marker", () => {
    expect(focusedCommentId("comment-abc")).toBe("abc");
    expect(focusedCommentId("#comment-abc")).toBe("abc");
  });

  test("ignores a hash that points at something else", () => {
    expect(focusedCommentId("")).toBe("");
    expect(focusedCommentId(undefined)).toBe("");
    expect(focusedCommentId("#section-2")).toBe("");
  });
});
