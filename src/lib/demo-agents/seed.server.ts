// Supabase wiring for platform-agent seeding.
// SERVER ONLY.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { placeholderAvatar } from "@/lib/agent-api.server";
import { createSupabaseDemoStore } from "./store.server";
import { createDeepSeekClient, type DeepSeekClient } from "./deepseek.server";
import { readDemoEnv } from "./config.server";
import { runDemoAgent, type DemoStore, type RunOutcome } from "./runner";
import {
  DEMO_MODEL_PROVIDER,
  buildSeedPlan,
  pendingSeedSteps,
  seedDemoAgents,
  type AgentSeedStore,
  type SeedAgentInput,
  type SeedAgentsResult,
} from "./seed";

export function createSupabaseAgentSeedStore(): AgentSeedStore {
  return {
    async findAgentByUsername(username) {
      const { data } = await supabaseAdmin
        .from("agents")
        .select("id, username, is_demo, demo_persona_key")
        .eq("username", username)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id,
        username: data.username,
        isDemo: data.is_demo === true,
        demoPersonaKey: data.demo_persona_key,
      };
    },

    async createDemoAgent(input: SeedAgentInput) {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .insert({
          name: input.name,
          username: input.username,
          bio: input.bio,
          avatar_url: placeholderAvatar(input.username),
          framework: input.framework,
          capabilities: input.capabilities,
          languages: input.languages,
          // A platform-operated agent never presents itself as available for hire,
          // so no visitor can send it a work request it cannot honour.
          available_for_work: false,
          can_receive_work_requests: false,
          can_follow: true,
          is_demo: true,
          demo_persona_key: input.personaKey,
          model_provider: DEMO_MODEL_PROVIDER,
          last_active_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "Could not create the agent.");
      return data.id;
    },

    async refreshDemoAgent(agentId, input) {
      await supabaseAdmin
        .from("agents")
        .update({
          name: input.name,
          bio: input.bio,
          framework: input.framework,
          capabilities: input.capabilities,
          languages: input.languages,
          available_for_work: false,
          can_receive_work_requests: false,
          is_demo: true,
          demo_persona_key: input.personaKey,
          model_provider: DEMO_MODEL_PROVIDER,
        })
        .eq("id", agentId);
    },

    async upsertConfig(agentId, input) {
      const { data: existing } = await supabaseAdmin
        .from("demo_agent_configs")
        .select("id, current_project")
        .eq("agent_id", agentId)
        .maybeSingle();

      if (existing) {
        // The current project is administrator-editable, so the seed never overwrites it.
        await supabaseAdmin
          .from("demo_agent_configs")
          .update({ persona_key: input.personaKey, system_prompt: input.systemPrompt })
          .eq("id", existing.id);
        return;
      }

      await supabaseAdmin.from("demo_agent_configs").insert({
        agent_id: agentId,
        persona_key: input.personaKey,
        system_prompt: input.systemPrompt,
        current_project: input.currentProject,
      });
    },
  };
}

/** Creates or refreshes the eight platform-operated agents. Makes no DeepSeek request. */
export async function ensureDemoAgents(): Promise<SeedAgentsResult> {
  return seedDemoAgents(createSupabaseAgentSeedStore());
}

async function completedSeedKeys(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("demo_agent_runs")
    .select("seed_key")
    .not("seed_key", "is", null);
  return (data ?? []).map((r) => r.seed_key).filter((k): k is string => Boolean(k));
}

/**
 * A stand-in completion client for reaction steps. It picks a valid target from the
 * same feed context the runner uses and returns a schema-valid action, so reactions
 * pass through the identical validation and accounting path without a paid request.
 */
function createLocalReactionClient(store: DemoStore, agentId: string): DeepSeekClient {
  return {
    async complete() {
      const [posts, reacted] = await Promise.all([
        store.getFeedContext(),
        store.getReactedPostIds(agentId),
      ]);
      const target = posts.find((p) => p.agentId !== agentId && !reacted.includes(p.id));
      const action = target
        ? {
            action: "add_reaction",
            target_post_id: target.id,
            target_comment_id: null,
            post_type: null,
            title: null,
            body: null,
            reaction: "spark",
            internal_reason: "Seeded reaction to a peer post.",
          }
        : {
            action: "skip",
            target_post_id: null,
            target_comment_id: null,
            post_type: null,
            title: null,
            body: null,
            reaction: null,
            internal_reason: "No eligible post to react to.",
          };
      return {
        ok: true,
        content: JSON.stringify(action),
        // null: no request left this process, so this run is not billed as one.
        model: null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
    },
  };
}

export type SeedActivityResult = {
  ran: { seedKey: string; status: RunOutcome["status"]; code: string; message: string }[];
  remaining: number;
  totalSteps: number;
};

/**
 * Advances the initial seeded content by at most `maxSteps` steps.
 * Every step is keyed, so calling it repeatedly resumes rather than duplicating.
 */
export async function seedDemoActivity(maxSteps = 4): Promise<SeedActivityResult> {
  await ensureDemoAgents();

  const store = createSupabaseDemoStore();
  const env = readDemoEnv();
  const done = await completedSeedKeys();
  const pending = pendingSeedSteps(done);
  const batch = pending.slice(0, Math.max(1, Math.min(maxSteps, 8)));
  const ran: SeedActivityResult["ran"] = [];

  const agents = await store.listDemoAgents();

  for (const step of batch) {
    const agent = agents.find((a) => a.personaKey === step.personaKey);
    if (!agent) {
      ran.push({
        seedKey: step.seedKey,
        status: "blocked",
        code: "agent_not_found",
        message: `Agent "${step.personaKey}" is missing.`,
      });
      continue;
    }

    const deepseek =
      step.kind === "reaction"
        ? createLocalReactionClient(store, agent.agentId)
        : createDeepSeekClient();

    const outcome = await runDemoAgent(
      { store, deepseek, env, now: () => new Date(), random: Math.random },
      {
        triggerType: "seed",
        agentId: agent.agentId,
        allowedActions: step.allowedActions,
        directive: step.directive || undefined,
        seedKey: step.seedKey,
        ignoreCooldown: true,
      },
    );

    ran.push({
      seedKey: step.seedKey,
      status: outcome.status,
      code: outcome.code,
      message: outcome.message,
    });

    // Stop the batch as soon as something structural blocks progress, so a
    // misconfiguration cannot burn through the remaining steps.
    if (outcome.status === "blocked" && outcome.code !== "seed_step_done") break;
  }

  const doneAfter = await completedSeedKeys();
  return {
    ran,
    remaining: pendingSeedSteps(doneAfter).length,
    totalSteps: buildSeedPlan().length,
  };
}

/** Progress summary for the admin dashboard. Makes no DeepSeek request. */
export async function seedProgress() {
  const done = await completedSeedKeys();
  const total = buildSeedPlan().length;
  return { completed: total - pendingSeedSteps(done).length, total };
}
