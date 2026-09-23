import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

const MIGRATION = read(
  "supabase",
  "migrations",
  "20260920160000_visual_identity_and_visual_posts.sql",
);

describe("the migration is safe to apply", () => {
  test("it is additive: no drop, no delete, no truncate", () => {
    expect(/DROP\s+TABLE/i.test(MIGRATION)).toBe(false);
    expect(/DROP\s+COLUMN/i.test(MIGRATION)).toBe(false);
    expect(/DROP\s+POLICY/i.test(MIGRATION)).toBe(false);
    expect(/DROP\s+CONSTRAINT/i.test(MIGRATION)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(MIGRATION)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(MIGRATION)).toBe(false);
    // The one DROP it does contain is the idempotent trigger replacement the
    // existing migrations already use.
    expect(/DROP\s+TRIGGER\s+IF\s+EXISTS/i.test(MIGRATION)).toBe(true);
  });

  test("it writes no row, so applying it changes no existing agent", () => {
    expect(/^\s*UPDATE\s+public\./im.test(MIGRATION)).toBe(false);
    // The inserts inside create_visual_post() run when an agent publishes, not
    // when the migration is applied, so only the statements before it count.
    const schemaOnly = MIGRATION.slice(
      0,
      MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.create_visual_post"),
    );
    expect(schemaOnly.match(/INSERT\s+INTO/gi) ?? []).toHaveLength(1);
    expect(MIGRATION).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.visual_post_settings)");
  });

  test("every new column is added conditionally and defaults to the old behaviour", () => {
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS avatar_seed text");
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS avatar_config jsonb");
    expect(MIGRATION).toContain(
      "ADD COLUMN IF NOT EXISTS avatar_version integer NOT NULL DEFAULT 1",
    );
    expect(MIGRATION).toContain(
      "ADD COLUMN IF NOT EXISTS can_create_visual_posts boolean NOT NULL DEFAULT false",
    );
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS visual_posts_daily_limit integer");
    expect(MIGRATION).toContain(
      "ADD COLUMN IF NOT EXISTS post_format text NOT NULL DEFAULT 'text'",
    );
  });

  test("the feature is off by default", () => {
    expect(MIGRATION).toContain("global_enabled boolean NOT NULL DEFAULT false");
    expect(MIGRATION).toContain("kill_switch_engaged boolean NOT NULL DEFAULT false");
    expect(MIGRATION).toContain("default_daily_limit integer NOT NULL DEFAULT 3");
    expect(MIGRATION).toContain(
      "INSERT INTO public.visual_post_settings (global_enabled, kill_switch_engaged)\nSELECT false, false",
    );
  });

  test("duplicate visuals are prevented by a unique index, not only by application code", () => {
    expect(MIGRATION).toContain("CREATE UNIQUE INDEX IF NOT EXISTS post_visuals_agent_hash_idx");
  });

  test("deleting a post deletes its picture", () => {
    expect(MIGRATION).toContain(
      "post_id uuid NOT NULL UNIQUE REFERENCES public.posts(id) ON DELETE CASCADE",
    );
    expect(MIGRATION).toContain(
      "agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE",
    );
  });
});

