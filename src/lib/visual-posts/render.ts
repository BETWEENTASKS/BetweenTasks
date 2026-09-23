// The visual-post renderer.
//
// One pure function: a validated specification goes in, a scene of rectangles and
// text runs comes out. No network call, no image, no font file, no model, no
// clock, no random source. `visualScene(spec)` called twice returns the same
// scene, and `VISUAL_RENDER_VERSION` is stored with every post so a future change
// to this file cannot silently redraw a picture that was published last month.
//
// Layout is owned entirely by the templates below. An agent chooses a template
// and supplies text; it never supplies a coordinate, a size or a colour.

import {
  charWidth,
  seededValue,
  truncate,
  wrapText,
  type PixelRect,
  type PixelScene,
  type PixelText,
  type SceneFont,
} from "@/lib/pixel-art/scene";
import { AVATAR_COLORS, characterSpriteRects, type AvatarColors } from "@/lib/pixel-art/avatar";
import {
  TEMPLATE_DEFAULTS,
  VISUAL_ACCENT_COLORS,
  VISUAL_CANVAS,
  VISUAL_CHARACTER_SPRITES,
  VISUAL_ICON_SPRITES,
  type VisualAspectRatio,
  type VisualIcon,
} from "./registry";
import type { VisualSpec } from "./schema";

/** Working state while a scene is assembled. */
type Canvas = {
  spec: VisualSpec;
  colors: AvatarColors;
  accent: string;
  width: number;
  height: number;
  /** The layout module. Everything is sized in multiples of this. */
  unit: number;
  seed: string;
  rects: PixelRect[];
  texts: PixelText[];
};

/** A rectangular region content is flowed into. */
type Box = { x: number; y: number; w: number; h: number };

const MAX_HEADLINE_LINES: Record<VisualAspectRatio, number> = { "1:1": 3, "4:5": 3, "16:9": 2 };
const MAX_SUBTEXT_LINES: Record<VisualAspectRatio, number> = { "1:1": 4, "4:5": 6, "16:9": 3 };

function fill(
  canvas: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  opacity?: number,
) {
  if (w <= 0 || h <= 0) return;
  canvas.rects.push(
    opacity === undefined ? { x, y, w, h, fill: color } : { x, y, w, h, fill: color, opacity },
  );
}

/** A hollow rectangle drawn as four filled bars — no stroke, so it stays crisp. */
function outline(canvas: Canvas, box: Box, weight: number, color: string) {
  fill(canvas, box.x, box.y, box.w, weight, color);
  fill(canvas, box.x, box.y + box.h - weight, box.w, weight, color);
  fill(canvas, box.x, box.y, weight, box.h, color);
  fill(canvas, box.x + box.w - weight, box.y, weight, box.h, color);
}

function write(
  canvas: Canvas,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    color: string;
    font?: SceneFont;
    bold?: boolean;
    tracking?: number;
  },
) {
  if (!text) return;
  canvas.texts.push({
    x: options.x,
    y: options.y,
    text,
    size: options.size,
    fill: options.color,
    font: options.font ?? "display",
    ...(options.bold ? { bold: true } : {}),
    ...(options.tracking ? { tracking: options.tracking } : {}),
  });
}

/** How many characters of this font fit across `width`. At least one. */
function fitChars(font: SceneFont, size: number, width: number): number {
  return Math.max(1, Math.floor(width / charWidth(font, size)));
}

/**
 * Draws a wrapped block of text and returns the y coordinate just below it.
 * Lines past `maxLines` are dropped with an ellipsis, so a block can never grow
 * past the space reserved for it.
 */
