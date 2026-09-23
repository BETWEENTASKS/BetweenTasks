import { describe, expect, test } from "bun:test";
import {
  charWidth,
  escapeXmlAttr,
  escapeXmlText,
  sceneToSvg,
  wrapText,
  type PixelScene,
} from "@/lib/pixel-art/scene";
import { AVATAR_COLORS } from "@/lib/pixel-art/avatar";
import { visualScene } from "../render";
import { parseVisualSpec, type VisualSpec } from "../schema";
import {
  VISUAL_ACCENT_COLORS,
  VISUAL_ASPECT_RATIOS,
  VISUAL_CANVAS,
  VISUAL_ICONS,
  VISUAL_PALETTES,
  VISUAL_TEMPLATES,
} from "../registry";

function spec(overrides: Record<string, unknown> = {}): VisualSpec {
  const parsed = parseVisualSpec({
    schema_version: 1,
    template: "pixel_terminal",
    aspect_ratio: "1:1",
    palette: "cyber",
    seed: "testing-early",
    headline: "TEST EARLY",
    subtext: "Debug before you deploy.",
    character: "robot_programmer",
    icons: ["terminal", "bug", "checkmark"],
    background: "circuit_grid",
    accent: "cyan",
    alt_text: "A pixel-art robot debugging a terminal with the words Test Early.",
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.spec;
}

/** Template-specific required data, so every template can be exercised. */
function specFor(
  template: (typeof VISUAL_TEMPLATES)[number],
  overrides: Record<string, unknown> = {},
): VisualSpec {
  const extra: Record<string, unknown> =
    template === "data_snapshot"
      ? {
          stats: [
            { label: "Tests passed", value: "96" },
            { label: "Failures", value: "0" },
            { label: "Coverage", value: "88%" },
          ],
        }
      : template === "code_tip"
        ? { code: { language: "typescript", snippet: "const result = await runTest();" } }
        : {};
  return spec({ template, ...extra, ...overrides });
}

function textsOf(scene: PixelScene): string[] {
  return scene.texts.map((t) => t.text);
}

describe("determinism", () => {
  test("the same specification always produces the same scene", () => {
    expect(JSON.stringify(visualScene(spec()))).toBe(JSON.stringify(visualScene(spec())));
  });

  test("the same specification always serialises to the same bytes", () => {
    expect(sceneToSvg(visualScene(spec()))).toBe(sceneToSvg(visualScene(spec())));
  });

  test("the seed, not a random source, drives the background texture", () => {
    const a = sceneToSvg(visualScene(spec({ seed: "alpha" })));
    const b = sceneToSvg(visualScene(spec({ seed: "beta" })));
    const aAgain = sceneToSvg(visualScene(spec({ seed: "alpha" })));
    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
  });

  test("a specification without a seed is still deterministic", () => {
    const withoutSeed = spec({ seed: undefined });
    expect(sceneToSvg(visualScene(withoutSeed))).toBe(sceneToSvg(visualScene(withoutSeed)));
  });
});

describe("every template, ratio and palette renders", () => {
  for (const template of VISUAL_TEMPLATES) {
    for (const aspect_ratio of VISUAL_ASPECT_RATIOS) {
      test(`${template} at ${aspect_ratio}`, () => {
        const scene = visualScene(specFor(template, { aspect_ratio }));
        const canvas = VISUAL_CANVAS[aspect_ratio];
        expect(scene.width).toBe(canvas.width);
        expect(scene.height).toBe(canvas.height);
        expect(scene.rects.length).toBeGreaterThan(10);
        expect(scene.texts.length).toBeGreaterThan(0);
        // The headline is the point of the card: it must survive to the output.
        expect(textsOf(scene).join(" ")).toContain("TEST EARLY");
      });
    }
  }

  for (const palette of VISUAL_PALETTES) {
    test(`the ${palette} palette draws only its own colours plus the accent`, () => {
      const scene = visualScene(spec({ palette }));
      const allowed = new Set<string>([
        ...Object.values(AVATAR_COLORS[palette]),
        ...Object.values(VISUAL_ACCENT_COLORS),
      ]);
      for (const rect of scene.rects) {
        expect({ fill: rect.fill, allowed: allowed.has(rect.fill) }).toEqual({
          fill: rect.fill,
          allowed: true,
        });
      }
      for (const text of scene.texts) {
        expect({ fill: text.fill, allowed: allowed.has(text.fill) }).toEqual({
          fill: text.fill,
          allowed: true,
        });
      }
    });
  }

  test("every icon renders", () => {
    for (const icon of VISUAL_ICONS) {
      const scene = visualScene(spec({ icons: [icon] }));
      expect(scene.rects.length).toBeGreaterThan(10);
    }
  });
});

describe("text is rendered exactly and stays on the canvas", () => {
  test("a short headline and subtext appear verbatim", () => {
    const scene = visualScene(
      spec({ headline: "Ship small changes", subtext: "They are easier to review." }),
    );
    const texts = textsOf(scene);
    expect(texts).toContain("Ship small changes");
    expect(texts).toContain("They are easier to review.");
  });

  test("a code snippet appears as characters, unmodified", () => {
    const snippet = "const map = new Map<string, () => void>();";
    const scene = visualScene(specFor("code_tip", { code: { language: "typescript", snippet } }));
    expect(textsOf(scene).join("\n")).toContain("const map = new Map");
  });

  test("statistics appear exactly as submitted", () => {
    const scene = visualScene(
      specFor("data_snapshot", {
        stats: [
          { label: "Tests passed", value: "96" },
          { label: "Failures", value: "0" },
        ],
      }),
    );
    const texts = textsOf(scene);
    expect(texts).toContain("Tests passed");
    expect(texts).toContain("96");
    expect(texts).toContain("Failures");
    expect(texts).toContain("0");
  });

  test("no text is laid out beyond the canvas, for any template or ratio", () => {
    for (const template of VISUAL_TEMPLATES) {
      for (const aspect_ratio of VISUAL_ASPECT_RATIOS) {
        // The worst case the schema permits: every field at its maximum length,
        // including a single unbroken word that cannot be wrapped on a space.
        const scene = visualScene(
          specFor(template, {
            aspect_ratio,
            headline: "Supercalifragilisticexpialidociousandthensome-longer",
            subtext: "W".repeat(180),
            label: "AN EXTREMELY LONG LABEL!",
            stats: Array.from({ length: 6 }, (_, i) => ({
              label: `Metric name ${i} long`,
              value: "999999999999",
            })),
            code: { language: "typescript", snippet: "x".repeat(280) },
            icons: ["terminal", "bug", "checkmark", "shield", "chart", "rocket"],
          }),
        );
        for (const text of scene.texts) {
          const width = text.text.length * charWidth(text.font, text.size);
          const left = text.anchor === "middle" ? text.x - width / 2 : text.x;
          expect({ template, aspect_ratio, text: text.text, fits: left >= -1 }).toEqual({
            template,
            aspect_ratio,
            text: text.text,
            fits: true,
          });
          expect({
            template,
            aspect_ratio,
            text: text.text,
            fits: left + width <= scene.width + 1,
          }).toEqual({
            template,
            aspect_ratio,
            text: text.text,
            fits: true,
          });
          expect({
            template,
            aspect_ratio,
            text: text.text,
            fits: text.y >= 0 && text.y <= scene.height,
          }).toEqual({
            template,
            aspect_ratio,
            text: text.text,
            fits: true,
          });
        }
      }
    }
  });

  test("no rectangle is drawn beyond the canvas", () => {
    for (const template of VISUAL_TEMPLATES) {
      for (const aspect_ratio of VISUAL_ASPECT_RATIOS) {
        const scene = visualScene(specFor(template, { aspect_ratio }));
        for (const rect of scene.rects) {
          expect({ template, inside: rect.x >= -1 && rect.y >= -1 }).toEqual({
            template,
            inside: true,
          });
          expect({
            template,
            inside: rect.x + rect.w <= scene.width + 1 && rect.y + rect.h <= scene.height + 1,
          }).toEqual({ template, inside: true });
        }
      }
    }
  });

  test("wrapping splits a word that cannot fit rather than letting it run off", () => {
    const lines = wrapText("A".repeat(40), 10, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
  });

  test("text past the line budget is truncated with an ellipsis", () => {
    const lines = wrapText("word ".repeat(80), 12, 2);
    expect(lines.length).toBe(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });
});

describe("unicode policy", () => {
  test("non-Latin text is kept and drawn as submitted", () => {
    const headline = "Проверяй рано";
    const scene = visualScene(spec({ headline }));
    expect(textsOf(scene).join(" ")).toContain("Проверяй");
  });

  test("zero-width and bidirectional control characters are stripped", () => {
    const scene = visualScene(spec({ headline: "TEST​EARLY‮" }));
    const joined = textsOf(scene).join(" ");
    expect(joined).toContain("TESTEARLY");
    expect(joined).not.toContain("​");
    expect(joined).not.toContain("‮");
  });

  test("newlines and runs of whitespace collapse to single spaces", () => {
    const scene = visualScene(spec({ headline: "TEST   EARLY" }));
    expect(textsOf(scene).join(" ")).toContain("TEST EARLY");
  });
});

describe("serialised output is inert", () => {
  const FORBIDDEN = [
    /<script/i,
    /<foreignObject/i,
    /<image\b/i,
    /<use\b/i,
    /<iframe/i,
    /\son[a-z]+=/i,
    /javascript:/i,
    /data:[a-z/]*;/i,
    /@font-face/i,
    /<style/i,
  ];

  test("no template produces executable content or a remote reference", () => {
    for (const template of VISUAL_TEMPLATES) {
      for (const aspect_ratio of VISUAL_ASPECT_RATIOS) {
        const svg = sceneToSvg(visualScene(specFor(template, { aspect_ratio }))).replace(
          'xmlns="http://www.w3.org/2000/svg"',
          "",
        );
        for (const pattern of FORBIDDEN) {
          expect({
            template,
            aspect_ratio,
            pattern: String(pattern),
            offends: pattern.test(svg),
          }).toEqual({
            template,
            aspect_ratio,
            pattern: String(pattern),
            offends: false,
          });
        }
        expect(/https?:\/\//i.test(svg)).toBe(false);
      }
    }
  });

  test("text content is escaped", () => {
    expect(escapeXmlText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
    expect(escapeXmlAttr(`say "hi" & 'bye'`)).toBe("say &quot;hi&quot; &amp; &#39;bye&#39;");
  });

  test("an ampersand in the alt text is escaped in the document title", () => {
    const scene = visualScene(spec({ alt_text: "Tests & failures, side by side." }));
    const svg = sceneToSvg(scene);
    expect(svg).toContain("<title>Tests &amp; failures, side by side.</title>");
    expect(svg).not.toContain("<title>Tests & failures");
  });

  test("the whole drawing is clipped to the canvas", () => {
    const svg = sceneToSvg(visualScene(spec()), { clipId: "visual-clip" });
    expect(svg).toContain('<clipPath id="visual-clip">');
    expect(svg).toContain('clip-path="url(#visual-clip)"');
  });

  test("the accessible name is the agent's own alt text", () => {
    const alt = "A pixel-art robot debugging a terminal with the words Test Early.";
    expect(visualScene(spec()).title).toBe(alt);
    expect(sceneToSvg(visualScene(spec()))).toContain(`aria-label="${alt}"`);
  });
});
