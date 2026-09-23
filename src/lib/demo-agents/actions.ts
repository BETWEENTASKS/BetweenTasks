// Strict runtime validation of DeepSeek output.
//
// Pure functions only: no database, no network, no secrets. The runner never
// publishes anything that has not passed through `validateAction`.

import { z } from "zod";
import { parseVisualSpec, visualContentHash, type VisualSpec } from "@/lib/visual-posts/schema";
import {
  DEMO_POST_TYPES,
  DEMO_REACTIONS,
  MAX_COMMENT_BODY,
  MAX_INTERNAL_REASON,
  MAX_POST_BODY,
  MAX_TITLE,
  MIN_BODY,
} from "./limits";

export type DemoActionName =
  | "create_post"
  | "create_visual_post"
  | "create_comment"
  | "add_reaction"
  | "skip";

const nullableString = z.union([z.string(), z.null()]).optional();

/**
 * The exact JSON contract the model is told to return.
 *
 * `visual` is the only structured field, and it is deliberately typed as unknown
 * here: it is handed to `parseVisualSpec`, the same strict validator an external
 * agent's submission goes through. The model chooses *what the picture says*;
 * it never produces an image, a file, markup, or code.
 */
export const modelActionSchema = z.object({
  action: z.enum(["create_post", "create_visual_post", "create_comment", "add_reaction", "skip"]),
  target_post_id: nullableString,
  target_comment_id: nullableString,
  post_type: nullableString,
  title: nullableString,
  body: nullableString,
  reaction: nullableString,
  visual: z.unknown().optional(),
  internal_reason: nullableString,
});

export type ModelAction = z.infer<typeof modelActionSchema>;

export type ParseResult =
  | { ok: true; value: ModelAction }
  | { ok: false; code: "malformed_json" | "schema_mismatch"; message: string };

/**
 * Parses a raw model completion. Tolerates a fenced code block because some models
 * wrap JSON despite instructions, but never tolerates anything else.
 */
export function parseModelAction(raw: unknown): ParseResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, code: "malformed_json", message: "Model returned an empty response." };
  }
  let text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "malformed_json", message: "Model response was not valid JSON." };
  }
  const result = modelActionSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      code: "schema_mismatch",
      message: first
        ? `${first.path.join(".") || "root"}: ${first.message}`
        : "Response did not match the action schema.",
    };
  }
  return { ok: true, value: result.data };
}

// ---------------------------------------------------------------------------
// Content safety
// ---------------------------------------------------------------------------

/** Patterns that must never reach a public post or comment. */
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/bt_live_[A-Za-z0-9_-]{8,}/, "agent token"],
  [/sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/, "supabase key"],
  [/\bsk-[A-Za-z0-9_-]{16,}/, "provider api key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "json web token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "aws access key"],
  [
    /\b(?:DEEPSEEK_API_KEY|SUPABASE_SERVICE_ROLE_KEY|LOVABLE_CRON_SECRET)\b/,
    "secret variable name",
  ],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, "bearer credential"],
];

/** Patterns that would present demonstration activity as real commercial activity. */
const FABRICATION_PATTERNS: readonly [RegExp, string][] = [
  [/\b(?:my|our)\s+(?:client|customer|buyer)s?\b/i, "claims real customers"],
  [/\bpaying\s+(?:client|customer)s?\b/i, "claims paying customers"],
  [
    /\b(?:testimonial|case study from|5[-\s]star review|five[-\s]star review)\b/i,
    "fabricated endorsement",
  ],
  [/\bverified\s+(?:client|customer|review|earnings|payment)\b/i, "fabricated verification"],
  [/\bI\s+(?:was\s+)?(?:hired|contracted|paid)\s+by\b/i, "claims real engagement"],
  [/\b(?:earned|invoiced|billed|charged)\b[^.]{0,40}[$€£]\s?\d/i, "claims real earnings"],
  [
    /[$€£]\s?\d[\d,.]*\s*(?:per\s+(?:task|hour|project)|\/\s*(?:task|hour|project))/i,
    "quotes a real rate",
  ],
];

/** Contact details and outbound links are never allowed in generated demo content. */
const CONTACT_PATTERNS: readonly [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, "email address"],
  [/\bhttps?:\/\/\S+/i, "outbound link"],
  [/\b(?:\+\d[\d\s().-]{7,}\d)\b/, "phone number"],
];

export type ContentIssue = { code: string; message: string };

/** Returns the first reason the text must not be published, or null when it is clean. */
export function inspectContent(text: string): ContentIssue | null {
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(text))
      return { code: "secret_detected", message: `Generated content contained a ${label}.` };
  }
  for (const [pattern, label] of FABRICATION_PATTERNS) {
    if (pattern.test(text))
      return { code: "fabricated_claim", message: `Generated content ${label}.` };
  }
  for (const [pattern, label] of CONTACT_PATTERNS) {
    if (pattern.test(text))
      return { code: "contact_detail", message: `Generated content contained a ${label}.` };
  }
  return null;
}

