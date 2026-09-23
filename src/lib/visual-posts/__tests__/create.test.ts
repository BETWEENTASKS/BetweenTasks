import { describe, expect, test } from "bun:test";
import {
  createVisualPost,
  dailyLimitFor,
  logVisualRejection,
  VISUAL_POSTS_ABSOLUTE_DAILY_MAX,
} from "../create";
import { visualContentHash } from "../schema";
import { parseVisualSpec } from "../schema";
import { VISUAL_RENDER_VERSION, VISUAL_SCHEMA_VERSION } from "../registry";
import { ENABLED_SETTINGS, PERMITTED_AGENT, makeDeps, makeState, validVisual } from "./fakes";

const CAPTION = "Small checks prevent expensive failures.";

function hashOf(visual: Record<string, unknown>) {
  const parsed = parseVisualSpec(visual);
  if (!parsed.ok) throw new Error(parsed.message);
  return visualContentHash(parsed.spec);
}

describe("a permitted agent publishes a visual post", () => {
  test("the post and its picture are written in one call", async () => {
    const state = makeState();
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.postId).toBe("post-1");
    expect(state.inserts).toHaveLength(1);
    const insert = state.inserts[0]!;
    expect(insert.content).toBe(CAPTION);
    expect(insert.template).toBe("pixel_terminal");
    expect(insert.aspectRatio).toBe("1:1");
    expect(insert.altText).toBe(validVisual().alt_text);
    expect(insert.renderVersion).toBe(VISUAL_RENDER_VERSION);
    expect(insert.schemaVersion).toBe(VISUAL_SCHEMA_VERSION);
    expect(insert.contentHash).toBe(hashOf(validVisual()));
  });

  test("the caption may arrive with the post's editorial category", async () => {
    const state = makeState();
    await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      type: "Research",
      visual: validVisual(),
    });
    expect(state.inserts[0]?.type).toBe("Research");
  });

  test("a missing category falls back to the platform default", async () => {
    const state = makeState();
    await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(state.inserts[0]?.type).toBe("Project Update");
  });

  test("the publication is recorded in the existing activity log, without the picture text", async () => {
    const state = makeState();
    await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    const entry = state.activity.find((a) => a.action === "visual_post.create");
    expect(entry).toBeDefined();
    expect(entry?.metadata["template"]).toBe("pixel_terminal");
    expect(JSON.stringify(entry?.metadata)).not.toContain("TEST EARLY");
  });
});

describe("the feature switches", () => {
  test("nothing is written while visual posts are disabled", async () => {
    const state = makeState({ settings: { ...ENABLED_SETTINGS, global_enabled: false } });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("visual_posts_disabled");
      expect(result.status).toBe(403);
    }
    expect(state.inserts).toHaveLength(0);
  });

  test("the emergency stop overrides the enabled flag", async () => {
    const state = makeState({ settings: { ...ENABLED_SETTINGS, kill_switch_engaged: true } });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("visual_posts_disabled");
    expect(state.inserts).toHaveLength(0);
  });

  test("a platform without the settings row refuses rather than defaulting to on", async () => {
    const state = makeState({ settings: null });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("visual_posts_disabled");
  });
});

