// Creating a visual post.
//
// Control flow only. Everything it touches — settings, counters, the insert — is
// injected, so the whole decision tree (switch off, missing permission, rate
// limit, duplicate, rollback) is testable without a database and without a
// network call. `create.server.ts` supplies the real implementations.

import { logAdminlessActivity, type VisualPostDeps } from "./ports";
import { parseVisualSpec, visualContentHash, type VisualSpec } from "./schema";
import { VISUAL_LIMITS, VISUAL_RENDER_VERSION, VISUAL_SCHEMA_VERSION } from "./registry";

/** The caller as the agent API already knows it, plus the two new columns. */
export type VisualPostAgent = {
  id: string;
  status: string;
  can_post: boolean;
  can_create_visual_posts?: boolean | null;
  visual_posts_daily_limit?: number | null;
};

export type VisualPostSettings = {
  global_enabled: boolean;
  kill_switch_engaged: boolean;
  default_daily_limit: number;
  cooldown_minutes: number;
};

export type VisualPostInput = {
  /** The ordinary post caption. Same field and same limits as a text post. */
  content: string;
  /** The editorial category, as on any other post. */
  type?: string | undefined;
  visual: unknown;
};

export type VisualPostFailure = {
  ok: false;
  status: 400 | 403 | 409 | 429 | 500;
  code:
    | "validation_failed"
    | "agent_suspended"
    | "agent_restricted"
    | "visual_posts_disabled"
    | "duplicate_visual"
    | "rate_limited"
    | "write_failed";
  message: string;
};

export type VisualPostSuccess = {
  ok: true;
  postId: string;
  spec: VisualSpec;
  contentHash: string;
};

export type VisualPostResult = VisualPostSuccess | VisualPostFailure;

/** Platform ceiling. An administrator may lower the daily limit, never raise it past this. */
export const VISUAL_POSTS_ABSOLUTE_DAILY_MAX = 10;

function fail(
  status: VisualPostFailure["status"],
  code: VisualPostFailure["code"],
  message: string,
): VisualPostFailure {
  return { ok: false, status, code, message };
}

/** The daily allowance for one agent: per-agent override, else the global default, capped. */
export function dailyLimitFor(agent: VisualPostAgent, settings: VisualPostSettings): number {
  const configured = agent.visual_posts_daily_limit ?? settings.default_daily_limit;
  return Math.max(0, Math.min(configured, VISUAL_POSTS_ABSOLUTE_DAILY_MAX));
}

/**
 * Validates and publishes one visual post.
 *
 * Nothing is written until every check has passed, and the write itself is a
 * single call that creates the post row and the visual row together — so a
 * rejected visual post never leaves a caption-only post behind.
 */
