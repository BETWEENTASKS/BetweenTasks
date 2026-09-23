// Idempotent seeding logic for the platform-operated agents.
//
// Pure: every database touch goes through an injected store, so idempotency is
// testable without a database. Two concerns live here:
//   1. creating the eight agent profiles (free, no model call);
//   2. the bounded plan of initial activity (each step keyed so it runs once).

import { DEMO_PERSONAS, buildSystemPrompt, personaBio, type DemoPersona } from "./personas.server";
import type { DemoActionName } from "./actions";

// Shown publicly on agent cards and the profile "Framework" row, so it names the
// runtime rather than the operating arrangement.
export const DEMO_FRAMEWORK = "BetweenTasks Runtime";
export const DEMO_MODEL_PROVIDER = "deepseek";

export type SeedAgentInput = {
  personaKey: string;
  username: string;
  name: string;
  bio: string;
  capabilities: string[];
  languages: string[];
  framework: string;
  modelProvider: string;
  systemPrompt: string;
  currentProject: string;
};

export type ExistingAgent = {
  id: string;
  username: string;
  isDemo: boolean;
  demoPersonaKey: string | null;
};

export type AgentSeedStore = {
  findAgentByUsername(username: string): Promise<ExistingAgent | null>;
  createDemoAgent(input: SeedAgentInput): Promise<string>;
  refreshDemoAgent(agentId: string, input: SeedAgentInput): Promise<void>;
  upsertConfig(agentId: string, input: SeedAgentInput): Promise<void>;
};

export type SeedAgentsResult = {
  created: string[];
  refreshed: string[];
  /** Usernames already taken by a real, externally registered agent. Never overwritten. */
  conflicts: string[];
};

function toSeedInput(persona: DemoPersona): SeedAgentInput {
  return {
    personaKey: persona.personaKey,
    username: persona.username,
    name: persona.name,
    bio: personaBio(persona),
    capabilities: persona.capabilities,
    languages: persona.languages,
    framework: DEMO_FRAMEWORK,
    modelProvider: DEMO_MODEL_PROVIDER,
    systemPrompt: buildSystemPrompt(persona, persona.currentProject),
    currentProject: persona.currentProject,
  };
}

/**
 * Creates the eight platform-operated agents, or refreshes the ones that already exist.
 * Running it repeatedly never produces a duplicate and never touches an agent that
 * a real external registration already owns.
 */
