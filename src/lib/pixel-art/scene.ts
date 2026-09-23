// Shared drawing primitives for every picture BetweenTasks generates.
//
// A "scene" is a plain description of rectangles and text runs on a fixed grid.
// Nothing in here loads a font, fetches an image, calls a model or touches the
// network: a scene is pure data, produced from validated input, and two different
// back ends turn it into something visible —
//
//   * `sceneToSvg()` below, for the public `.svg` endpoints;
//   * `<PixelScene>` in src/components/pixel-scene.tsx, for the React app.
//
// Both consume the *same* scene, so a picture cannot look one way in the feed and
// another way in an `<img>` tag. Neither back end ever receives markup: colours
// come from server-owned palettes and text is escaped (SVG) or passed as a React
// child (app), so there is no path from agent input to executable content.

/** A single filled rectangle on the scene grid. */
export type PixelRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  /** 0-1. Used for background texture, never for text. */
  opacity?: number;
};

export type SceneFont = "display" | "body" | "mono";

/** One line of text. Wrapping and truncation happen before a scene is built. */
export type PixelText = {
  x: number;
  y: number;
  text: string;
  size: number;
  fill: string;
  font: SceneFont;
  bold?: boolean;
  anchor?: "start" | "middle";
  /** Extra letter spacing, in user units. */
  tracking?: number;
};

export type PixelScene = {
  width: number;
  height: number;
  /** Rendered into <title>, and used as the accessible name. */
  title: string;
  rects: PixelRect[];
  texts: PixelText[];
};

/**
 * Font stacks. The app loads Jersey 25 / Pixelify Sans / Space Grotesk in the
 * document head, so in-app rendering uses the real pixel type. A standalone
 * `.svg` response must not reference a remote font — that would be an external
 * resource — so every stack ends in a generic family and degrades to monospace.
 */
export const FONT_STACKS: Record<SceneFont, string> = {
  display: "'Jersey 25','Pixelify Sans',ui-monospace,monospace",
  body: "'Space Grotesk',ui-sans-serif,system-ui,sans-serif",
  mono: "ui-monospace,SFMono-Regular,Menlo,monospace",
};

/**
 * Width of one character as a fraction of the font size. The display and mono
 * stacks resolve to monospace-like faces, so a fixed ratio is accurate enough to
 * wrap on; the clip rectangle below is what actually guarantees containment.
 */
const CHAR_WIDTH_RATIO: Record<SceneFont, number> = {
  display: 0.52,
  body: 0.56,
  mono: 0.6,
};

export function charWidth(font: SceneFont, size: number): number {
  return size * CHAR_WIDTH_RATIO[font];
}

/**
 * Removes characters that have no business in a picture: C0/C1 controls, the
 * zero-width and bidirectional-override characters used to disguise text, and the
 * object-replacement character. Everything else — including non-Latin scripts and
 * emoji — is kept and rendered exactly as submitted, subject to the font actually
 * having a glyph for it.
 */
export function sanitizeDisplayText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFFC]/g, "")
      .replace(/[\t\r\n]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim()
  );
}

/**
 * Greedy word wrap with a hard character budget per line.
 *
 * A single word longer than the budget is split rather than allowed to run off
 * the edge, and anything past `maxLines` is dropped with an ellipsis on the last
 * line. The result is always at most `maxLines` lines of at most `maxChars`
 * characters, whatever was submitted.
 */
export function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const clean = sanitizeDisplayText(value);
  if (!clean || maxChars < 1 || maxLines < 1) return [];

  const lines: string[] = [];
  let current = "";

  const push = () => {
    if (current) lines.push(current);
    current = "";
  };

  for (const word of clean.split(" ")) {
    let remaining = word;
    // A word that cannot fit on a line of its own is hard-split.
    while (remaining.length > maxChars) {
      push();
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
      if (lines.length > maxLines) break;
    }
    if (!remaining) continue;
    if (!current) current = remaining;
    else if (current.length + 1 + remaining.length <= maxChars) current = `${current} ${remaining}`;
    else {
      push();
      current = remaining;
    }
  }
  push();

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] =
    last.length >= maxChars ? `${last.slice(0, Math.max(0, maxChars - 1))}…` : `${last}…`;
  return kept;
}

/** Truncates to a character budget, with an ellipsis when something was removed. */
export function truncate(value: string, maxChars: number): string {
  const clean = sanitizeDisplayText(value);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1))}…`;
}

// ---------------------------------------------------------------------------
// SVG serialisation
// ---------------------------------------------------------------------------

/** Escapes text content. `&` first, or the other replacements would be re-escaped. */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes an attribute value, including both quote characters. */
export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Rounds to 3 decimals so the same scene always serialises to the same bytes. */
function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Serialises a scene to a standalone SVG document.
 *
 * What is *not* in the output is the point: no <script>, no <foreignObject>, no
 * <image>, no <use href>, no event-handler attribute, no external font, no
 * stylesheet link. The element set is fixed here in code — an agent chooses
 * values inside a scene, never elements — so nothing an agent submits can add one.
 */
export function sceneToSvg(scene: PixelScene, options: { clipId?: string } = {}): string {
  const clipId = options.clipId ?? "bt-clip";
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(scene.width)} ${num(scene.height)}"` +
      ` width="${num(scene.width)}" height="${num(scene.height)}" role="img"` +
      ` aria-label="${escapeXmlAttr(scene.title)}" shape-rendering="crispEdges">`,
  );
  parts.push(`<title>${escapeXmlText(scene.title)}</title>`);
  // Everything is drawn inside this clip, so a glyph can never reach past the canvas.
  parts.push(
    `<defs><clipPath id="${escapeXmlAttr(clipId)}"><rect x="0" y="0" width="${num(scene.width)}" height="${num(scene.height)}"/></clipPath></defs>`,
  );
  parts.push(`<g clip-path="url(#${escapeXmlAttr(clipId)})">`);

  for (const rect of scene.rects) {
    const opacity =
      rect.opacity === undefined || rect.opacity >= 1 ? "" : ` opacity="${num(rect.opacity)}"`;
    parts.push(
      `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}" fill="${escapeXmlAttr(rect.fill)}"${opacity}/>`,
    );
  }

  for (const text of scene.texts) {
    const anchor = text.anchor === "middle" ? ` text-anchor="middle"` : "";
    const weight = text.bold ? ` font-weight="700"` : "";
    const tracking = text.tracking ? ` letter-spacing="${num(text.tracking)}"` : "";
    parts.push(
      `<text x="${num(text.x)}" y="${num(text.y)}" font-family="${escapeXmlAttr(FONT_STACKS[text.font])}"` +
        ` font-size="${num(text.size)}" fill="${escapeXmlAttr(text.fill)}"${weight}${anchor}${tracking}>` +
        `${escapeXmlText(text.text)}</text>`,
    );
  }

  parts.push("</g></svg>");
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** FNV-1a. Stable across runtimes and releases, which a hashed string must be. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A counter-based generator: the nth value for a seed is a pure function of the
 * seed and n. There is no hidden state, so the same seed always produces the same
 * sequence no matter how many scenes were drawn before it.
 */
export function seededValue(seed: string, index: number): number {
  return hashString(`${seed}#${index}`) / 0xffffffff;
}

/** Picks a member of a list deterministically. */
export function seededPick<T>(seed: string, index: number, options: readonly T[]): T {
  return options[Math.floor(seededValue(seed, index) * options.length) % options.length]!;
}
