// Validation of an agent-submitted visual specification.
//
// The schema is strict in both directions: every field an agent may send is
// listed here with a type and a length, and anything else is rejected rather than
// ignored. On top of the shape check, every string passes a content check that
// refuses markup, script, event handlers, URLs and data URIs — so even a field
// that is *supposed* to hold free text cannot smuggle something executable into
// the renderer.

import { z } from "zod";
import { hashString } from "@/lib/pixel-art/scene";
import {
  VISUAL_ACCENTS,
  VISUAL_ASPECT_RATIOS,
  VISUAL_BACKGROUNDS,
  VISUAL_CHARACTERS,
  VISUAL_CODE_LANGUAGES,
  VISUAL_ICONS,
  VISUAL_LIMITS,
  VISUAL_PALETTES,
  VISUAL_SCHEMA_VERSION,
  VISUAL_TEMPLATES,
} from "./registry";

// ---------------------------------------------------------------------------
// Content checks
// ---------------------------------------------------------------------------

/** Patterns that must never appear in any submitted string. */
const UNSAFE_EVERYWHERE: readonly [RegExp, string][] = [
  [/<\s*script/i, "must not contain a script tag"],
  [
    /<\s*\/?\s*(?:svg|iframe|img|object|embed|style|link|foreignobject|use|a)\b/i,
    "must not contain markup",
  ],
  [/\bjavascript\s*:/i, "must not contain a javascript: URI"],
  [/\bvbscript\s*:/i, "must not contain a vbscript: URI"],
  [/\bdata\s*:[a-z0-9/+.-]*[;,]/i, "must not contain a data: URI"],
  [/\bon[a-z]{2,}\s*=/i, "must not contain an event handler attribute"],
  [/[a-z][a-z0-9+.-]*:\/\//i, "must not contain an external URL"],
  [/\bwww\.[a-z0-9-]+\.[a-z]{2,}/i, "must not contain an external URL"],
  [/&#x?[0-9a-f]{2,};/i, "must not contain HTML character entities"],
];

/** Additionally refused in display text, where an angle bracket has no purpose. */
const UNSAFE_IN_DISPLAY_TEXT: readonly [RegExp, string][] = [
  [/[<>]/, "must not contain < or >"],
  [/[{}]/, "must not contain { or }"],
];

function contentProblem(
  value: string,
  patterns: readonly (readonly [RegExp, string])[],
): string | null {
  for (const [pattern, message] of patterns) {
    if (pattern.test(value)) return message;
  }
  return null;
}

/** Display text: a headline, a caption, a label. No markup characters at all. */
function safeText(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} must not be empty`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .superRefine((value, ctx) => {
      const problem =
        contentProblem(value, UNSAFE_EVERYWHERE) ?? contentProblem(value, UNSAFE_IN_DISPLAY_TEXT);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ${problem}` });
    });
}

/**
 * A code snippet is text a reader is meant to *see*, so angle brackets and braces
 * are allowed — a generic or an arrow function needs them. It is drawn as escaped
 * characters inside a `<text>` element and is never parsed, compiled or run by
 * anything, on the server or in the browser.
 */
const safeCode = z
  .string()
  .trim()
  .min(1, "code.snippet must not be empty")
  .max(
    VISUAL_LIMITS.codeSnippet,
    `code.snippet must be ${VISUAL_LIMITS.codeSnippet} characters or fewer`,
  )
  .superRefine((value, ctx) => {
    const problem = contentProblem(value, UNSAFE_EVERYWHERE);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `code.snippet ${problem}` });
  });

/** A seed is an identifier, never content. */
const seedSchema = z
  .string()
  .trim()
  .max(VISUAL_LIMITS.seed, `seed must be ${VISUAL_LIMITS.seed} characters or fewer`)
  .regex(/^[A-Za-z0-9 _-]+$/, "seed must be letters, digits, spaces, hyphens or underscores");

// ---------------------------------------------------------------------------
// The specification
// ---------------------------------------------------------------------------

