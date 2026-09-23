import { describe, expect, test } from "bun:test";
import {
  buildSeedPlan,
  pendingSeedSteps,
  seedDemoAgents,
  type AgentSeedStore,
  type ExistingAgent,
  type SeedAgentInput,
} from "../seed";
import { DEMO_PERSONAS } from "../personas.server";

type Recorded = {
  created: SeedAgentInput[];
  refreshed: SeedAgentInput[];
  configs: SeedAgentInput[];
};

function makeSeedStore(seedWith: ExistingAgent[] = []) {
  const agents = new Map(seedWith.map((a) => [a.username, a]));
  const recorded: Recorded = { created: [], refreshed: [], configs: [] };
  let nextId = agents.size + 1;

  const store: AgentSeedStore = {
    async findAgentByUsername(username) {
      return agents.get(username) ?? null;
    },
    async createDemoAgent(input) {
      const id = `demo-${nextId++}`;
      agents.set(input.username, {
        id,
        username: input.username,
        isDemo: true,
        demoPersonaKey: input.personaKey,
      });
      recorded.created.push(input);
      return id;
    },
    async refreshDemoAgent(_agentId, input) {
      recorded.refreshed.push(input);
    },
    async upsertConfig(_agentId, input) {
      recorded.configs.push(input);
    },
  };

  return { store, recorded, agents };
}

describe("seedDemoAgents", () => {
  test("creates all eight agents on a clean database", async () => {
    const { store, recorded } = makeSeedStore();
    const result = await seedDemoAgents(store);
    expect(result.created).toHaveLength(8);
    expect(result.refreshed).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(recorded.configs).toHaveLength(8);
  });

  test("running it twice creates no duplicates", async () => {
    const { store, recorded, agents } = makeSeedStore();
    await seedDemoAgents(store);
    const second = await seedDemoAgents(store);
    expect(second.created).toHaveLength(0);
    expect(second.refreshed).toHaveLength(8);
    expect(recorded.created).toHaveLength(8);
    expect(agents.size).toBe(8);
  });

  test("never converts a real registered agent into a demo agent", async () => {
    const { store, recorded } = makeSeedStore([
      { id: "real-1", username: "datafox", isDemo: false, demoPersonaKey: null },
    ]);
    const result = await seedDemoAgents(store);
    expect(result.conflicts).toEqual(["datafox"]);
    expect(result.created).toHaveLength(7);
    expect(recorded.refreshed.some((i) => i.username === "datafox")).toBe(false);
    expect(recorded.configs.some((i) => i.username === "datafox")).toBe(false);
  });

  test("every seeded agent carries its persona and a natural bio", async () => {
    const { store, recorded } = makeSeedStore();
    await seedDemoAgents(store);
    for (const persona of DEMO_PERSONAS) {
      const input = recorded.created.find((i) => i.username === persona.username);
      expect(input).toBeDefined();
      expect(input?.personaKey).toBe(persona.personaKey);
      expect(input?.bio).toContain(persona.name);
      expect(input?.bio?.toLowerCase()).not.toContain("demo");
      expect(input?.bio?.toLowerCase()).not.toContain("simulat");
      expect(input?.systemPrompt).toContain("Return valid JSON only");
      expect(input?.modelProvider).toBe("deepseek");
    }
  });
});

describe("seed activity plan", () => {
  test("every step has a unique key", () => {
    const plan = buildSeedPlan();
    expect(new Set(plan.map((s) => s.seedKey)).size).toBe(plan.length);
  });

  test("each platform agent gets exactly one introduction step", () => {
    const intros = buildSeedPlan().filter((s) => s.seedKey.startsWith("intro:"));
    expect(intros).toHaveLength(8);
    expect(new Set(intros.map((s) => s.personaKey)).size).toBe(8);
    for (const step of intros) {
      expect(step.allowedActions).toEqual(["create_post"]);
      expect(step.directive).toContain("Introduce yourself in your own voice");
      expect(step.directive.toLowerCase()).not.toContain("demonstration agent");
    }
  });

  test("the plan opens a few threads and adds cross-agent replies and reactions", () => {
    const plan = buildSeedPlan();
    expect(
      plan.filter((s) => s.seedKey.startsWith("thread:") && s.seedKey.endsWith(":open")),
    ).toHaveLength(3);
    expect(plan.filter((s) => s.kind === "comment").length).toBeGreaterThanOrEqual(3);
    expect(plan.filter((s) => s.kind === "reaction").length).toBeGreaterThanOrEqual(1);
  });

  test("reply steps allow skipping so an agent is never forced to agree", () => {
    for (const step of buildSeedPlan().filter((s) => s.kind === "comment")) {
      expect(step.allowedActions).toContain("skip");
      expect(step.directive).toContain("Never simply agree");
    }
  });

  test("pendingSeedSteps resumes where the last batch stopped", () => {
    const plan = buildSeedPlan();
    const done = plan.slice(0, 5).map((s) => s.seedKey);
    expect(pendingSeedSteps(done)).toHaveLength(plan.length - 5);
    expect(pendingSeedSteps(plan.map((s) => s.seedKey))).toHaveLength(0);
  });
});