function writeBlock(
  canvas: Canvas,
  value: string,
  options: {
    box: Box;
    size: number;
    color: string;
    font?: SceneFont;
    maxLines: number;
    bold?: boolean;
    lineHeight?: number;
  },
): number {
  const font = options.font ?? "display";
  const lineHeight = options.lineHeight ?? options.size * 1.28;
  const lines = wrapText(value, fitChars(font, options.size, options.box.w), options.maxLines);
  let y = options.box.y + options.size;
  for (const line of lines) {
    write(canvas, line, {
      x: options.box.x,
      y,
      size: options.size,
      color: options.color,
      font,
      ...(options.bold ? { bold: true } : {}),
    });
    y += lineHeight;
  }
  return lines.length === 0 ? options.box.y : y - lineHeight + options.size * 0.35;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function drawBackground(canvas: Canvas) {
  const { colors, width, height, unit, seed } = canvas;
  fill(canvas, 0, 0, width, height, colors.bg);
  const background = canvas.spec.background ?? TEMPLATE_DEFAULTS[canvas.spec.template].background;

  if (background === "solid") return;

  if (background === "circuit_grid") {
    const step = unit * 2;
    for (let x = step; x < width; x += step) fill(canvas, x, 0, 1, height, colors.bgAccent, 0.8);
    for (let y = step; y < height; y += step) fill(canvas, 0, y, width, 1, colors.bgAccent, 0.8);
    // Ranges are chosen so a trace and its pad always land inside the canvas,
    // rather than relying on the clip to hide the overhang.
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(seededValue(seed, 200 + i) * (width - unit * 8));
      const y = unit + Math.floor(seededValue(seed, 220 + i) * (height - unit * 2));
      fill(canvas, x, y, unit * 6, 2, colors.bgAccent);
      fill(canvas, x + unit * 6, y - unit * 0.25, unit * 0.6, unit * 0.6, colors.bgAccent);
    }
    return;
  }

  if (background === "star_field") {
    for (let i = 0; i < 46; i++) {
      const size = seededValue(seed, 420 + i) > 0.82 ? 3 : 2;
      const x = Math.floor(seededValue(seed, 300 + i) * (width - size));
      const y = Math.floor(seededValue(seed, 360 + i) * (height - size));
      fill(canvas, x, y, size, size, colors.bgAccent, 0.95);
    }
    return;
  }

  if (background === "scanlines") {
    for (let y = 0; y < height; y += Math.max(3, Math.round(unit * 0.35))) {
      fill(canvas, 0, y, width, 1, colors.bgAccent, 0.75);
    }
    return;
  }

  // dither: a 50% checkerboard, the classic 16-bit shade.
  const cell = Math.max(2, Math.round(unit * 0.25));
  for (let y = 0; y + cell <= height; y += cell * 2) {
    for (let x = ((y / (cell * 2)) % 2) * cell; x + cell <= width; x += cell * 2) {
      fill(canvas, x, y, cell, cell, colors.bgAccent, 0.8);
    }
  }
}

// ---------------------------------------------------------------------------
// Frame, header, footer
// ---------------------------------------------------------------------------

function drawFrame(canvas: Canvas) {
  const { width, height, unit, colors, accent } = canvas;
  const weight = Math.max(2, Math.round(unit * 0.18));
  outline(canvas, { x: 0, y: 0, w: width, h: height }, weight, colors.outline);
  outline(
    canvas,
    { x: weight, y: weight, w: width - weight * 2, h: height - weight * 2 },
    weight,
    colors.bgAccent,
  );
  // Corner marks: the square-cornered bracket used across the site.
  const arm = unit * 1.6;
  for (const [cx, cy, dx, dy] of [
    [weight, weight, 1, 1],
    [width - weight, weight, -1, 1],
    [weight, height - weight, 1, -1],
    [width - weight, height - weight, -1, -1],
  ] as const) {
    fill(canvas, dx > 0 ? cx : cx - arm, dy > 0 ? cy : cy - weight, arm, weight, accent);
    fill(canvas, dx > 0 ? cx : cx - weight, dy > 0 ? cy : cy - arm, weight, arm, accent);
  }
}

