import { describe, expect, test } from "bun:test";
import { canonicalizeSpec, parseVisualSpec, visualContentHash, type VisualSpec } from "../schema";
import { VISUAL_LIMITS, VISUAL_SCHEMA_VERSION } from "../registry";

/** The example from agent.txt, which must stay valid. */
const VALID = {
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
};

function withField(field: string, value: unknown) {
  return { ...VALID, [field]: value };
}

describe("valid specifications", () => {
  test("the documented example is accepted", () => {
    const result = parseVisualSpec(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.template).toBe("pixel_terminal");
      expect(result.spec.icons).toEqual(["terminal", "bug", "checkmark"]);
    }
  });

  test("the minimum specification is accepted", () => {
    const result = parseVisualSpec({
      schema_version: VISUAL_SCHEMA_VERSION,
      template: "quote_card",
      aspect_ratio: "16:9",
      palette: "mono",
      headline: "Small checks prevent expensive failures.",
      alt_text: "A pixel-art card carrying the sentence about small checks.",
    });
    expect(result.ok).toBe(true);
  });

  test("optional template data is accepted", () => {
    const stats = parseVisualSpec({
      ...VALID,
      template: "data_snapshot",
      stats: [
        { label: "Tests passed", value: "96" },
        { label: "Failures", value: "0" },
      ],
    });
    expect(stats.ok).toBe(true);

    const code = parseVisualSpec({
      ...VALID,
      template: "code_tip",
      code: { language: "typescript", snippet: "const result = await runTest();" },
    });
    expect(code.ok).toBe(true);
  });

  test("a code snippet may contain angle brackets and braces, because it is displayed", () => {
    const result = parseVisualSpec({
      ...VALID,
      template: "code_tip",
      code: { language: "typescript", snippet: "const map = new Map<string, () => void>();" },
    });
    expect(result.ok).toBe(true);
  });
});

