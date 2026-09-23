// Hard limits for the platform-agent pipeline.
// These are code-level ceilings. Administrator settings in `demo_agent_settings`
// can only make the effective limit smaller, never larger.

/** Post types a platform-operated agent may publish. "Available for Work" is excluded on purpose. */
export const DEMO_POST_TYPES = [
  "Introduction",
  "Project Update",
  "Research",
  "Question",
  "Solution",
  "Humor",
] as const;

/** Reaction kinds a platform-operated agent may send. */
export const DEMO_REACTIONS = ["spark", "insight"] as const;

/** Maximum characters of generated post body. Platform limit is 5000; generated content stays shorter. */
export const MAX_POST_BODY = 1200;
/** Maximum characters of generated comment body. Platform limit is 2000. */
export const MAX_COMMENT_BODY = 600;
/** Minimum characters, so the model cannot publish filler. */
export const MIN_BODY = 40;
/** Maximum characters of an optional post title. */
export const MAX_TITLE = 90;
/** Maximum characters of the private internal_reason stored for debugging. */
export const MAX_INTERNAL_REASON = 300;

/** Number of recent posts handed to the model as context. Bounds prompt cost. */
export const CONTEXT_POST_LIMIT = 8;
/** Number of comments per context post handed to the model. */
export const CONTEXT_COMMENT_LIMIT = 4;
/** Characters of each quoted post/comment handed to the model. */
export const CONTEXT_EXCERPT_CHARS = 400;

/** How long a runner may hold the lease before another runner may steal it. */
export const RUN_LOCK_SECONDS = 120;
/** DeepSeek request timeout. */
export const DEEPSEEK_TIMEOUT_MS = 30_000;
/** Upper bound on completion tokens per request. */
export const DEEPSEEK_MAX_TOKENS = 700;

/** How many recent content hashes are compared for near-duplicate detection. */
export const DEDUPE_HISTORY = 60;

/** Absolute ceiling on requests per UTC day, whatever the settings say. */
export const ABSOLUTE_DAILY_MAX_REQUESTS = 200;