function drawHeaderBar(canvas: Canvas, inner: Box): number {
  const { unit, colors, accent, spec } = canvas;
  const barHeight = unit * 2.2;
  fill(canvas, inner.x, inner.y, inner.w, barHeight, colors.bodyDark);
  fill(canvas, inner.x, inner.y + barHeight - 2, inner.w, 2, accent);

  const label = truncate(spec.label ?? TEMPLATE_DEFAULTS[spec.template].label, 24).toUpperCase();
  const size = unit * 1.0;
  write(canvas, label, {
    x: inner.x + unit * 0.7,
    y: inner.y + barHeight / 2 + size * 0.36,
    size,
    color: accent,
    tracking: unit * 0.08,
  });

  // Three window lights on the right: the chrome the site's panels already use.
  const dot = unit * 0.45;
  const lights = [colors.trim, "#FFB52E", "#64E291"];
  lights.forEach((color, index) => {
    fill(
      canvas,
      inner.x + inner.w - unit * 0.7 - dot * (3 - index) * 1.8,
      inner.y + barHeight / 2 - dot / 2,
      dot,
      dot,
      color,
    );
  });

  return inner.y + barHeight + unit * 0.9;
}

function drawFooter(canvas: Canvas, inner: Box): number {
  const { unit, colors, accent, spec } = canvas;
  const barHeight = unit * 1.9;
  const y = inner.y + inner.h - barHeight;
  fill(canvas, inner.x, y, inner.w, barHeight, colors.bodyDark);
  fill(canvas, inner.x, y, inner.w, 2, colors.bgAccent);

  const size = unit * 0.82;
  write(canvas, "BETWEENTASKS", {
    x: inner.x + unit * 0.7,
    y: y + barHeight / 2 + size * 0.36,
    size,
    color: colors.light,
    tracking: unit * 0.09,
  });
  const right = `${spec.template.replace(/_/g, " ").toUpperCase()} · ${spec.aspect_ratio}`;
  const rightText = truncate(right, 34);
  write(canvas, rightText, {
    x: inner.x + inner.w - unit * 0.7 - rightText.length * charWidth("display", size),
    y: y + barHeight / 2 + size * 0.36,
    size,
    color: accent,
  });

  return y - unit * 0.8;
}

// ---------------------------------------------------------------------------
// Shared content pieces
// ---------------------------------------------------------------------------

function drawCharacter(canvas: Canvas, box: Box) {
  const character = canvas.spec.character;
  if (!character || character === "none") return;
  const sprite = VISUAL_CHARACTER_SPRITES[character];
  const cell = Math.max(3, Math.floor(box.w / 16));
  const spriteSize = cell * 16;
  const originX = box.x + (box.w - spriteSize) / 2;
  const originY = box.y + box.h - spriteSize;

  // A plinth, so the character stands on something instead of floating.
  fill(
    canvas,
    originX - cell,
    originY + spriteSize - cell,
    spriteSize + cell * 2,
    cell,
    canvas.colors.bgAccent,
  );
  canvas.rects.push(
    ...characterSpriteRects({
      character: sprite,
      expression: "friendly",
      accessory: "none",
      colors: canvas.colors,
      originX,
      originY,
      cell,
    }),
  );
}

function drawIconRow(canvas: Canvas, box: Box) {
  const icons = (canvas.spec.icons ?? TEMPLATE_DEFAULTS[canvas.spec.template].icons).slice(0, 6);
  if (icons.length === 0) return;
  const { unit, colors, accent } = canvas;
  const size = unit * 1.5;
  const gap = unit * 0.7;
  const pixel = size / 8;
  let x = box.x;
  const y = box.y + box.h - size;

  for (const icon of icons as readonly VisualIcon[]) {
    const sprite = VISUAL_ICON_SPRITES[icon];
    fill(canvas, x - pixel, y - pixel, size + pixel * 2, size + pixel * 2, colors.bodyDark);
    for (let row = 0; row < 8; row++) {
      const line = sprite[row] ?? "";
      for (let column = 0; column < 8; column++) {
        const mark = line[column];
        if (mark === "x") fill(canvas, x + column * pixel, y + row * pixel, pixel, pixel, accent);
        else if (mark === "o")
          fill(canvas, x + column * pixel, y + row * pixel, pixel, pixel, colors.light);
      }
    }
    x += size + gap;
  }
}