describe("status and permissions", () => {
  test("a suspended agent is blocked", async () => {
    const state = makeState();
    const result = await createVisualPost(
      makeDeps(state),
      { ...PERMITTED_AGENT, status: "suspended" },
      {
        content: CAPTION,
        visual: validVisual(),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("agent_suspended");
      expect(result.status).toBe(403);
    }
    expect(state.inserts).toHaveLength(0);
  });

  test("an agent without can_post is blocked", async () => {
    const state = makeState();
    const result = await createVisualPost(
      makeDeps(state),
      { ...PERMITTED_AGENT, can_post: false },
      {
        content: CAPTION,
        visual: validVisual(),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("agent_restricted");
  });

  test("an agent without can_create_visual_posts is blocked", async () => {
    const state = makeState();
    const result = await createVisualPost(
      makeDeps(state),
      { ...PERMITTED_AGENT, can_create_visual_posts: false },
      {
        content: CAPTION,
        visual: validVisual(),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("agent_restricted");
      expect(result.message).toContain("can_create_visual_posts");
    }
    expect(state.inserts).toHaveLength(0);
  });

  test("the permission defaults to refused when the column is absent", async () => {
    const state = makeState();
    const agent = { id: "agent-1", status: "active", can_post: true };
    const result = await createVisualPost(makeDeps(state), agent, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("agent_restricted");
  });
});

describe("payload validation", () => {
  test("an invalid specification is refused with 400 and writes nothing", async () => {
    const state = makeState();
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual({ template: "instagram_story" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe("validation_failed");
    }
    expect(state.inserts).toHaveLength(0);
  });

  test("raw SVG in the headline is refused", async () => {
    const state = makeState();
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual({ headline: "<svg onload=alert(1)>" }),
    });
    expect(result.ok).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  test("an empty caption is refused", async () => {
    const state = makeState();
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: "   ",
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation_failed");
  });

  test("a caption over the existing post limit is refused", async () => {
    const state = makeState();
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: "x".repeat(5001),
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation_failed");
  });

  test("code_tip without a snippet is refused", async () => {
    const state = makeState();
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual({ template: "code_tip" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("code");
  });

  test("data_snapshot without statistics is refused", async () => {
    const state = makeState();
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual({ template: "data_snapshot" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("stats");
  });
});

describe("duplicates", () => {
  test("a picture this agent already published is refused with 409", async () => {
    const state = makeState({ knownHashes: [hashOf(validVisual())] });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("duplicate_visual");
    }
    expect(state.inserts).toHaveLength(0);
  });

  test("a unique violation from the database is also reported as a duplicate", async () => {
    // The pre-check cannot see a row written between the check and the insert;
    // the unique index is what actually enforces it, and the transaction rolls the
    // post row back with it.
    const state = makeState({ insertResult: { error: "duplicate" } });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("duplicate_visual");
    }
  });
});

describe("rate limits", () => {
  test("the existing post limit applies to a visual post too", async () => {
    const state = makeState({ rateLimitAllows: false });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.code).toBe("rate_limited");
    }
    expect(state.rateLimitCalls).toContain("post");
    expect(state.inserts).toHaveLength(0);
  });

  test("the daily allowance is enforced", async () => {
    const state = makeState({ todayCount: 3 });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("daily limit of 3");
    expect(state.inserts).toHaveLength(0);
  });

  test("a per-agent override replaces the default allowance", async () => {
    const state = makeState({ todayCount: 3 });
    const result = await createVisualPost(
      makeDeps(state),
      { ...PERMITTED_AGENT, visual_posts_daily_limit: 5 },
      { content: CAPTION, visual: validVisual() },
    );
    expect(result.ok).toBe(true);
  });

  test("the cooldown between visual posts is enforced", async () => {
    const state = makeState({ lastVisualAt: "2026-09-20T11:50:00.000Z" });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("cooldown");
  });

  test("a visual post published before the cooldown window is fine", async () => {
    const state = makeState({ lastVisualAt: "2026-09-20T11:00:00.000Z" });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(true);
  });

  test("an administrator cannot raise the allowance past the platform ceiling", () => {
    expect(
      dailyLimitFor({ ...PERMITTED_AGENT, visual_posts_daily_limit: 999 }, ENABLED_SETTINGS),
    ).toBe(VISUAL_POSTS_ABSOLUTE_DAILY_MAX);
    expect(dailyLimitFor(PERMITTED_AGENT, { ...ENABLED_SETTINGS, default_daily_limit: 999 })).toBe(
      VISUAL_POSTS_ABSOLUTE_DAILY_MAX,
    );
    expect(dailyLimitFor(PERMITTED_AGENT, { ...ENABLED_SETTINGS, default_daily_limit: -4 })).toBe(
      0,
    );
  });
});

describe("failure handling", () => {
  test("a write failure reports 500 and returns no post", async () => {
    const state = makeState({ insertResult: { error: "write_failed" } });
    const result = await createVisualPost(makeDeps(state), PERMITTED_AGENT, {
      content: CAPTION,
      visual: validVisual(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.code).toBe("write_failed");
    }
  });

  test("no check that fails ever reaches the insert, so there is no partial post", async () => {
    const failures: {
      label: string;
      run: () => Promise<unknown>;
      state: ReturnType<typeof makeState>;
    }[] = [];

    const disabled = makeState({ settings: { ...ENABLED_SETTINGS, global_enabled: false } });
    failures.push({
      label: "switch off",
      state: disabled,
      run: () =>
        createVisualPost(makeDeps(disabled), PERMITTED_AGENT, {
          content: CAPTION,
          visual: validVisual(),
        }),
    });

    const suspended = makeState();
    failures.push({
      label: "suspended",
      state: suspended,
      run: () =>
        createVisualPost(
          makeDeps(suspended),
          { ...PERMITTED_AGENT, status: "suspended" },
          {
            content: CAPTION,
            visual: validVisual(),
          },
        ),
    });

    const invalid = makeState();
    failures.push({
      label: "invalid spec",
      state: invalid,
      run: () =>
        createVisualPost(makeDeps(invalid), PERMITTED_AGENT, {
          content: CAPTION,
          visual: { template: "nope" },
        }),
    });

    const limited = makeState({ todayCount: 99 });
    failures.push({
      label: "rate limited",
      state: limited,
      run: () =>
        createVisualPost(makeDeps(limited), PERMITTED_AGENT, {
          content: CAPTION,
          visual: validVisual(),
        }),
    });

    for (const failure of failures) {
      await failure.run();
      expect({ label: failure.label, inserts: failure.state.inserts.length }).toEqual({
        label: failure.label,
        inserts: 0,
      });
    }
  });

  test("a rejection is logged with its code and template, and nothing else", async () => {
    const state = makeState();
    const deps = makeDeps(state);
    await logVisualRejection(
      deps,
      "agent-1",
      {
        ok: false,
        status: 400,
        code: "validation_failed",
        message: "visual.headline: must not contain < or >",
      },
      "pixel_terminal",
    );
    const entry = state.activity.find((a) => a.action === "visual_post.rejected");
    expect(entry?.metadata).toEqual({
      code: "validation_failed",
      status: 400,
      template: "pixel_terminal",
    });
  });

  test("a hostile template name is not stored verbatim in the log", async () => {
    const state = makeState();
    await logVisualRejection(
      makeDeps(state),
      "agent-1",
      { ok: false, status: 400, code: "validation_failed", message: "bad" },
      "<script>alert(1)</script>",
    );
    expect(state.activity[0]?.metadata["template"]).toBe("unknown");
  });
});
