import { describe, expect, test } from "bun:test";
import {
  contentHash,
  inspectContent,
  isFiller,
  normalizeForDedupe,
  parseModelAction,
  similarity,
  validateAction,
  type ModelAction,
  type ValidationContext,
} from "../actions";
import { MAX_POST_BODY } from "../limits";
import { LONG_BODY, LONG_COMMENT, makePost } from "./fakes";

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    agentId: "agent-1",
    personaKey: "pixelscout",
    allowedActions: ["create_post", "create_comment", "add_reaction", "skip"],
    maxThreadDepth: 6,
    posts: [makePost()],
    recentContent: [],
    reactedPostIds: [],
    ...overrides,
  };
}

function action(overrides: Partial<ModelAction> = {}): ModelAction {
  return {
    action: "skip",
    target_post_id: null,
    target_comment_id: null,
    post_type: null,
    title: null,
    body: null,
    reaction: null,
    internal_reason: "nothing to add",
    ...overrides,
  };
}

describe("parseModelAction", () => {
  test("rejects a non-JSON response", () => {
    const result = parseModelAction("I think I will write a post about research.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("malformed_json");
  });

  test("rejects an empty response", () => {
    expect(parseModelAction("").ok).toBe(false);
    expect(parseModelAction(undefined).ok).toBe(false);
  });

  test("rejects an unknown action name", () => {
    const result = parseModelAction(JSON.stringify({ action: "delete_everything" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("schema_mismatch");
  });

  test("rejects a response missing the action field", () => {
    expect(parseModelAction(JSON.stringify({ body: "hello" })).ok).toBe(false);
  });

  test("accepts a clean object and a fenced object", () => {
    expect(parseModelAction(JSON.stringify({ action: "skip" })).ok).toBe(true);
    expect(parseModelAction('```json\n{"action":"skip"}\n```').ok).toBe(true);
  });
});

describe("inspectContent", () => {
  test("blocks leaked credentials", () => {
    expect(inspectContent("here is my token bt_live_abcdefghijklmnop")?.code).toBe(
      "secret_detected",
    );
    expect(inspectContent("use sk-01234567890123456789 to call it")?.code).toBe("secret_detected");
    expect(inspectContent("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")?.code).toBe(
      "secret_detected",
    );
    expect(inspectContent("set DEEPSEEK_API_KEY before deploying")?.code).toBe("secret_detected");
  });

  test("blocks fabricated commercial claims", () => {
    expect(inspectContent("My clients keep asking for faster reports.")?.code).toBe(
      "fabricated_claim",
    );
    expect(inspectContent("I earned $4,200 on this project.")?.code).toBe("fabricated_claim");
    expect(inspectContent("Read the testimonial from the launch.")?.code).toBe("fabricated_claim");
    expect(inspectContent("I was hired by a logistics company last week.")?.code).toBe(
      "fabricated_claim",
    );
  });

  test("blocks contact details and outbound links", () => {
    expect(inspectContent("write to me at agent@example.com")?.code).toBe("contact_detail");
    expect(inspectContent("see https://example.com/report")?.code).toBe("contact_detail");
  });

  test("allows ordinary professional content", () => {
    expect(inspectContent(LONG_BODY)).toBeNull();
    expect(inspectContent(LONG_COMMENT)).toBeNull();
  });
});

describe("quality and duplicate detection", () => {
  test("filler is rejected", () => {
    expect(isFiller("Great insights!")).toBe(true);
    expect(isFiller("Totally agree")).toBe(true);
    expect(isFiller("+1")).toBe(true);
    expect(isFiller(LONG_BODY)).toBe(false);
  });

  test("normalization collapses cosmetic differences", () => {
    expect(normalizeForDedupe("Hello,  World!!")).toBe(normalizeForDedupe("hello world"));
    expect(contentHash("Hello, World!!")).toBe(contentHash("hello world"));
  });

  test("similarity spots a reworded repeat", () => {
    expect(similarity(LONG_BODY, LONG_BODY)).toBe(1);
    expect(similarity(LONG_BODY, LONG_COMMENT)).toBeLessThan(0.5);
  });
});

describe("validateAction", () => {
  test("rejects an action that was not offered for this run", () => {
    const result = validateAction(
      action({ action: "create_post", post_type: "Research", body: LONG_BODY }),
      ctx({ allowedActions: ["create_comment", "skip"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("action_not_allowed");
  });

  test("skip produces no content", () => {
    const result = validateAction(action(), ctx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.action).toBe("skip");
  });

  test("rejects an unsupported post type", () => {
    const result = validateAction(
      action({ action: "create_post", post_type: "Available for Work", body: LONG_BODY }),
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_post_type");
  });

  test("enforces body length limits", () => {
    const tooShort = validateAction(
      action({ action: "create_post", post_type: "Research", body: "short" }),
      ctx(),
    );
    expect(tooShort.ok).toBe(false);
    const tooLong = validateAction(
      action({ action: "create_post", post_type: "Research", body: "x".repeat(MAX_POST_BODY + 1) }),
      ctx(),
    );
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.code).toBe("invalid_length");
  });

  test("rejects a post that repeats the agent's recent output", () => {
    const result = validateAction(
      action({ action: "create_post", post_type: "Research", body: LONG_BODY }),
      ctx({ recentContent: [LONG_BODY] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate_content");
  });

  test("accepts a clean post and fingerprints it", () => {
    const result = validateAction(
      action({
        action: "create_post",
        post_type: "Research",
        title: "Profile readability",
        body: LONG_BODY,
      }),
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.plan.action === "create_post") {
      expect(result.plan.postType).toBe("Research");
      expect(result.plan.title).toBe("Profile readability");
      expect(result.plan.hash).toBe(contentHash(LONG_BODY));
    }
  });

  test("a comment needs a target that exists in the offered context", () => {
    const missing = validateAction(action({ action: "create_comment", body: LONG_COMMENT }), ctx());
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("missing_target");

    const unknown = validateAction(
      action({ action: "create_comment", target_post_id: "post-999", body: LONG_COMMENT }),
      ctx(),
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe("unknown_target");
  });

  test("an agent cannot comment on or react to its own post", () => {
    const own = ctx({ posts: [makePost({ agentId: "agent-1" })] });
    const comment = validateAction(
      action({ action: "create_comment", target_post_id: "post-1", body: LONG_COMMENT }),
      own,
    );
    expect(comment.ok).toBe(false);
    if (!comment.ok) expect(comment.code).toBe("self_reply");

    const reaction = validateAction(
      action({ action: "add_reaction", target_post_id: "post-1", reaction: "spark" }),
      own,
    );
    expect(reaction.ok).toBe(false);
    if (!reaction.ok) expect(reaction.code).toBe("self_reply");
  });

  test("thread depth is enforced", () => {
    const deep = ctx({
      maxThreadDepth: 2,
      posts: [
        makePost({
          comments: [
            { id: "c1", agentId: "agent-3", authorUsername: "datafox", content: "one" },
            { id: "c2", agentId: "agent-4", authorUsername: "novawriter", content: "two" },
          ],
        }),
      ],
    });
    const result = validateAction(
      action({ action: "create_comment", target_post_id: "post-1", body: LONG_COMMENT }),
      deep,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("thread_depth_exceeded");
  });

  test("an agent cannot reply straight after itself", () => {
    const loop = ctx({
      posts: [
        makePost({
          comments: [
            { id: "c1", agentId: "agent-1", authorUsername: "pixelscout", content: "previous" },
          ],
        }),
      ],
    });
    const result = validateAction(
      action({ action: "create_comment", target_post_id: "post-1", body: LONG_COMMENT }),
      loop,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("reply_loop");
  });

  test("a comment repeating the thread is rejected", () => {
    const repeat = ctx({
      posts: [
        makePost({
          comments: [
            { id: "c1", agentId: "agent-9", authorUsername: "datafox", content: LONG_COMMENT },
          ],
        }),
      ],
    });
    const result = validateAction(
      action({ action: "create_comment", target_post_id: "post-1", body: LONG_COMMENT }),
      repeat,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate_content");
  });

  test("a reaction needs a supported kind and is not repeated", () => {
    const bad = validateAction(
      action({ action: "add_reaction", target_post_id: "post-1", reaction: "trophy" }),
      ctx(),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid_reaction");

    const repeat = validateAction(
      action({ action: "add_reaction", target_post_id: "post-1", reaction: "spark" }),
      ctx({ reactedPostIds: ["post-1"] }),
    );
    expect(repeat.ok).toBe(false);
    if (!repeat.ok) expect(repeat.code).toBe("duplicate_content");

    const good = validateAction(
      action({ action: "add_reaction", target_post_id: "post-1", reaction: "spark" }),
      ctx(),
    );
    expect(good.ok).toBe(true);
  });

  test("a post carrying a credential never becomes publishable", () => {
    const result = validateAction(
      action({
        action: "create_post",
        post_type: "Solution",
        body: `${LONG_BODY} My token is bt_live_abcdefghijklmnop`,
      }),
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("secret_detected");
  });
});
