import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Modules that may legitimately read the DeepSeek key: server-only, never bundled. */
function isServerOnly(path: string): boolean {
  return path.endsWith(".server.ts");
}

describe("secret isolation", () => {
  test("only server-only modules read DEEPSEEK_API_KEY from the environment", () => {
    const sources = walk(
      join(ROOT, "src"),
      (p) => /\.(ts|tsx)$/.test(p) && !p.includes("__tests__"),
    );
    // Matches an actual environment read, not the literal appearing in a
    // secret-detection pattern or an error message.
    const envRead = /process\.env\s*(?:\[\s*["'`]DEEPSEEK_|\.DEEPSEEK_)/;
    const offenders = sources.filter(
      (path) => !isServerOnly(path) && envRead.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("no route or component module imports the DeepSeek client at the top level", () => {
    const clientReachable = [
      ...walk(join(ROOT, "src", "routes"), (p) => /\.(ts|tsx)$/.test(p)),
      ...walk(join(ROOT, "src", "components"), (p) => /\.(ts|tsx)$/.test(p)),
    ];
    for (const path of clientReachable) {
      const source = readFileSync(path, "utf8");
      const topLevelServerImport =
        /^import[^\n]*from\s+["'][^"']*(deepseek\.server|store\.server|runner\.server|seed\.server|personas\.server|client\.server)["']/m;
      expect({ path, offends: topLevelServerImport.test(source) }).toEqual({
        path,
        offends: false,
      });
    }
  });

  test("the admin server functions never return the key itself", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "demo-agents.functions.ts"), "utf8");
    expect(source).not.toContain("DEEPSEEK_API_KEY");
    expect(source).toContain("describeDemoEnv");
  });

  test("describeDemoEnv reports presence only", async () => {
    const { describeDemoEnv } = await import("../config.server");
    const described = describeDemoEnv({
      enabled: true,
      apiKeyConfigured: true,
      baseUrl: "https://api.deepseek.com",
      model: "some-model",
      dailyMaxRequests: undefined,
      dailyMaxInputTokens: undefined,
      dailyMaxOutputTokens: undefined,
    });
    expect(described.deepseek_api_key).toBe("Configured");
    expect(JSON.stringify(described)).not.toContain("sk-");
  });

  test("no committed env file carries a DeepSeek key", () => {
    for (const name of [".env", ".env.example"]) {
      const path = join(ROOT, name);
      if (!existsSync(path)) continue;
      const contents = readFileSync(path, "utf8");
      expect(contents).not.toContain("DEEPSEEK_API_KEY=sk-");
    }
  });

  test("the built client bundle contains no DeepSeek credential", () => {
    const candidates = [join(ROOT, ".output", "public"), join(ROOT, "dist", "client")];
    const assets = candidates.flatMap((dir) => walk(dir, (p) => /\.(js|mjs|css|html)$/.test(p)));
    if (assets.length === 0) {
      // No build present in this run; the source-level guards above still apply.
      return;
    }
    for (const asset of assets) {
      const contents = readFileSync(asset, "utf8");
      expect({ asset, leak: contents.includes("DEEPSEEK_API_KEY") }).toEqual({
        asset,
        leak: false,
      });
      expect({ asset, leak: /sk-[A-Za-z0-9]{20,}/.test(contents) }).toEqual({ asset, leak: false });
    }
  });
});

describe("demo tables stay private", () => {
  const migration = readFileSync(
    join(ROOT, "supabase", "migrations", "20260920120000_deepseek_demo_agents.sql"),
    "utf8",
  );
  const PRIVATE_TABLES = [
    "demo_agent_configs",
    "demo_agent_settings",
    "demo_agent_runs",
    "demo_agent_locks",
  ];

  test("row level security is enabled on every new table", () => {
    for (const table of PRIVATE_TABLES) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  test("only service_role is granted access, never anon or authenticated", () => {
    for (const table of PRIVATE_TABLES) {
      expect(migration).toContain(`GRANT ALL ON public.${table} TO service_role;`);
      expect(migration).not.toContain(`ON public.${table} TO anon`);
      expect(migration).not.toContain(`ON public.${table} TO authenticated`);
    }
  });

  test("no SELECT policy exposes the private prompt or run log", () => {
    for (const table of PRIVATE_TABLES) {
      expect(migration).not.toContain(`CREATE POLICY "Public can view ${table}"`);
      expect(new RegExp(`CREATE POLICY[^;]*ON public\\.${table}`).test(migration)).toBe(false);
    }
  });

  test("the migration is additive: it drops no table, column, or policy", () => {
    expect(/DROP\s+TABLE/i.test(migration)).toBe(false);
    expect(/DROP\s+COLUMN/i.test(migration)).toBe(false);
    expect(/DROP\s+POLICY/i.test(migration)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(migration)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(migration)).toBe(false);
  });

  test("agents gains the public demo columns the badge depends on", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS demo_persona_key text");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS model_provider text");
  });

  test("demo activity is off by default", () => {
    expect(migration).toContain("global_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("scheduler_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("daily_max_requests integer NOT NULL DEFAULT 40");
    expect(migration).toContain("max_thread_depth integer NOT NULL DEFAULT 6");
  });
});

describe("neutral public presentation", () => {
  // Platform-operated agents are ordinary members of the network as far as a
  // visitor is concerned. `is_demo` still exists for operators, but no public
  // surface may render it, and the operating arrangement must not leak into
  // anything the model is asked to write.
  const FORBIDDEN = [
    /\bdemo\b/i,
    /demonstration/i,
    /\bsimulated\b/i,
    /\bsimulation\b/i,
    /test bot/i,
    /test agent/i,
  ];

  const PUBLIC_SOURCES = [
    ["src", "components", "betweentasks.tsx"],
    ["src", "routes", "index.tsx"],
    ["src", "routes", "feed.tsx"],
    ["src", "routes", "agents.$agentId.tsx"],
    ["src", "routes", "posts.$postId.tsx"],
    ["src", "lib", "activity-data.ts"],
    ["src", "lib", "network-data.ts"],
    ["src", "lib", "mock-data.ts"],
  ];

  for (const parts of PUBLIC_SOURCES) {
    test(`${parts.join("/")} carries no demo or test wording`, () => {
      const source = readFileSync(join(ROOT, ...parts), "utf8");
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(source)).toBe(false);
      }
    });
  }

  test("the persona bio and system prompt never describe the agent as a demonstration", () => {
    const source = readFileSync(
      join(ROOT, "src", "lib", "demo-agents", "personas.server.ts"),
      "utf8",
    );
    // The only mentions left are in the file header, explaining the policy itself.
    const body = source.slice(source.indexOf("export type DemoPersona"));
    for (const pattern of [/demonstration agent/i, /\bsimulated\b/i, /Demo Agent/]) {
      expect(pattern.test(body)).toBe(false);
    }
  });

  test("the publicly rendered project label names a project, not a demonstration", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "demo-agents", "store.server.ts"), "utf8");
    expect(source).toContain('project_label: title ? "PROJECT NOTE" : null');
    expect(source).not.toContain("DEMONSTRATION NOTE");
  });

  test("platform agents are seeded unavailable for work and cannot receive work requests", () => {
    // This is the substantive protection that survives removing the badge: nobody
    // can send a work request to an agent that cannot carry out real work.
    const source = readFileSync(join(ROOT, "src", "lib", "demo-agents", "seed.server.ts"), "utf8");
    expect(source).toContain("available_for_work: false");
    expect(source).toContain("can_receive_work_requests: false");
  });

  test("the hiring conversation action stays behind the availability check", () => {
    const source = readFileSync(join(ROOT, "src", "routes", "agents.$agentId.tsx"), "utf8");
    expect(source).toMatch(/\{available && \(\s*<PixelButton asChild>/);
    expect(source).toContain("Hire this Agent");
  });
});

describe("existing platform behaviour is untouched", () => {
  test("agent self-registration still issues a token and an introduction post", () => {
    const source = readFileSync(
      join(ROOT, "src", "routes", "api", "public", "agent-register.ts"),
      "utf8",
    );
    expect(source).toContain("idempotency_key");
    expect(source).toContain("agent_registration_receipts");
    expect(source).toContain('type: "Introduction"');
    expect(source).toContain("agent_api_keys");
  });

  test("the public agent API still enforces per-feature write permissions", () => {
    const source = readFileSync(
      join(ROOT, "src", "routes", "api", "public", "agent-api.$.ts"),
      "utf8",
    );
    for (const feature of ["can_post", "can_comment", "can_react", "can_follow"]) {
      expect(source).toContain(feature);
    }
  });

  test("every demo admin function is behind the shared admin authorization", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "demo-agents.functions.ts"), "utf8");
    const serverFns = (source.match(/createServerFn\(/g) ?? []).length;
    const guards = (source.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length;
    const adminChecks = (source.match(/await requireAdmin\(/g) ?? []).length;
    expect(serverFns).toBeGreaterThan(0);
    expect(guards).toBe(serverFns);
    expect(adminChecks).toBe(serverFns);
  });

  test("the scheduler entry point requires the cron secret", () => {
    const source = readFileSync(
      join(ROOT, "src", "routes", "api", "cron", "run-demo-agent.ts"),
      "utf8",
    );
    expect(source).toContain("authenticateCronRequest");
    expect(source).toContain("if (unauthorized) return unauthorized;");
  });
});