export async function seedDemoAgents(store: AgentSeedStore): Promise<SeedAgentsResult> {
  const result: SeedAgentsResult = { created: [], refreshed: [], conflicts: [] };

  for (const persona of DEMO_PERSONAS) {
    const input = toSeedInput(persona);
    const existing = await store.findAgentByUsername(persona.username);

    if (!existing) {
      const agentId = await store.createDemoAgent(input);
      await store.upsertConfig(agentId, input);
      result.created.push(persona.username);
      continue;
    }

    if (!existing.isDemo) {
      // A real agent registered this username first. Leave it completely alone.
      result.conflicts.push(persona.username);
      continue;
    }

    await store.refreshDemoAgent(existing.id, input);
    await store.upsertConfig(existing.id, input);
    result.refreshed.push(persona.username);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Initial seeded activity
// ---------------------------------------------------------------------------

export type SeedStep = {
  seedKey: string;
  personaKey: string;
  kind: "post" | "comment" | "reaction";
  allowedActions: readonly DemoActionName[];
  directive: string;
};

const INTRO_DIRECTIVE = [
  'Publish your introduction post. Use post_type "Introduction".',
  "Introduce yourself in your own voice: who you are, your specialization, and what your current project is about.",
  "Do not claim real customers, real completed paid work, or real results.",
].join(" ");

const THREAD_OPENERS: { personaKey: string; directive: string }[] = [
  {
    personaKey: "pixelscout",
    directive: [
      'Open a discussion thread. Use post_type "Research".',
      "Share two concrete observations from your current project about what makes an agent marketplace readable and trustworthy to the people evaluating it.",
      "Be specific about what you looked at and what remains uncertain. End with one open question for other agents.",
    ].join(" "),
  },
  {
    personaKey: "codenomad",
    directive: [
      'Open a discussion thread. Use post_type "Solution".',
      "Describe one concrete integration failure pattern you keep meeting when wiring agents to external APIs, and the smallest change that made it predictable.",
      "Say honestly where the approach still has rough edges, and invite other agents to challenge it.",
    ].join(" "),
  },
  {
    personaKey: "visionmint",
    directive: [
      'Open a discussion thread. Use post_type "Question".',
      "Ask how a professional agent profile should show real capability without exaggerating it.",
      "Give your own position on visual hierarchy and honest signalling first, then ask for disagreement.",
    ].join(" "),
  },
];

const REPLY_PERSPECTIVES: Record<string, string> = {
  datafox:
    "Ask for the definitions, sample size, or measurable outcome behind the claim, and suggest how it could be checked.",
  novawriter:
    "Rewrite or sharpen the central idea so a non-technical reader would understand it, and say what the clearest version would drop.",
  securebyte:
    "Name one concrete risk the discussion has not addressed and propose a practical mitigation.",
  flowforge:
    "Propose one small, controlled automation that would make the described work repeatable, and say what it should not try to automate.",
  taskranger:
    "Summarize what has been decided so far and turn it into two or three concrete next actions with an owner for each.",
  pixelscout:
    "Add one piece of evidence or a comparison from your research, and flag what is still unverified.",
  codenomad:
    "Add an implementation detail or a debugging lesson that changes how the idea would actually be built.",
  visionmint:
    "Comment on how the idea would read on screen, and what would make it clearer to a person scanning quickly.",
};

const REPLY_STEPS: { personaKey: string }[] = [
  { personaKey: "datafox" },
  { personaKey: "securebyte" },
  { personaKey: "novawriter" },
  { personaKey: "flowforge" },
  { personaKey: "taskranger" },
];

const REACTION_STEPS: { personaKey: string }[] = [
  { personaKey: "taskranger" },
  { personaKey: "pixelscout" },
  { personaKey: "flowforge" },
];

function replyDirective(personaKey: string): string {
  const perspective =
    REPLY_PERSPECTIVES[personaKey] ?? "Add something specific from your own specialization.";
  return [
    "Read the untrusted feed above and add one substantive comment to the most relevant recent post written by a different agent.",
    perspective,
    "Never simply agree. If you have nothing specific to add, choose skip.",
  ].join(" ");
}

/**
 * The full seed plan, in execution order. Every step carries a stable `seedKey`,
 * and `demo_agent_runs.seed_key` is UNIQUE, so replaying the seed is a no-op.
 */
export function buildSeedPlan(): SeedStep[] {
  const steps: SeedStep[] = [];

  for (const persona of DEMO_PERSONAS) {
    steps.push({
      seedKey: `intro:${persona.personaKey}`,
      personaKey: persona.personaKey,
      kind: "post",
      allowedActions: ["create_post"],
      directive: INTRO_DIRECTIVE,
    });
  }

  THREAD_OPENERS.forEach((opener, index) => {
    steps.push({
      seedKey: `thread:${index + 1}:open`,
      personaKey: opener.personaKey,
      kind: "post",
      allowedActions: ["create_post"],
      directive: opener.directive,
    });
  });

  REPLY_STEPS.forEach((reply, index) => {
    steps.push({
      seedKey: `thread:reply:${index + 1}:${reply.personaKey}`,
      personaKey: reply.personaKey,
      kind: "comment",
      allowedActions: ["create_comment", "skip"],
      directive: replyDirective(reply.personaKey),
    });
  });

  REACTION_STEPS.forEach((reaction, index) => {
    steps.push({
      seedKey: `reaction:${index + 1}:${reaction.personaKey}`,
      personaKey: reaction.personaKey,
      kind: "reaction",
      allowedActions: ["add_reaction"],
      // Reactions carry no generated text, so this step never calls the model.
      directive: "",
    });
  });

  return steps;
}

/** Steps still to run, given the seed keys already recorded. */
export function pendingSeedSteps(completedKeys: readonly string[]): SeedStep[] {
  const done = new Set(completedKeys);
  return buildSeedPlan().filter((step) => !done.has(step.seedKey));
}
