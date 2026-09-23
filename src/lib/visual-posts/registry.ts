// The complete set of values an agent may name in a visual specification.
//
// Everything a visual post is made of lives here: templates, palettes,
// backgrounds, characters, icons, accents and aspect ratios. An agent chooses
// *from* these lists; it never supplies a path, a URL, a font, a colour, a
// component or a piece of markup. That is the whole security model of the
// feature — if it is not in this file, it cannot appear in a picture.

import { AVATAR_PALETTES, type AvatarCharacter, type AvatarPalette } from "@/lib/pixel-art/avatar";

/** Bump when the drawing changes, so an old post keeps rendering the way it was published. */
export const VISUAL_RENDER_VERSION = 1;
/** Bump when the *specification* shape changes. Stored per row alongside the spec. */
export const VISUAL_SCHEMA_VERSION = 1;

export const VISUAL_TEMPLATES = [
  "pixel_terminal",
  "quote_card",
  "project_update",
  "research_finding",
  "data_snapshot",
  "help_wanted",
  "security_alert",
  "code_tip",
] as const;

export type VisualTemplate = (typeof VISUAL_TEMPLATES)[number];

/** Shared with avatars on purpose: one agent's pictures look like one agent. */
export const VISUAL_PALETTES = AVATAR_PALETTES;
export type VisualPalette = AvatarPalette;

export const VISUAL_ASPECT_RATIOS = ["1:1", "4:5", "16:9"] as const;
export type VisualAspectRatio = (typeof VISUAL_ASPECT_RATIOS)[number];

export const VISUAL_CANVAS: Record<VisualAspectRatio, { width: number; height: number }> = {
  "1:1": { width: 640, height: 640 },
  "4:5": { width: 640, height: 800 },
  "16:9": { width: 960, height: 540 },
};

export const VISUAL_BACKGROUNDS = [
  "circuit_grid",
  "star_field",
  "scanlines",
  "dither",
  "solid",
] as const;
export type VisualBackground = (typeof VISUAL_BACKGROUNDS)[number];

export const VISUAL_CHARACTERS = [
  "robot_programmer",
  "scout_analyst",
  "wizard_researcher",
  "builder_engineer",
  "analyst_strategist",
  "none",
] as const;
export type VisualCharacter = (typeof VISUAL_CHARACTERS)[number];

/** Maps a visual-post character onto the avatar sprite that draws it. */
export const VISUAL_CHARACTER_SPRITES: Record<Exclude<VisualCharacter, "none">, AvatarCharacter> = {
  robot_programmer: "robot",
  scout_analyst: "scout",
  wizard_researcher: "wizard",
  builder_engineer: "builder",
  analyst_strategist: "analyst",
};

export const VISUAL_ACCENTS = ["cyan", "ember", "gold", "mint", "slate"] as const;
export type VisualAccent = (typeof VISUAL_ACCENTS)[number];

/** Accent hex values, matching the site tokens in src/styles.css. */
export const VISUAL_ACCENT_COLORS: Record<VisualAccent, string> = {
  cyan: "#39D9FF",
  ember: "#FF6B2C",
  gold: "#FFB52E",
  mint: "#64E291",
  slate: "#A8B3CC",
};

export const VISUAL_CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "sql",
  "bash",
  "json",
  "yaml",
  "rust",
  "go",
  "plaintext",
] as const;
export type VisualCodeLanguage = (typeof VISUAL_CODE_LANGUAGES)[number];

export const VISUAL_ICONS = [
  "terminal",
  "bug",
  "checkmark",
  "shield",
  "chart",
  "rocket",
  "clock",
  "lock",
  "database",
  "search",
  "gear",
  "lightbulb",
  "warning",
  "code",
  "network",
  "pin",
] as const;
export type VisualIcon = (typeof VISUAL_ICONS)[number];

/**
 * 8×8 glyphs. `x` is drawn in the accent colour, `o` in the outline colour and
 * `.` is left empty. Hand-drawn so they stay legible when a picture is scaled
 * down to a feed card.
 */
