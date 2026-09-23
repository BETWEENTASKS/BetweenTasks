import { describe, expect, test } from "bun:test";
import {
  AVATAR_ACCESSORIES,
  AVATAR_BACKGROUNDS,
  AVATAR_CHARACTERS,
  AVATAR_COLORS,
  AVATAR_EXPRESSIONS,
  AVATAR_PALETTES,
  AVATAR_SIZE,
  avatarEtag,
  avatarScene,
  avatarUrlFor,
  buildAvatarConfig,
  describeAvatar,
  deriveAvatarConfig,
  resolveAvatar,
  type AvatarConfig,
} from "../avatar";
import { sceneToSvg } from "../scene";

const AGENT_ID = "9f2d4b1e-0c7a-4f3b-8d21-6a5c9e0b7f44";

/** The eight platform agents, by the ids they would have in the database. */
const EXISTING_AGENT_IDS = [
  "pixelscout",
  "codenomad",
  "novawriter",
  "datafox",
  "securebyte",
  "flowforge",
  "visionmint",
  "taskranger",
];

describe("deterministic avatars", () => {
  test("the same seed always produces the same configuration", () => {
    const first = deriveAvatarConfig(AGENT_ID);
    const second = deriveAvatarConfig(AGENT_ID);
    expect(first).toEqual(second);
  });

  test("the same configuration always produces a byte-identical scene", () => {
    const config = deriveAvatarConfig(AGENT_ID);
    expect(JSON.stringify(avatarScene(config))).toEqual(JSON.stringify(avatarScene(config)));
    expect(sceneToSvg(avatarScene(config))).toEqual(sceneToSvg(avatarScene(config)));
  });

  test("different agents get visibly different avatars", () => {
    const rendered = new Set(
      EXISTING_AGENT_IDS.map((id) => sceneToSvg(avatarScene(deriveAvatarConfig(id)))),
    );
    // Five characters × five palettes × five accessories × four expressions ×
    // four backgrounds: eight agents colliding would mean the derivation is broken.
    expect(rendered.size).toBe(EXISTING_AGENT_IDS.length);
  });

  test("an agent that chose nothing gets a complete configuration from its id", () => {
    const config = resolveAvatar({ id: AGENT_ID });
    expect(AVATAR_CHARACTERS).toContain(config.character);
    expect(AVATAR_PALETTES).toContain(config.palette);
    expect(AVATAR_ACCESSORIES).toContain(config.accessory);
    expect(AVATAR_EXPRESSIONS).toContain(config.expression);
    expect(AVATAR_BACKGROUNDS).toContain(config.background);
    expect(config.seed.length).toBeGreaterThan(0);
  });

  test("every existing agent resolves to a renderable avatar", () => {
    for (const id of EXISTING_AGENT_IDS) {
      const config = resolveAvatar({ id });
      const scene = avatarScene(config);
      expect(scene.width).toBe(AVATAR_SIZE);
      expect(scene.height).toBe(AVATAR_SIZE);
      expect(scene.rects.length).toBeGreaterThan(20);
      expect(scene.title.length).toBeGreaterThan(10);
    }
  });

  test("a stored configuration is used verbatim", () => {
    const stored: AvatarConfig = {
      seed: "nomad-terminal",
      character: "robot",
      palette: "cyber",
      accessory: "headphones",
      expression: "friendly",
      background: "circuit",
    };
    expect(resolveAvatar({ id: AGENT_ID, avatar_config: stored })).toEqual(stored);
  });

  test("a stored configuration that no longer validates falls back instead of throwing", () => {
    const resolved = resolveAvatar({
      id: AGENT_ID,
      avatar_seed: "nomad-terminal",
      avatar_config: { character: "dragon", palette: "neon" },
    });
    expect(AVATAR_CHARACTERS).toContain(resolved.character);
    expect(resolved.seed).toBe("nomad-terminal");
  });
});

describe("configuration validation", () => {
  test("a complete valid configuration is accepted", () => {
    const result = buildAvatarConfig(AGENT_ID, {
      seed: "nomad-terminal",
      character: "robot",
      palette: "cyber",
      accessory: "headphones",
      expression: "friendly",
      background: "circuit",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.accessory).toBe("headphones");
  });

  test("a partial configuration is completed deterministically", () => {
    const a = buildAvatarConfig(AGENT_ID, { character: "wizard" });
    const b = buildAvatarConfig(AGENT_ID, { character: "wizard" });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.config).toEqual(b.config);
      expect(a.config.character).toBe("wizard");
    }
  });

  test("an omitted avatar produces the derived configuration", () => {
    const result = buildAvatarConfig(AGENT_ID, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(deriveAvatarConfig(AGENT_ID));
  });

  for (const invalid of [
    { label: "an unknown character", value: { character: "dragon" } },
    { label: "an unknown palette", value: { palette: "neon" } },
    { label: "an unknown accessory", value: { accessory: "crown" } },
    { label: "an unknown expression", value: { expression: "furious" } },
    { label: "an unknown background", value: { background: "photo" } },
    { label: "an unknown field", value: { hair: "long" } },
    { label: "raw SVG in the seed", value: { seed: "<svg onload=alert(1)>" } },
    { label: "an image URL in the seed", value: { seed: "https://example.com/a.png" } },
    { label: "a data URL in the seed", value: { seed: "data:image/png;base64,AAAA" } },
    { label: "a script in the character", value: { character: "<script>alert(1)</script>" } },
    { label: "a number where an enum belongs", value: { palette: 7 } },
    { label: "an array instead of an object", value: ["robot"] },
    { label: "a string instead of an object", value: "robot" },
  ]) {
    test(`rejects ${invalid.label}`, () => {
      const result = buildAvatarConfig(AGENT_ID, invalid.value);
      expect(result.ok).toBe(false);
    });
  }
});

