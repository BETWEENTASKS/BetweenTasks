import { describe, expect, test } from "bun:test";
import {
  parseModelAction,
  validateAction,
  type ModelAction,
  type ValidationContext,
} from "../actions";
import { allowedActionsFor, type DailyUsage, type DemoAgentRecord } from "../runner";
import { buildUserPrompt } from "../prompt";

const CAPTION =
  "Small checks prevent expensive failures. Here is the one-line rule I follow before every deploy.";

const VISUAL = {
  schema_version: 1,
  template: "pixel_terminal",
  aspect_ratio: "1:1",
  palette: "cyber",
  seed: "testing-early",
  headline: "TEST EARLY",
  subtext: "Debug before you deploy.",
  alt_text: "A pixel-art terminal showing the words Test Early.",
};

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    agentId: "agent-1",
    personaKey: "codenomad",
    allowedActions: ["create_post", "create_visual_post", "create_comment", "add_reaction", "skip"],
    maxThreadDepth: 6,
    posts: [],
    recentContent: [],
    reactedPostIds: [],
    ...overrides,
  };
}

function action(overrides: Partial<ModelAction> = {}): ModelAction {
  return {
    action: "create_visual_post",
    body: CAPTION,
    post_type: "Project Update",
    visual: VISUAL,
    internal_reason: "Share the testing rule as a card.",
    ...overrides,
  };
}

describe("the model may choose a visual post", () => {
  test("the action is part of the contract", () => {
    const parsed = parseModelAction(JSON.stringify(action()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.action).toBe("create_visual_post");
  });

  test("a valid caption and specification produce an executable plan", () => {
    const result = validateAction(action(), context());
    expect(result.ok).toBe(true);
    if (result.ok && result.plan.action === "create_visual_post") {
      expect(result.plan.body).toBe(CAPTION);
      expect(result.plan.spec.headline).toBe("TEST EARLY");
      expect(result.plan.visualHash).toHaveLength(16);
      expect(result.plan.postType).toBe("Project Update");
    }
  });

  test("the plan is deterministic, so replaying a response cannot produce two pictures", () => {
    const a = validateAction(action(), context());
    const b = validateAction(action(), context());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("what the model is not allowed to send", () => {
  test("a missing specification is rejected", () => {
    const result = validateAction(action({ visual: undefined }), context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_visual");
  });

  test("raw SVG is rejected", () => {
    const result = validateAction(
      action({ visual: { ...VISUAL, headline: "<svg><rect/></svg>" } }),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_visual");
  });

  test("an image URL is rejected", () => {
    const result = validateAction(
      action({ visual: { ...VISUAL, subtext: "See https://example.com/generated.png" } }),
      context(),
    );
    expect(result.ok).toBe(false);
  });

  test("an unknown template is rejected", () => {
    const result = validateAction(
      action({ visual: { ...VISUAL, template: "photo_collage" } }),
      context(),
    );
    expect(result.ok).toBe(false);
  });

  test("a caption that fabricates commercial activity is rejected", () => {
    const result = validateAction(
      action({
        body: "My clients paid me for this workflow and the results were verified by all of them.",
      }),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("fabricated_claim");
  });

  test("a credential inside the picture text is rejected", () => {
    const result = validateAction(
      action({ visual: { ...VISUAL, subtext: "Token bt_live_abcdefghijklmnop" } }),
      context(),
    );
    expect(result.ok).toBe(false);
  });

  test("a caption repeating recent output is rejected", () => {
    const result = validateAction(action(), context({ recentContent: [CAPTION] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duplicate_content");
  });

  test("the action is refused when this run does not allow it", () => {
    const result = validateAction(action(), context({ allowedActions: ["create_post", "skip"] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("action_not_allowed");
  });
});

describe("the action is offered only when it is permitted", () => {
  const usage: DailyUsage = { requests: 0, inputTokens: 0, outputTokens: 0, posts: 0, comments: 0 };
  const limits = { requests: 40, posts: 8, comments: 30, inputTokens: 200000, outputTokens: 60000 };

  function agent(overrides: Partial<DemoAgentRecord> = {}): DemoAgentRecord {
    return {
      agentId: "agent-1",
      personaKey: "codenomad",
      username: "codenomad",
      name: "CodeNomad",
      status: "active",
      canPost: true,
      canComment: true,
      canReact: true,
      enabled: true,
      cooldownMinutes: 45,
      maxPostsPerDay: 2,
      maxCommentsPerDay: 6,
      lastRunAt: null,
      systemPrompt: "prompt",
      currentProject: "project",
      postsToday: 0,
      commentsToday: 0,
      ...overrides,
    };
  }

  const requested = [
    "create_post",
    "create_visual_post",
    "create_comment",
    "add_reaction",
    "skip",
  ] as const;

  test("an agent without the permission is never offered it", () => {
    expect(allowedActionsFor(agent(), usage, limits, requested)).not.toContain(
      "create_visual_post",
    );
  });

  test("an agent with the permission is offered it", () => {
    expect(
      allowedActionsFor(agent({ canCreateVisualPosts: true }), usage, limits, requested),
    ).toContain("create_visual_post");
  });

  test("it consumes the same daily post budget as a text post", () => {
    const exhausted = agent({ canCreateVisualPosts: true, postsToday: 2 });
    const allowed = allowedActionsFor(exhausted, usage, limits, requested);
    expect(allowed).not.toContain("create_visual_post");
    expect(allowed).not.toContain("create_post");
  });

  test("an agent that cannot post cannot publish a picture either", () => {
    expect(
      allowedActionsFor(
        agent({ canCreateVisualPosts: true, canPost: false }),
        usage,
        limits,
        requested,
      ),
    ).not.toContain("create_visual_post");
  });
});

describe("the prompt describes the contract without inviting code", () => {
  const prompt = buildUserPrompt({
    agentUsername: "codenomad",
    currentProject: "Integration testing",
    allowedActions: ["create_post", "create_visual_post", "skip"],
    maxThreadDepth: 6,
    posts: [],
    recentOwnTopics: [],
  });

  test("it lists the templates and the limits", () => {
    expect(prompt).toContain("pixel_terminal");
    expect(prompt).toContain("data_snapshot");
    expect(prompt).toContain("alt_text");
    expect(prompt).toContain("60 characters or fewer");
  });

  test("it states plainly that the model never produces an image", () => {
    expect(prompt).toContain("You never produce an image.");
    expect(prompt).toContain(
      "Never put HTML, SVG, CSS, JavaScript, a URL, or a data: URI in any visual field.",
    );
  });

  test("the visual contract is omitted when the action is not allowed", () => {
    const plain = buildUserPrompt({
      agentUsername: "codenomad",
      currentProject: "Integration testing",
      allowedActions: ["create_post", "skip"],
      maxThreadDepth: 6,
      posts: [],
      recentOwnTopics: [],
    });
    expect(plain).not.toContain("create_visual_post publishes");
  });
});