describe("rejected specifications", () => {
  const cases: [string, unknown][] = [
    ["an invalid template", withField("template", "instagram_story")],
    ["an invalid aspect ratio", withField("aspect_ratio", "3:2")],
    ["an invalid palette", withField("palette", "neon")],
    ["an invalid background", withField("background", "photograph")],
    ["an invalid character", withField("character", "dragon_knight")],
    ["an invalid accent", withField("accent", "hotpink")],
    ["an invalid icon", withField("icons", ["terminal", "nuclear"])],
    ["an unknown field", { ...VALID, watermark: "mine" }],
    ["a second unknown field", { ...VALID, x: 10, y: 20 }],
    ["a wrong schema version", withField("schema_version", 2)],
    ["a missing headline", { ...VALID, headline: undefined }],
    ["a missing alt text", { ...VALID, alt_text: undefined }],
    ["an empty headline", withField("headline", "   ")],
    ["a non-object specification", "pixel_terminal"],
    ["an array specification", [VALID]],
    ["null", null],

    ["raw SVG in the headline", withField("headline", "<svg><rect/></svg>")],
    ["HTML in the subtext", withField("subtext", "<b>bold</b> claim")],
    ["a script tag in the alt text", withField("alt_text", "<script>alert(1)</script>")],
    ["an event handler in the headline", withField("headline", 'x" onload="alert(1)')],
    [
      "an event handler in a stat label",
      withField("stats", [{ label: "onclick=alert(1)", value: "1" }]),
    ],
    [
      "an external URL in the subtext",
      withField("subtext", "Read more at https://example.com/post"),
    ],
    ["a bare www URL", withField("subtext", "Read more at www.example.com")],
    ["a data URL in the headline", withField("headline", "data:image/png;base64,AAAA")],
    ["a javascript: URI", withField("subtext", "javascript:alert(1)")],
    ["HTML entities in the headline", withField("headline", "A &#60;b&#62; trick")],
    [
      "a script inside a code snippet",
      { ...VALID, code: { language: "javascript", snippet: "<script>x()</script>" } },
    ],
    [
      "a URL inside a code snippet",
      { ...VALID, code: { language: "bash", snippet: "curl https://example.com" } },
    ],
    [
      "a data URI inside a code snippet",
      { ...VALID, code: { language: "json", snippet: '{"a":"data:text/html,x"}' } },
    ],

    [
      "too many icons",
      withField("icons", ["terminal", "bug", "checkmark", "shield", "chart", "rocket", "clock"]),
    ],
    [
      "too many statistics",
      withField(
        "stats",
        Array.from({ length: 7 }, (_, i) => ({ label: `Metric ${i}`, value: String(i) })),
      ),
    ],
    ["a headline over the limit", withField("headline", "A".repeat(VISUAL_LIMITS.headline + 1))],
    ["subtext over the limit", withField("subtext", "B".repeat(VISUAL_LIMITS.subtext + 1))],
    ["alt text over the limit", withField("alt_text", "C".repeat(VISUAL_LIMITS.altText + 1))],
    [
      "a code snippet over the limit",
      {
        ...VALID,
        code: { language: "typescript", snippet: "d".repeat(VISUAL_LIMITS.codeSnippet + 1) },
      },
    ],
    ["a stat label over the limit", withField("stats", [{ label: "L".repeat(25), value: "1" }])],
    [
      "a stat value over the limit",
      withField("stats", [{ label: "Passed", value: "9".repeat(13) }]),
    ],
    ["a seed with punctuation", withField("seed", "seed/../../etc/passwd")],
    ["an unknown code language", { ...VALID, code: { language: "brainfuck", snippet: "+++" } }],
    [
      "an unknown field inside a stat",
      withField("stats", [{ label: "Passed", value: "1", color: "red" }]),
    ],
    [
      "an unknown field inside code",
      { ...VALID, code: { language: "sql", snippet: "SELECT 1", theme: "dark" } },
    ],
  ];

  for (const [label, value] of cases) {
    test(`rejects ${label}`, () => {
      const result = parseVisualSpec(value);
      expect({ label, ok: result.ok }).toEqual({ label, ok: false });
    });
  }

  test("the rejection message names the field, and never echoes a token", () => {
    const result = parseVisualSpec(withField("template", "instagram_story"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("template");
      expect(result.message).not.toContain("bt_live_");
    }
  });

  test("an unknown field is reported rather than silently dropped", () => {
    const result = parseVisualSpec({ ...VALID, watermark: "mine" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("watermark");
  });
});

describe("content hashing", () => {
  function spec(overrides: Partial<VisualSpec> = {}): VisualSpec {
    const parsed = parseVisualSpec({ ...VALID, ...overrides });
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.spec;
  }

  test("the hash is stable", () => {
    expect(visualContentHash(spec())).toBe(visualContentHash(spec()));
  });

  test("key order does not change the hash", () => {
    const reordered = parseVisualSpec({
      alt_text: VALID.alt_text,
      accent: VALID.accent,
      background: VALID.background,
      icons: VALID.icons,
      character: VALID.character,
      subtext: VALID.subtext,
      headline: VALID.headline,
      seed: VALID.seed,
      palette: VALID.palette,
      aspect_ratio: VALID.aspect_ratio,
      template: VALID.template,
      schema_version: VALID.schema_version,
    });
    expect(reordered.ok).toBe(true);
    if (reordered.ok) expect(visualContentHash(reordered.spec)).toBe(visualContentHash(spec()));
  });

  test("changing any visible value changes the hash", () => {
    const base = visualContentHash(spec());
    expect(visualContentHash(spec({ headline: "TEST LATER" }))).not.toBe(base);
    expect(visualContentHash(spec({ palette: "ember" }))).not.toBe(base);
    expect(visualContentHash(spec({ aspect_ratio: "4:5" }))).not.toBe(base);
    expect(visualContentHash(spec({ icons: ["terminal"] }))).not.toBe(base);
  });

  test("the canonical form is a compact array, not a rendered document", () => {
    expect(canonicalizeSpec(spec()).startsWith("[")).toBe(true);
  });
});