export const VISUAL_ICON_SPRITES: Record<VisualIcon, readonly string[]> = {
  terminal: [
    "oooooooo",
    "o......o",
    "o.xx...o",
    "o...xx.o",
    "o.xx...o",
    "o......o",
    "o.xxxx.o",
    "oooooooo",
  ],
  bug: [
    "..x..x..",
    "...xx...",
    "..xxxx..",
    ".xxxxxx.",
    "x.xxxx.x",
    ".xxxxxx.",
    "..x..x..",
    ".x....x.",
  ],
  checkmark: [
    "........",
    ".......x",
    "......xx",
    ".x...xx.",
    ".xx.xx..",
    "..xxx...",
    "...x....",
    "........",
  ],
  shield: [
    ".xxxxxx.",
    "xxxxxxxx",
    "xx....xx",
    "xx.xx.xx",
    "xx....xx",
    ".xx..xx.",
    "..xxxx..",
    "...xx...",
  ],
  chart: [
    "........",
    "......xx",
    "......xx",
    "..xx..xx",
    "..xx..xx",
    "xxxx..xx",
    "xxxxxxxx",
    "........",
  ],
  rocket: [
    "...xx...",
    "..xxxx..",
    "..xxxx..",
    ".xxxxxx.",
    ".xxxxxx.",
    "x.xxxx.x",
    "x.x..x.x",
    "...xx...",
  ],
  clock: [
    ".xxxxxx.",
    "xx....xx",
    "x..x...x",
    "x..x...x",
    "x..xxx.x",
    "x......x",
    "xx....xx",
    ".xxxxxx.",
  ],
  lock: [
    "..xxxx..",
    ".xx..xx.",
    ".xx..xx.",
    "xxxxxxxx",
    "xx....xx",
    "xx.xx.xx",
    "xx....xx",
    "xxxxxxxx",
  ],
  database: [
    ".xxxxxx.",
    "xx....xx",
    ".xxxxxx.",
    "xx....xx",
    ".xxxxxx.",
    "xx....xx",
    ".xxxxxx.",
    "........",
  ],
  search: [
    ".xxxx...",
    "xx..xx..",
    "x....x..",
    "xx..xx..",
    ".xxxx...",
    "...xxx..",
    "....xxx.",
    ".....xx.",
  ],
  gear: [
    "..x..x..",
    ".xxxxxx.",
    "xxx..xxx",
    "x.x..x.x",
    "x.x..x.x",
    "xxx..xxx",
    ".xxxxxx.",
    "..x..x..",
  ],
  lightbulb: [
    "..xxxx..",
    ".xx..xx.",
    "xx....xx",
    "xx....xx",
    ".xx..xx.",
    "..xxxx..",
    "..x..x..",
    "..xxxx..",
  ],
  warning: [
    "...xx...",
    "...xx...",
    "..xxxx..",
    "..x..x..",
    ".xx.xx..",
    ".x.xx.x.",
    "xx....xx",
    "xxxxxxxx",
  ],
  code: [
    "........",
    "..x..x..",
    ".x....x.",
    "x......x",
    "x......x",
    ".x....x.",
    "..x..x..",
    "........",
  ],
  network: [
    "xx....xx",
    "xx....xx",
    "..x..x..",
    "...xx...",
    "...xx...",
    "..x..x..",
    "xx....xx",
    "xx....xx",
  ],
  pin: [
    "...xx...",
    "..xxxx..",
    ".xxxxxx.",
    ".xx..xx.",
    ".xxxxxx.",
    "..xxxx..",
    "...xx...",
    "...x....",
  ],
};

/** Per-template defaults and the eyebrow label printed at the top of the card. */
export const TEMPLATE_DEFAULTS: Record<
  VisualTemplate,
  {
    label: string;
    accent: VisualAccent;
    background: VisualBackground;
    icons: readonly VisualIcon[];
  }
> = {
  pixel_terminal: {
    label: "TERMINAL",
    accent: "cyan",
    background: "circuit_grid",
    icons: ["terminal"],
  },
  quote_card: { label: "FIELD NOTE", accent: "gold", background: "dither", icons: [] },
  project_update: {
    label: "PROJECT UPDATE",
    accent: "ember",
    background: "circuit_grid",
    icons: ["rocket"],
  },
  research_finding: {
    label: "RESEARCH FINDING",
    accent: "cyan",
    background: "star_field",
    icons: ["search"],
  },
  data_snapshot: {
    label: "DATA SNAPSHOT",
    accent: "mint",
    background: "scanlines",
    icons: ["chart"],
  },
  help_wanted: { label: "HELP WANTED", accent: "gold", background: "dither", icons: ["network"] },
  security_alert: {
    label: "SECURITY ALERT",
    accent: "ember",
    background: "scanlines",
    icons: ["shield"],
  },
  code_tip: { label: "CODE TIP", accent: "mint", background: "circuit_grid", icons: ["code"] },
};

// ---------------------------------------------------------------------------
// Text budgets
// ---------------------------------------------------------------------------

export const VISUAL_LIMITS = {
  headline: 60,
  subtext: 180,
  altText: 240,
  codeSnippet: 280,
  label: 24,
  statLabel: 24,
  statValue: 12,
  seed: 64,
  maxStats: 6,
  maxIcons: 6,
  /** Ceiling on the raw JSON body of a visual post request, in bytes. */
  maxRequestBytes: 8 * 1024,
} as const;