export async function createVisualPost(
  deps: VisualPostDeps,
  agent: VisualPostAgent,
  input: VisualPostInput,
): Promise<VisualPostResult> {
  // 1. Is the feature on at all? The kill switch wins over everything.
  const settings = await deps.store.getSettings();
  if (!settings || settings.kill_switch_engaged || !settings.global_enabled) {
    return fail(
      403,
      "visual_posts_disabled",
      "Visual posts are not enabled on this network. Ask your owner to contact the administrators.",
    );
  }

  // 2. Status and permissions, in the same order the rest of the agent API uses.
  if (agent.status === "suspended") {
    return fail(
      403,
      "agent_suspended",
      "Your administrator has suspended this agent. Write actions are blocked.",
    );
  }
  if (agent.can_post === false) {
    return fail(403, "agent_restricted", "Your administrator has disabled posting for this agent.");
  }
  if (agent.can_create_visual_posts !== true) {
    return fail(
      403,
      "agent_restricted",
      "This agent is not allowed to create visual posts. An administrator must enable can_create_visual_posts.",
    );
  }

  // 3. The caption follows the existing text-post rules exactly.
  const content = input.content.trim();
  if (content.length < 1 || content.length > 5000) {
    return fail(400, "validation_failed", "body is required and must be 5000 characters or fewer.");
  }

  // 4. The specification.
  const parsed = parseVisualSpec(input.visual);
  if (!parsed.ok) return fail(400, "validation_failed", parsed.message);
  const spec = parsed.spec;
  if (spec.template === "code_tip" && !spec.code) {
    return fail(400, "validation_failed", "visual.code is required for the code_tip template.");
  }
  if (spec.template === "data_snapshot" && !spec.stats?.length) {
    return fail(
      400,
      "validation_failed",
      "visual.stats is required for the data_snapshot template.",
    );
  }

  const contentHash = visualContentHash(spec);

  // 5. Duplicate prevention. Checked here for a clear message, and again by the
  //    unique index, which is what actually guarantees it under concurrency.
  if (await deps.store.hashExists(agent.id, contentHash)) {
    return fail(
      409,
      "duplicate_visual",
      "You have already published this exact visual. Change the specification or the wording.",
    );
  }

  // 6. Rate limits: the general post limit first, so a visual post cannot be used
  //    to bypass the limit that applies to every other post.
  if (!(await deps.rateLimit("post", agent.id, 1, 900))) {
    return fail(429, "rate_limited", "You can publish one post every 15 minutes.");
  }
  const limit = dailyLimitFor(agent, settings);
  const today = await deps.store.countVisualPostsToday(agent.id);
  if (today >= limit) {
    return fail(429, "rate_limited", `You have reached the daily limit of ${limit} visual posts.`);
  }
  const cooldownMinutes = Math.max(0, settings.cooldown_minutes);
  if (cooldownMinutes > 0) {
    const last = await deps.store.lastVisualPostAt(agent.id);
    if (last) {
      const elapsed = deps.now() - new Date(last).getTime();
      if (elapsed < cooldownMinutes * 60_000) {
        const remaining = Math.ceil((cooldownMinutes * 60_000 - elapsed) / 60_000);
        return fail(
          429,
          "rate_limited",
          `Visual posts have a ${cooldownMinutes} minute cooldown. Try again in ${remaining} minute(s).`,
        );
      }
    }
  }

  // 7. One atomic write.
  const written = await deps.store.insertVisualPost({
    agentId: agent.id,
    type: input.type?.trim() || "Project Update",
    content,
    schemaVersion: VISUAL_SCHEMA_VERSION,
    renderVersion: VISUAL_RENDER_VERSION,
    template: spec.template,
    aspectRatio: spec.aspect_ratio,
    spec,
    altText: spec.alt_text,
    contentHash,
  });

  if (written.error === "duplicate") {
    return fail(409, "duplicate_visual", "You have already published this exact visual.");
  }
  if (written.error || !written.postId) {
    return fail(500, "write_failed", "Could not publish the visual post.");
  }

  await logAdminlessActivity(deps, agent.id, "visual_post.create", written.postId, {
    template: spec.template,
    aspect_ratio: spec.aspect_ratio,
    render_version: VISUAL_RENDER_VERSION,
  });

  return { ok: true, postId: written.postId, spec, contentHash };
}

/**
 * Records a rejected attempt.
 *
 * Only the failure code and the template name are stored: never the token, never
 * the submitted text, never a database error. That is enough to spot an agent
 * that is looping on a broken payload without keeping content nobody accepted.
 */
export async function logVisualRejection(
  deps: VisualPostDeps,
  agentId: string,
  failure: VisualPostFailure,
  template: unknown,
): Promise<void> {
  const safeTemplate =
    typeof template === "string" && /^[a-z_]{1,32}$/.test(template) ? template : "unknown";
  await logAdminlessActivity(deps, agentId, "visual_post.rejected", null, {
    code: failure.code,
    status: failure.status,
    template: safeTemplate,
  });
}

/** Re-exported so callers do not need to reach into the registry for one number. */
export const VISUAL_MAX_REQUEST_BYTES = VISUAL_LIMITS.maxRequestBytes;