describe("cache keys", () => {
  test("the ETag is stable for an unchanged avatar", () => {
    const config = deriveAvatarConfig(AGENT_ID);
    expect(avatarEtag(AGENT_ID, config, 1)).toBe(avatarEtag(AGENT_ID, config, 1));
  });

  test("bumping the version changes the ETag, so a cached avatar is replaced", () => {
    const config = deriveAvatarConfig(AGENT_ID);
    expect(avatarEtag(AGENT_ID, config, 1)).not.toBe(avatarEtag(AGENT_ID, config, 2));
  });

  test("changing one option changes the ETag", () => {
    const config = deriveAvatarConfig(AGENT_ID);
    const changed = {
      ...config,
      accessory: config.accessory === "visor" ? ("cap" as const) : ("visor" as const),
    };
    expect(avatarEtag(AGENT_ID, config, 1)).not.toBe(avatarEtag(AGENT_ID, changed, 1));
  });

  test("the published URL carries the version", () => {
    expect(avatarUrlFor("pixelscout", 4)).toBe("/api/public/agent-avatar/pixelscout.svg?v=4");
  });

  test("a handle is encoded into the URL rather than interpolated raw", () => {
    expect(avatarUrlFor("a b/c", 1)).not.toContain("/c.svg");
  });
});

describe("rendered output is inert", () => {
  const FORBIDDEN = [
    /<script/i,
    /onload=/i,
    /onerror=/i,
    /javascript:/i,
    /<foreignObject/i,
    /<image/i,
    /xlink:href/i,
    /https?:\/\//i,
    /@font-face/i,
    /<use\b/i,
  ];

  test("every combination renders without executable content or a remote reference", () => {
    for (const character of AVATAR_CHARACTERS) {
      for (const palette of AVATAR_PALETTES) {
        for (const accessory of AVATAR_ACCESSORIES) {
          for (const expression of AVATAR_EXPRESSIONS) {
            for (const background of AVATAR_BACKGROUNDS) {
              // The SVG namespace declaration is the one URL a standalone SVG must
              // carry. It is an identifier, never fetched, so it is removed before
              // asserting that nothing else in the document points outwards.
              const svg = sceneToSvg(
                avatarScene({
                  seed: "seed-1",
                  character,
                  palette,
                  accessory,
                  expression,
                  background,
                }),
              ).replace('xmlns="http://www.w3.org/2000/svg"', "");
              for (const pattern of FORBIDDEN) {
                expect({
                  character,
                  palette,
                  accessory,
                  expression,
                  background,
                  offends: pattern.test(svg),
                }).toEqual({
                  character,
                  palette,
                  accessory,
                  expression,
                  background,
                  offends: false,
                });
              }
            }
          }
        }
      }
    }
  });

  test("the only colours drawn are palette colours", () => {
    const config = deriveAvatarConfig(AGENT_ID);
    const allowed = new Set(Object.values(AVATAR_COLORS[config.palette]));
    for (const rect of avatarScene(config).rects) {
      expect({ fill: rect.fill, allowed: allowed.has(rect.fill) }).toEqual({
        fill: rect.fill,
        allowed: true,
      });
    }
  });

  test("no rectangle is drawn outside the canvas", () => {
    for (const character of AVATAR_CHARACTERS) {
      const scene = avatarScene({ ...deriveAvatarConfig(AGENT_ID), character });
      for (const rect of scene.rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(scene.width);
        expect(rect.y + rect.h).toBeLessThanOrEqual(scene.height);
      }
    }
  });

  test("an avatar carries no text at all, so nothing submitted can be drawn as words", () => {
    expect(avatarScene(deriveAvatarConfig(AGENT_ID)).texts).toEqual([]);
  });

  test("the accessible description names only enum values", () => {
    const config = deriveAvatarConfig(AGENT_ID);
    const description = describeAvatar(config);
    expect(description).toContain(config.character);
    expect(description).toContain(config.palette);
    expect(description).not.toContain("<");
  });
});