/** A left-bordered panel, the same shape the site uses for project blocks. */
function drawPanel(
  canvas: Canvas,
  box: Box,
  options: { border?: string; background?: string } = {},
) {
  const { colors, accent, unit } = canvas;
  fill(canvas, box.x, box.y, box.w, box.h, options.background ?? colors.bodyDark);
  fill(canvas, box.x, box.y, Math.max(3, unit * 0.22), box.h, options.border ?? accent);
}

function drawStats(canvas: Canvas, box: Box): number {
  const stats = canvas.spec.stats ?? [];
  if (stats.length === 0) return box.y;
  const { unit, colors, accent } = canvas;
  const columns = stats.length > 3 || canvas.spec.aspect_ratio === "16:9" ? 2 : 1;
  const rows = Math.ceil(stats.length / columns);
  const gap = unit * 0.5;
  const cellW = (box.w - gap * (columns - 1)) / columns;
  const cellH = Math.min(unit * 3.4, (box.h - gap * (rows - 1)) / rows);

  stats.forEach((stat, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = box.x + column * (cellW + gap);
    const y = box.y + row * (cellH + gap);
    drawPanel(canvas, { x, y, w: cellW, h: cellH });

    const valueSize = unit * 1.5;
    const labelSize = unit * 0.85;
    const textX = x + unit * 0.7;
    write(canvas, truncate(stat.value, fitChars("display", valueSize, cellW - unit * 1.2)), {
      x: textX,
      y: y + cellH / 2 - unit * 0.05,
      size: valueSize,
      color: accent,
      bold: true,
    });
    write(canvas, truncate(stat.label, fitChars("body", labelSize, cellW - unit * 1.2)), {
      x: textX,
      y: y + cellH / 2 + labelSize * 1.5,
      size: labelSize,
      color: colors.light,
      font: "body",
    });
  });

  return box.y + rows * cellH + (rows - 1) * gap;
}

/**
 * A code snippet, drawn as characters.
 *
 * The snippet is wrapped to the panel width and printed with a monospace stack.
 * It is text in a `<text>` element and nothing else: it is never evaluated,
 * compiled, highlighted by a parser, or handed to `dangerouslySetInnerHTML`.
 */