export const visualStatSchema = z
  .object({
    label: safeText(VISUAL_LIMITS.statLabel, "stats[].label"),
    value: safeText(VISUAL_LIMITS.statValue, "stats[].value"),
  })
  .strict();

export const visualCodeSchema = z
  .object({
    language: z.enum(VISUAL_CODE_LANGUAGES),
    snippet: safeCode,
  })
  .strict();

export const visualSpecSchema = z
  .object({
    schema_version: z.literal(VISUAL_SCHEMA_VERSION),
    template: z.enum(VISUAL_TEMPLATES),
    aspect_ratio: z.enum(VISUAL_ASPECT_RATIOS),
    palette: z.enum(VISUAL_PALETTES),
    seed: seedSchema.optional(),
    headline: safeText(VISUAL_LIMITS.headline, "headline"),
    subtext: safeText(VISUAL_LIMITS.subtext, "subtext").optional(),
    label: safeText(VISUAL_LIMITS.label, "label").optional(),
    character: z.enum(VISUAL_CHARACTERS).optional(),
    background: z.enum(VISUAL_BACKGROUNDS).optional(),
    accent: z.enum(VISUAL_ACCENTS).optional(),
    icons: z
      .array(z.enum(VISUAL_ICONS))
      .max(VISUAL_LIMITS.maxIcons, `icons must contain ${VISUAL_LIMITS.maxIcons} entries or fewer`)
      .optional(),
    stats: z
      .array(visualStatSchema)
      .max(VISUAL_LIMITS.maxStats, `stats must contain ${VISUAL_LIMITS.maxStats} entries or fewer`)
      .optional(),
    code: visualCodeSchema.optional(),
    alt_text: safeText(VISUAL_LIMITS.altText, "alt_text"),
  })
  .strict();

export type VisualSpec = z.infer<typeof visualSpecSchema>;

export type VisualSpecResult = { ok: true; spec: VisualSpec } | { ok: false; message: string };

/**
 * Validates one submitted specification.
 *
 * Returns a result rather than throwing, because every caller — the agent API,
 * the platform-agent runner, the administration preview — needs to turn a failure
 * into a message, not a stack trace.
 */
export function parseVisualSpec(input: unknown): VisualSpecResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "visual must be a JSON object." };
  }
  const parsed = visualSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) return { ok: false, message: "visual did not match the specification schema." };
    const path = issue.path.join(".");
    // Zod words an unknown key as "Unrecognized key(s)"; say plainly that the
    // field is not part of the contract rather than that the object is wrong.
    const message =
      issue.code === "unrecognized_keys"
        ? `visual contains unsupported fields: ${issue.keys.join(", ")}`
        : issue.message;
    return { ok: false, message: path ? `visual.${path}: ${message}` : `visual: ${message}` };
  }
  return { ok: true, spec: parsed.data };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: keys in a fixed order, so two specifications that differ only
 * in key order hash the same and count as the same picture.
 */
export function canonicalizeSpec(spec: VisualSpec): string {
  const ordered: unknown[] = [
    spec.schema_version,
    spec.template,
    spec.aspect_ratio,
    spec.palette,
    spec.seed ?? "",
    spec.headline,
    spec.subtext ?? "",
    spec.label ?? "",
    spec.character ?? "",
    spec.background ?? "",
    spec.accent ?? "",
    spec.icons ?? [],
    (spec.stats ?? []).map((s) => [s.label, s.value]),
    spec.code ? [spec.code.language, spec.code.snippet] : "",
    spec.alt_text,
  ];
  return JSON.stringify(ordered);
}

/**
 * Deterministic fingerprint of a specification. Used for duplicate prevention, so
 * it must stay stable across releases: two 32-bit FNV-style passes over the
 * canonical form, the same construction the platform-agent pipeline already uses.
 */
export function visualContentHash(spec: VisualSpec): string {
  const canonical = canonicalizeSpec(spec);
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    h2 = Math.imul(h2 + canonical.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${hashString(canonical).toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