describe("row level security on the new tables", () => {
  test("row level security is enabled on both", () => {
    expect(MIGRATION).toContain("ALTER TABLE public.post_visuals ENABLE ROW LEVEL SECURITY;");
    expect(MIGRATION).toContain(
      "ALTER TABLE public.visual_post_settings ENABLE ROW LEVEL SECURITY;",
    );
  });

  test("the settings table is private: service_role only, with no policy", () => {
    expect(MIGRATION).toContain("GRANT ALL ON public.visual_post_settings TO service_role;");
    expect(MIGRATION).not.toContain("ON public.visual_post_settings TO anon");
    expect(MIGRATION).not.toContain("ON public.visual_post_settings TO authenticated");
    expect(/CREATE POLICY[^;]*ON public\.visual_post_settings/.test(MIGRATION)).toBe(false);
  });

  test("the public may read a visual only while its post is visible", () => {
    expect(MIGRATION).toContain('CREATE POLICY "Public can view visuals of visible posts"');
    expect(MIGRATION).toContain("p.id = post_visuals.post_id AND p.hidden_at IS NULL");
  });

  test("a browser cannot write a visual: only SELECT is granted and no write policy exists", () => {
    expect(MIGRATION).toContain("GRANT SELECT ON public.post_visuals TO anon, authenticated;");
    expect(MIGRATION).not.toContain("GRANT ALL ON public.post_visuals TO anon");
    expect(/FOR\s+(INSERT|UPDATE|DELETE)[^;]*ON public\.post_visuals/i.test(MIGRATION)).toBe(false);
    expect(MIGRATION).toContain("GRANT ALL ON public.post_visuals TO service_role;");
  });

  test("the transactional write function is reachable only from the server", () => {
    expect(MIGRATION).toContain("SECURITY DEFINER");
    expect(MIGRATION).toContain("FROM PUBLIC, anon, authenticated;");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.create_visual_post(");
    expect(MIGRATION).toContain(") TO service_role;");
  });

  test("the function inserts both rows in one body, which is one transaction", () => {
    const body = MIGRATION.slice(
      MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.create_visual_post"),
    );
    expect(body).toContain("INSERT INTO public.posts");
    expect(body).toContain("INSERT INTO public.post_visuals");
  });
});

describe("the public API keeps its existing contract", () => {
  const ROUTE = read("src", "routes", "api", "public", "agent-api.$.ts");

  test("a request without post_type is still a text post", () => {
    expect(ROUTE).toContain('const postType = text(body["post_type"]) || "text"');
    expect(ROUTE).toContain('if (postType !== "text" && postType !== "visual")');
  });

  test("the original text-post fields and limits are untouched", () => {
    expect(ROUTE).toContain('checkWritePermission(agent, "can_post")');
    expect(ROUTE).toContain('rateLimit("post", agent.id, 1, 900)');
    expect(ROUTE).toContain("content is required and must be 5000 characters or fewer.");
    expect(ROUTE).toContain("project_label");
  });

  test("an oversized visual payload is refused with 413 before it is parsed", () => {
    expect(ROUTE).toContain("VISUAL_MAX_REQUEST_BYTES");
    expect(ROUTE).toContain("413");
  });

  test("the avatar endpoint is authenticated and permission checked", () => {
    expect(ROUTE).toContain('segments[0] === "me" && segments[1] === "avatar"');
    expect(ROUTE).toContain("checkWritePermission(agent, null)");
    expect(ROUTE).toContain('rateLimit("avatar_update"');
  });

  test("no response path returns a bearer token or a service-role key", () => {
    // `token/rotate` is the one endpoint that returns a token, and it is the
    // pre-existing rotation endpoint.
    const rotations = ROUTE.match(/agent_token/g) ?? [];
    expect(rotations).toHaveLength(1);
    expect(ROUTE).not.toContain("SERVICE_ROLE");
  });

  test("the public SVG endpoints refuse to serve a hidden post and send a restrictive policy", () => {
    const visual = read("src", "routes", "api", "public", "post-visual.$.ts");
    expect(visual).toContain("loadPublicVisual");
    expect(visual).toContain("content-security-policy");
    expect(visual).toContain("sandbox");
    expect(visual).toContain("etag");

    const avatar = read("src", "routes", "api", "public", "agent-avatar.$.ts");
    expect(avatar).toContain("content-security-policy");
    expect(avatar).toContain("etag");
    expect(avatar).toContain('.neq("status", "banned")');
  });

  test("a hidden post yields no picture", () => {
    const store = read("src", "lib", "visual-posts", "create.server.ts");
    expect(store).toContain("post.hidden_at !== null");
  });
});

describe("administration", () => {
  test("every visual-post administrative function is behind the shared admin authorization", () => {
    const source = read("src", "lib", "visual-admin.functions.ts");
    const serverFns = (source.match(/createServerFn\(/g) ?? []).length;
    const guards = (source.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length;
    const adminChecks = (source.match(/await requireAdmin\(/g) ?? []).length;
    expect(serverFns).toBeGreaterThan(0);
    expect(guards).toBe(serverFns);
    expect(adminChecks).toBe(serverFns);
  });

  test("every administrative mutation requires a reason and is logged", () => {
    const source = read("src", "lib", "visual-admin.functions.ts");
    const mutations = (source.match(/createServerFn\(\{ method: "POST" \}\)/g) ?? []).length;
    expect((source.match(/A reason is required\./g) ?? []).length).toBe(mutations);
    expect((source.match(/await logAdmin\(/g) ?? []).length).toBe(mutations);
  });

  test("there is no second authentication system", () => {
    const source = read("src", "routes", "admin.visual-posts.tsx");
    expect(source).toContain("supabase.auth.getUser()");
    expect(source).toContain('redirect({ to: "/admin/login" })');
    expect(source).not.toContain("password");
  });

  test("the emergency stop also turns the feature off", () => {
    const source = read("src", "lib", "visual-admin.functions.ts");
    expect(source).toContain("{ kill_switch_engaged: true, global_enabled: false }");
  });
});

describe("no image is ever generated by a model", () => {
  const SOURCES = walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p) && !p.includes("__tests__"));

  const PROVIDER_ENDPOINTS = [
    /api\.openai\.com/i,
    /generativelanguage\.googleapis\.com/i,
    /api\.replicate\.com/i,
    /stability\.ai/i,
    /\/images\/generations/i,
    /\/v1\/images/i,
    /black-forest-labs/i,
    /lovable[.-]?ai/i,
  ];

  test("no module calls an image-generation provider", () => {
    for (const path of SOURCES) {
      const source = readFileSync(path, "utf8");
      for (const pattern of PROVIDER_ENDPOINTS) {
        expect({ path, pattern: String(pattern), offends: pattern.test(source) }).toEqual({
          path,
          pattern: String(pattern),
          offends: false,
        });
      }
    }
  });

  test("the renderer makes no network call of any kind", () => {
    for (const parts of [
      ["src", "lib", "pixel-art", "scene.ts"],
      ["src", "lib", "pixel-art", "avatar.ts"],
      ["src", "lib", "visual-posts", "render.ts"],
      ["src", "lib", "visual-posts", "registry.ts"],
      ["src", "lib", "visual-posts", "schema.ts"],
    ]) {
      const source = read(...parts);
      expect({ parts, offends: /\bfetch\s*\(/.test(source) }).toEqual({ parts, offends: false });
      expect({ parts, offends: /XMLHttpRequest/.test(source) }).toEqual({ parts, offends: false });
      expect({ parts, offends: /new Image\s*\(/.test(source) }).toEqual({ parts, offends: false });
      expect({ parts, offends: /Math\.random/.test(source) }).toEqual({ parts, offends: false });
      expect({ parts, offends: /Date\.now/.test(source) }).toEqual({ parts, offends: false });
    }
  });

  test("the picture components never inject markup", () => {
    for (const parts of [
      ["src", "components", "pixel-scene.tsx"],
      ["src", "components", "visual-post.tsx"],
    ]) {
      expect(read(...parts)).not.toContain("dangerouslySetInnerHTML={{");
    }
  });
});

describe("secrets stay on the server", () => {
  test("the service-role client is reached only from a server-only module", () => {
    const offenders = walk(
      join(ROOT, "src", "lib", "visual-posts"),
      (p) => /\.ts$/.test(p) && !p.includes("__tests__"),
    )
      .concat(
        walk(
          join(ROOT, "src", "lib", "pixel-art"),
          (p) => /\.ts$/.test(p) && !p.includes("__tests__"),
        ),
      )
      .filter(
        (path) =>
          !path.endsWith(".server.ts") && readFileSync(path, "utf8").includes("client.server"),
      );
    expect(offenders).toEqual([]);
  });

  test("no component or route imports a visual server module at the top level", () => {
    const reachable = [
      ...walk(join(ROOT, "src", "routes"), (p) => /\.(ts|tsx)$/.test(p)),
      ...walk(join(ROOT, "src", "components"), (p) => /\.(ts|tsx)$/.test(p)),
    ];
    for (const path of reachable) {
      const source = readFileSync(path, "utf8");
      const offends =
        /^import[^\n]*from\s+["'][^"']*(visual-posts\/create\.server|avatar\.server)["']/m.test(
          source,
        );
      expect({ path, offends }).toEqual({ path, offends: false });
    }
  });

  test("the built client bundle carries no service-role key and no agent token", () => {
    const assets = [join(ROOT, ".output", "public"), join(ROOT, "dist", "client")].flatMap((dir) =>
      walk(dir, (p) => /\.(js|mjs|css|html)$/.test(p)),
    );
    if (assets.length === 0) return;
    for (const asset of assets) {
      const contents = readFileSync(asset, "utf8");
      expect({ asset, leak: contents.includes("SUPABASE_SERVICE_ROLE_KEY") }).toEqual({
        asset,
        leak: false,
      });
      expect({ asset, leak: /bt_live_[A-Za-z0-9_-]{16,}/.test(contents) }).toEqual({
        asset,
        leak: false,
      });
      expect({
        asset,
        leak: contents.includes("create_visual_post(") && contents.includes("service_role"),
      }).toEqual({
        asset,
        leak: false,
      });
    }
  });

  test("a rejection log stores a code, never the submitted content", () => {
    const source = read("src", "lib", "visual-posts", "create.ts");
    const logSection = source.slice(source.indexOf("export async function logVisualRejection"));
    expect(logSection).toContain("code: failure.code");
    expect(logSection).not.toContain("failure.message");
    expect(logSection).not.toContain("spec");
  });
});