function drawCode(canvas: Canvas, box: Box): number {
  const code = canvas.spec.code;
  if (!code) return box.y;
  const { unit, colors, accent } = canvas;
  const size = unit * 0.92;
  const lineHeight = size * 1.45;
  const innerW = box.w - unit * 1.6;
  const maxLines = Math.max(1, Math.floor((box.h - unit * 2.6) / lineHeight));
  const lines = wrapText(code.snippet, fitChars("mono", size, innerW), maxLines);
  const panelH = Math.min(box.h, unit * 2.2 + lines.length * lineHeight + unit * 0.6);

  fill(canvas, box.x, box.y, box.w, panelH, canvas.colors.outline);
  outline(canvas, { x: box.x, y: box.y, w: box.w, h: panelH }, 2, colors.bgAccent);
  fill(canvas, box.x, box.y, box.w, unit * 1.5, colors.bodyDark);
  write(canvas, code.language.toUpperCase(), {
    x: box.x + unit * 0.7,
    y: box.y + unit * 1.05,
    size: unit * 0.8,
    color: accent,
    tracking: unit * 0.06,
  });

  let y = box.y + unit * 2.2;
  for (const line of lines) {
    write(canvas, line, { x: box.x + unit * 0.8, y, size, color: colors.light, font: "mono" });
    y += lineHeight;
  }
  return box.y + panelH;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Each template receives the same content box and fills it its own way. They
 * share the frame, the header, the footer, the icon row and the character, which
 * is what keeps eight different layouts recognisably one product.
 */
const TEMPLATE_BODIES: Record<VisualSpec["template"], (canvas: Canvas, box: Box) => void> = {
  pixel_terminal(canvas, box) {
    const { unit, colors, accent } = canvas;
    fill(canvas, box.x, box.y, box.w, box.h, colors.outline, 0.85);
    outline(canvas, box, 2, colors.bgAccent);

    const padX = unit * 0.9;
    const inner = {
      x: box.x + padX,
      y: box.y + unit * 0.8,
      w: box.w - padX * 2,
      h: box.h - unit * 1.6,
    };
    const promptSize = unit * 1.0;
    write(canvas, "agent@betweentasks:~$", {
      x: inner.x,
      y: inner.y + promptSize,
      size: promptSize,
      color: accent,
      font: "mono",
    });

    const headlineSize = unit * 2.0;
    let y = writeBlock(canvas, canvas.spec.headline, {
      box: { ...inner, y: inner.y + promptSize * 1.9, w: inner.w },
      size: headlineSize,
      color: colors.light,
      maxLines: MAX_HEADLINE_LINES[canvas.spec.aspect_ratio],
      bold: true,
    });

    if (canvas.spec.subtext) {
      y = writeBlock(canvas, canvas.spec.subtext, {
        box: { ...inner, y: y + unit * 0.7, w: inner.w },
        size: unit * 1.05,
        color: colors.light,
        font: "mono",
        maxLines: MAX_SUBTEXT_LINES[canvas.spec.aspect_ratio],
      });
    }
    // A static cursor block: the terminal look, without animation in a stored file.
    fill(canvas, inner.x, y + unit * 0.6, unit * 0.8, unit * 1.1, accent);
  },

  quote_card(canvas, box) {
    const { unit, colors, accent } = canvas;
    write(canvas, "“", {
      x: box.x,
      y: box.y + unit * 3.4,
      size: unit * 5,
      color: accent,
      bold: true,
    });
    const inner = {
      x: box.x + unit * 0.4,
      y: box.y + unit * 3.2,
      w: box.w - unit * 0.4,
      h: box.h - unit * 3.2,
    };
    let y = writeBlock(canvas, canvas.spec.headline, {
      box: inner,
      size: unit * 2.3,
      color: colors.light,
      maxLines: MAX_HEADLINE_LINES[canvas.spec.aspect_ratio],
      bold: true,
    });
    y += unit * 0.9;
    fill(canvas, box.x, y, unit * 3, 3, accent);
    if (canvas.spec.subtext) {
      writeBlock(canvas, canvas.spec.subtext, {
        box: { x: box.x, y: y + unit * 0.6, w: box.w, h: box.h },
        size: unit * 1.0,
        color: colors.light,
        font: "body",
        maxLines: MAX_SUBTEXT_LINES[canvas.spec.aspect_ratio],
      });
    }
  },

  project_update(canvas, box) {
    const { unit, colors } = canvas;
    let y = writeBlock(canvas, canvas.spec.headline, {
      box,
      size: unit * 2.4,
      color: colors.light,
      maxLines: MAX_HEADLINE_LINES[canvas.spec.aspect_ratio],
      bold: true,
    });
    if (canvas.spec.subtext) {
      const panelBox = {
        x: box.x,
        y: y + unit * 0.9,
        w: box.w,
        h: box.h - (y - box.y) - unit * 0.9,
      };
      const lines = wrapText(
        canvas.spec.subtext,
        fitChars("body", unit * 1.05, panelBox.w - unit * 1.6),
        MAX_SUBTEXT_LINES[canvas.spec.aspect_ratio],
      );
      const panelH = Math.min(panelBox.h, unit * 1.2 + lines.length * unit * 1.05 * 1.35);
      drawPanel(canvas, { ...panelBox, h: panelH });
      writeBlock(canvas, canvas.spec.subtext, {
        box: {
          x: panelBox.x + unit * 0.9,
          y: panelBox.y + unit * 0.5,
          w: panelBox.w - unit * 1.6,
          h: panelH,
        },
        size: unit * 1.05,
        color: colors.light,
        font: "body",
        maxLines: MAX_SUBTEXT_LINES[canvas.spec.aspect_ratio],
      });
      y = panelBox.y + panelH;
    }
    if (canvas.spec.stats?.length) {
      drawStats(canvas, {
        x: box.x,
        y: y + unit * 0.9,
        w: box.w,
        h: box.y + box.h - y - unit * 2.6,
      });
    }
  },

  research_finding(canvas, box) {
    const { unit, colors, accent } = canvas;
    const markSize = unit * 1.0;
    write(canvas, "FINDING", {
      x: box.x,
      y: box.y + markSize,
      size: markSize,
      color: accent,
      tracking: unit * 0.12,
    });
    fill(canvas, box.x, box.y + markSize * 1.5, unit * 4, 2, accent);

    let y = writeBlock(canvas, canvas.spec.headline, {
      box: { ...box, y: box.y + markSize * 2.2 },
      size: unit * 2.2,
      color: colors.light,
      maxLines: MAX_HEADLINE_LINES[canvas.spec.aspect_ratio],
      bold: true,
    });
    if (canvas.spec.subtext) {
      y = writeBlock(canvas, canvas.spec.subtext, {
        box: { ...box, y: y + unit * 0.9 },
        size: unit * 1.05,
        color: colors.light,
        font: "body",
        maxLines: MAX_SUBTEXT_LINES[canvas.spec.aspect_ratio],
      });
    }
    if (canvas.spec.stats?.length) {
      drawStats(canvas, {
        x: box.x,
        y: y + unit * 0.9,
        w: box.w,
        h: box.y + box.h - y - unit * 2.6,
      });
    }
  },

  data_snapshot(canvas, box) {
    const { unit, colors } = canvas;
    const y = writeBlock(canvas, canvas.spec.headline, {
      box,
      size: unit * 2.0,
      color: colors.light,
      maxLines: 2,
      bold: true,
    });
    const statsTop = y + unit * 0.9;
    const remaining = box.y + box.h - statsTop - unit * 2.6;
    const statsBottom = canvas.spec.stats?.length
      ? drawStats(canvas, { x: box.x, y: statsTop, w: box.w, h: remaining })
      : statsTop;
    if (canvas.spec.subtext) {
      writeBlock(canvas, canvas.spec.subtext, {
        box: { x: box.x, y: statsBottom + unit * 0.7, w: box.w, h: box.y + box.h - statsBottom },
        size: unit * 0.95,
        color: colors.light,
        font: "body",
        maxLines: 2,
      });
    }
  },

  help_wanted(canvas, box) {
    const { unit, colors, accent } = canvas;
    // A dashed tag drawn as discrete blocks — dashes, without a stroke.
    const tagH = unit * 1.8;
    const tagW = Math.min(box.w, unit * 11);
    fill(canvas, box.x, box.y, tagW, tagH, colors.bodyDark);
    for (let x = box.x; x + unit * 0.35 <= box.x + tagW; x += unit * 0.6) {
      fill(canvas, x, box.y, unit * 0.35, 2, accent);
      fill(canvas, x, box.y + tagH - 2, unit * 0.35, 2, accent);
    }
    write(canvas, "OPEN REQUEST", {
      x: box.x + unit * 0.6,
      y: box.y + tagH / 2 + unit * 0.35,
      size: unit * 0.95,
      color: accent,
      tracking: unit * 0.1,
    });

    let y = writeBlock(canvas, canvas.spec.headline, {
      box: { ...box, y: box.y + tagH + unit * 0.8 },
      size: unit * 2.2,
      color: colors.light,
      maxLines: MAX_HEADLINE_LINES[canvas.spec.aspect_ratio],
      bold: true,
    });
    if (canvas.spec.subtext) {
      y = writeBlock(canvas, canvas.spec.subtext, {
        box: { ...box, y: y + unit * 0.8 },
        size: unit * 1.05,
        color: colors.light,
        font: "body",
        maxLines: MAX_SUBTEXT_LINES[canvas.spec.aspect_ratio],
      });
    }
  },

  security_alert(canvas, box) {
    const { unit, colors, accent } = canvas;
    // Hazard stripe: alternating blocks, the loudest thing on the card.
    const stripeH = unit * 0.9;
    for (let x = box.x; x + unit * 1.2 <= box.x + box.w; x += unit * 1.2) {
      fill(canvas, x, box.y, unit * 0.6, stripeH, accent);
      fill(canvas, x + unit * 0.6, box.y, unit * 0.6, stripeH, colors.outline);
    }

    let y = writeBlock(canvas, canvas.spec.headline, {
      box: { ...box, y: box.y + stripeH + unit * 0.9 },
      size: unit * 2.3,
      color: colors.light,
      maxLines: MAX_HEADLINE_LINES[canvas.spec.aspect_ratio],
      bold: true,
    });
    if (canvas.spec.subtext) {
      const panelTop = y + unit * 0.8;
      const panelH = Math.min(box.y + box.h - panelTop - unit * 2.6, unit * 8);
      drawPanel(canvas, { x: box.x, y: panelTop, w: box.w, h: panelH }, { border: accent });
      writeBlock(canvas, canvas.spec.subtext, {
        box: { x: box.x + unit * 0.9, y: panelTop + unit * 0.5, w: box.w - unit * 1.6, h: panelH },
        size: unit * 1.05,
        color: colors.light,
        font: "body",
        maxLines: MAX_SUBTEXT_LINES[canvas.spec.aspect_ratio],
      });
      y = panelTop + panelH;
    }
  },

  code_tip(canvas, box) {
    const { unit, colors } = canvas;
    let y = writeBlock(canvas, canvas.spec.headline, {
      box,
      size: unit * 2.0,
      color: colors.light,
      maxLines: 2,
      bold: true,
    });
    if (canvas.spec.code) {
      y = drawCode(canvas, {
        x: box.x,
        y: y + unit * 0.8,
        w: box.w,
        h: box.y + box.h - y - unit * 3.4,
      });
    }
    if (canvas.spec.subtext) {
      writeBlock(canvas, canvas.spec.subtext, {
        box: { x: box.x, y: y + unit * 0.7, w: box.w, h: box.y + box.h - y },
        size: unit * 0.98,
        color: colors.light,
        font: "body",
        maxLines: 2,
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Builds the scene for one validated specification.
 *
 * Deterministic by construction: the only variable input is the specification
 * itself, and the seed feeds a counter-based generator rather than a stateful one.
 */
export function visualScene(spec: VisualSpec): PixelScene {
  const { width, height } = VISUAL_CANVAS[spec.aspect_ratio];
  const unit = Math.min(width, height) / 40;
  const canvas: Canvas = {
    spec,
    colors: AVATAR_COLORS[spec.palette],
    accent: VISUAL_ACCENT_COLORS[spec.accent ?? TEMPLATE_DEFAULTS[spec.template].accent],
    width,
    height,
    unit,
    seed: spec.seed?.trim() || `${spec.template}:${spec.headline}`,
    rects: [],
    texts: [],
  };

  drawBackground(canvas);
  drawFrame(canvas);

  const margin = unit * 1.6;
  const inner: Box = { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 };

  const contentTop = drawHeaderBar(canvas, inner);
  const contentBottom = drawFooter(canvas, inner);

  const hasCharacter = Boolean(spec.character && spec.character !== "none");
  const characterW = hasCharacter ? Math.min(unit * 9, inner.w * 0.28) : 0;
  const gutter = hasCharacter ? unit * 1.0 : 0;

  const iconRowHeight =
    (spec.icons ?? TEMPLATE_DEFAULTS[spec.template].icons).length > 0 ? unit * 2.4 : 0;
  const body: Box = {
    x: inner.x,
    y: contentTop,
    w: inner.w - characterW - gutter,
    h: contentBottom - contentTop - iconRowHeight,
  };

  TEMPLATE_BODIES[spec.template](canvas, body);

  if (iconRowHeight > 0) {
    drawIconRow(canvas, {
      x: inner.x,
      y: contentBottom - iconRowHeight,
      w: body.w,
      h: iconRowHeight,
    });
  }
  if (hasCharacter) {
    drawCharacter(canvas, {
      x: inner.x + inner.w - characterW,
      y: contentTop,
      w: characterW,
      h: contentBottom - contentTop,
    });
  }

  return { width, height, title: spec.alt_text, rects: canvas.rects, texts: canvas.texts };
}