/** Filler replies that add nothing to a thread. */
const FILLER_PATTERNS: readonly RegExp[] = [
  /^(?:great|nice|good|excellent|amazing|awesome)\s+(?:insight|point|post|work|thoughts?|stuff)\b/i,
  /^(?:totally|completely|fully)?\s*agree\b/i,
  /^\+1\b/,
  /^this\.?$/i,
  /^well said\b/i,
];

export function isFiller(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_BODY) return true;
  return FILLER_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Normalizes text so cosmetic edits collapse onto the same key. Used for
 * near-duplicate detection across an agent's own recent output.
 */
export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable, non-cryptographic fingerprint of normalized content. */
export function contentHash(text: string): string {
  const normalized = normalizeForDedupe(text);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Word-overlap similarity in [0,1]. 1.0 means the same bag of words. */
export function similarity(a: string, b: string): number {
  const left = new Set(normalizeForDedupe(a).split(" ").filter(Boolean));
  const right = new Set(normalizeForDedupe(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.max(left.size, right.size);
}

/** Two pieces of content are near-duplicates above this overlap. */
export const DUPLICATE_THRESHOLD = 0.72;

// ---------------------------------------------------------------------------
// Action validation
// ---------------------------------------------------------------------------

export type ContextComment = {
  id: string;
  agentId: string;
  authorUsername: string;
  content: string;
};

export type ContextPost = {
  id: string;
  agentId: string;
  authorUsername: string;
  authorName: string;
  type: string;
  content: string;
  createdAt: string;
  comments: ContextComment[];
};

export type ValidationContext = {
  agentId: string;
  personaKey: string;
  allowedActions: readonly DemoActionName[];
  maxThreadDepth: number;
  posts: readonly ContextPost[];
  /** Normalized text of this agent's own recent output, for duplicate rejection. */
  recentContent: readonly string[];
  /** Post ids this agent has already reacted to. */
  reactedPostIds: readonly string[];
};

export type ExecutablePlan =
  | { action: "skip"; internalReason: string }
  | {
      action: "create_post";
      postType: string;
      title: string | null;
      body: string;
      hash: string;
      internalReason: string;
    }
  | {
      action: "create_visual_post";
      postType: string;
      body: string;
      spec: VisualSpec;
      /** Fingerprint of the caption, for the existing duplicate accounting. */
      hash: string;
      /** Fingerprint of the picture, for the unique index on post_visuals. */
      visualHash: string;
      internalReason: string;
    }
  | {
      action: "create_comment";
      targetPostId: string;
      body: string;
      hash: string;
      internalReason: string;
    }
  | { action: "add_reaction"; targetPostId: string; reaction: string; internalReason: string };

export type ValidationResult =
  { ok: true; plan: ExecutablePlan } | { ok: false; code: string; message: string };

function cleanReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_INTERNAL_REASON) : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Turns a schema-valid model response into something safe to execute, or an error.
 * Every publish path in the runner goes through here.
 */
export function validateAction(action: ModelAction, ctx: ValidationContext): ValidationResult {
  const internalReason = cleanReason(action.internal_reason);

  if (!ctx.allowedActions.includes(action.action)) {
    return {
      ok: false,
      code: "action_not_allowed",
      message: `Action "${action.action}" is not permitted for this run.`,
    };
  }

  if (action.action === "skip") {
    return { ok: true, plan: { action: "skip", internalReason } };
  }

  if (action.action === "create_post") {
    const postType = text(action.post_type) || "Project Update";
    if (!(DEMO_POST_TYPES as readonly string[]).includes(postType)) {
      return {
        ok: false,
        code: "invalid_post_type",
        message: `Unsupported post type "${postType}".`,
      };
    }
    const body = text(action.body);
    if (body.length < MIN_BODY || body.length > MAX_POST_BODY) {
      return {
        ok: false,
        code: "invalid_length",
        message: `Post body must be ${MIN_BODY}-${MAX_POST_BODY} characters (received ${body.length}).`,
      };
    }
    if (isFiller(body)) {
      return {
        ok: false,
        code: "low_quality",
        message: "Post body was filler with no useful content.",
      };
    }
    const title = text(action.title);
    if (title.length > MAX_TITLE) {
      return {
        ok: false,
        code: "invalid_length",
        message: `Title must be ${MAX_TITLE} characters or fewer.`,
      };
    }
    const issue = inspectContent(`${title}\n${body}`);
    if (issue) return { ok: false, ...issue };
    const duplicate = findDuplicate(body, ctx.recentContent);
    if (duplicate) {
      return {
        ok: false,
        code: "duplicate_content",
        message: "Post repeats content this agent already published.",
      };
    }
    return {
      ok: true,
      plan: {
        action: "create_post",
        postType,
        title: title || null,
        body,
        hash: contentHash(body),
        internalReason,
      },
    };
  }

  if (action.action === "create_visual_post") {
    const postType = text(action.post_type) || "Project Update";
    if (!(DEMO_POST_TYPES as readonly string[]).includes(postType)) {
      return { ok: false, code: "invalid_post_type", message: `Unsupported post type "${postType}".` };
    }
    const body = text(action.body);
    if (body.length < MIN_BODY || body.length > MAX_POST_BODY) {
      return {
        ok: false,
        code: "invalid_length",
        message: `Visual post caption must be ${MIN_BODY}-${MAX_POST_BODY} characters (received ${body.length}).`,
      };
    }
    if (isFiller(body)) {
      return { ok: false, code: "low_quality", message: "Visual post caption was filler with no useful content." };
    }
    // The same strict validator an external agent's submission goes through:
    // markup, script, event handlers, URLs and data URIs are all refused here.
    const parsed = parseVisualSpec(action.visual);
    if (!parsed.ok) {
      return { ok: false, code: "invalid_visual", message: parsed.message };
    }
    const spec = parsed.spec;
    // Visible words in the picture are held to the same content rules as a post.
    const issue = inspectContent([body, spec.headline, spec.subtext ?? "", spec.alt_text].join("\n"));
    if (issue) return { ok: false, ...issue };
    if (findDuplicate(body, ctx.recentContent)) {
      return {
        ok: false,
        code: "duplicate_content",
        message: "Visual post caption repeats content this agent already published.",
      };
    }
    return {
      ok: true,
      plan: {
        action: "create_visual_post",
        postType,
        body,
        spec,
        hash: contentHash(body),
        visualHash: visualContentHash(spec),
        internalReason,
      },
    };
  }

  if (action.action === "create_comment") {
    const targetPostId = text(action.target_post_id);
    if (!targetPostId) {
      return {
        ok: false,
        code: "missing_target",
        message: "create_comment requires target_post_id.",
      };
    }
    const post = ctx.posts.find((p) => p.id === targetPostId);
    if (!post) {
      return {
        ok: false,
        code: "unknown_target",
        message: "target_post_id is not a visible post in this context.",
      };
    }
    if (post.agentId === ctx.agentId) {
      return {
        ok: false,
        code: "self_reply",
        message: "An agent may not comment on its own post.",
      };
    }
    if (text(action.target_comment_id)) {
      const target = post.comments.find((c) => c.id === text(action.target_comment_id));
      if (!target) {
        return {
          ok: false,
          code: "unknown_target",
          message: "target_comment_id is not a visible comment on that post.",
        };
      }
      if (target.agentId === ctx.agentId) {
        return {
          ok: false,
          code: "self_reply",
          message: "An agent may not reply to its own comment.",
        };
      }
    }
    if (post.comments.length >= ctx.maxThreadDepth) {
      return {
        ok: false,
        code: "thread_depth_exceeded",
        message: `Thread already has ${post.comments.length} comments (limit ${ctx.maxThreadDepth}).`,
      };
    }
    const lastComment = post.comments[post.comments.length - 1];
    if (lastComment && lastComment.agentId === ctx.agentId) {
      return {
        ok: false,
        code: "reply_loop",
        message: "This agent wrote the most recent comment; replying again would create a loop.",
      };
    }
    const body = text(action.body);
    if (body.length < MIN_BODY || body.length > MAX_COMMENT_BODY) {
      return {
        ok: false,
        code: "invalid_length",
        message: `Comment body must be ${MIN_BODY}-${MAX_COMMENT_BODY} characters (received ${body.length}).`,
      };
    }
    if (isFiller(body)) {
      return {
        ok: false,
        code: "low_quality",
        message: "Comment was filler with no useful content.",
      };
    }
    const issue = inspectContent(body);
    if (issue) return { ok: false, ...issue };
    const threadText = post.comments.map((c) => c.content);
    if (findDuplicate(body, [...ctx.recentContent, ...threadText])) {
      return {
        ok: false,
        code: "duplicate_content",
        message: "Comment repeats content already in the thread.",
      };
    }
    return {
      ok: true,
      plan: {
        action: "create_comment",
        targetPostId,
        body,
        hash: contentHash(body),
        internalReason,
      },
    };
  }

  // add_reaction
  const targetPostId = text(action.target_post_id);
  if (!targetPostId) {
    return { ok: false, code: "missing_target", message: "add_reaction requires target_post_id." };
  }
  const post = ctx.posts.find((p) => p.id === targetPostId);
  if (!post) {
    return {
      ok: false,
      code: "unknown_target",
      message: "target_post_id is not a visible post in this context.",
    };
  }
  if (post.agentId === ctx.agentId) {
    return { ok: false, code: "self_reply", message: "An agent may not react to its own post." };
  }
  if (ctx.reactedPostIds.includes(targetPostId)) {
    return {
      ok: false,
      code: "duplicate_content",
      message: "This agent already reacted to that post.",
    };
  }
  const reaction = text(action.reaction) || "spark";
  if (!(DEMO_REACTIONS as readonly string[]).includes(reaction)) {
    return { ok: false, code: "invalid_reaction", message: `Unsupported reaction "${reaction}".` };
  }
  return { ok: true, plan: { action: "add_reaction", targetPostId, reaction, internalReason } };
}

function findDuplicate(body: string, history: readonly string[]): boolean {
  return history.some((previous) => similarity(body, previous) >= DUPLICATE_THRESHOLD);
}
