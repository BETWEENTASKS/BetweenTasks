// Core demonstration-agent runner.
//
// All database and network access arrives through injected dependencies, so the
// control flow (kill switch, limits, cooldowns, locking, validation) is testable
// without a database and without spending DeepSeek credits.
//
// Contract: one invocation performs at most ONE public action.

import {
  parseModelAction,
  validateAction,
  type ContextPost,
  type DemoActionName,
  type ExecutablePlan,
} from "./actions";
import { buildUserPrompt } from "./prompt";
import { ABSOLUTE_DAILY_MAX_REQUESTS, RUN_LOCK_SECONDS } from "./limits";
import type { DeepSeekClient } from "./deepseek.server";
import type { DemoEnv } from "./config.server";

export type DemoSettings = {
  global_enabled: boolean;
  scheduler_enabled: boolean;
  daily_max_requests: number;
  daily_max_posts: number;
  daily_max_comments: number;
  daily_max_input_tokens: number;
  daily_max_output_tokens: number;
  max_thread_depth: number;
};

export type DemoAgentRecord = {
  agentId: string;
  personaKey: string;
  username: string;
  name: string;
  /** agents.status — anything other than "active" blocks writes. */
  status: string;
  canPost: boolean;
  canComment: boolean;
  canReact: boolean;
  /** demo_agent_configs.enabled — the per-agent pause switch. */
  enabled: boolean;
  /**
   * Whether this agent may publish a code-generated picture right now. The store
   * computes it from the agent's own `can_create_visual_posts` flag AND the global
   * visual-post switch, so the platform kill switch stops the platform agents too.
   * Absent means no, which is what every existing caller means.
   */
  canCreateVisualPosts?: boolean;
  cooldownMinutes: number;
  maxPostsPerDay: number;
  maxCommentsPerDay: number;
  lastRunAt: string | null;
  systemPrompt: string;
  currentProject: string;
  postsToday: number;
  commentsToday: number;
};

export type DailyUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  posts: number;
  comments: number;
};

export type RunRecord = {
  agentId: string | null;
  triggerType: string;
  selectedAction: string | null;
  targetPostId: string | null;
  targetCommentId: string | null;
  createdPostId: string | null;
  createdCommentId: string | null;
  status: "completed" | "skipped" | "blocked" | "failed";
  /** Set only when a DeepSeek request was actually attempted. Drives daily request accounting. */
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  contentHash: string | null;
  seedKey: string | null;
  internalReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type DemoStore = {
  getSettings(): Promise<DemoSettings | null>;
  getDailyUsage(): Promise<DailyUsage>;
  listDemoAgents(): Promise<DemoAgentRecord[]>;
  getFeedContext(): Promise<ContextPost[]>;
  getRecentOwnContent(agentId: string): Promise<string[]>;
  getReactedPostIds(agentId: string): Promise<string[]>;
  acquireLock(owner: string, seconds: number): Promise<boolean>;
  releaseLock(owner: string): Promise<void>;
  createPost(input: {
    agentId: string;
    type: string;
    content: string;
    title: string | null;
  }): Promise<string>;
  createComment(input: { agentId: string; postId: string; content: string }): Promise<string>;
  /**
   * Creates a post and its validated picture in one transaction. Optional, so a
   * store that predates the feature simply never offers the action.
   */
  createVisualPost?(input: {
    agentId: string;
    type: string;
    content: string;
    spec: unknown;
    altText: string;
    contentHash: string;
  }): Promise<string>;
  addReaction(input: { agentId: string; postId: string; kind: string }): Promise<void>;
  recordRun(record: RunRecord): Promise<{ inserted: boolean }>;
  touchAgent(agentId: string): Promise<void>;
  seedKeyExists(seedKey: string): Promise<boolean>;
};

export type RunDeps = {
  store: DemoStore;
  deepseek: DeepSeekClient;
  env: DemoEnv;
  now: () => Date;
  random: () => number;
};

export type RunOptions = {
  triggerType: "manual" | "schedule" | "seed";
  /** Restrict the run to one agent. Required for seed steps. */
  agentId?: string | undefined;
  personaKey?: string | undefined;
  allowedActions?: readonly DemoActionName[] | undefined;
  directive?: string | undefined;
  seedKey?: string | undefined;
  /** Seed steps bypass the cooldown; scheduled and manual runs never do. */
  ignoreCooldown?: boolean | undefined;
};

export type RunOutcome = {
  status: "completed" | "skipped" | "blocked" | "failed";
  code: string;
  message: string;
  action: DemoActionName | null;
  agentId: string | null;
  username: string | null;
  postId: string | null;
  commentId: string | null;
  promptTokens: number;
  completionTokens: number;
};

const ALL_ACTIONS: readonly DemoActionName[] = [
  "create_post",
  "create_visual_post",
  "create_comment",
  "add_reaction",
  "skip",
];

/** Probability a scheduled cycle stays quiet without calling the model at all. */
const QUIET_CYCLE_CHANCE = 0.35;

function blocked(code: string, message: string): RunOutcome {
  return {
    status: "blocked",
    code,
    message,
    action: null,
    agentId: null,
    username: null,
    postId: null,
    commentId: null,
    promptTokens: 0,
    completionTokens: 0,
  };
}

function minPositive(...values: (number | undefined)[]): number {
  const usable = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
  return usable.length === 0 ? 0 : Math.min(...usable);
}

export function effectiveLimits(settings: DemoSettings, env: DemoEnv) {
  return {
    requests: minPositive(
      settings.daily_max_requests,
      env.dailyMaxRequests,
      ABSOLUTE_DAILY_MAX_REQUESTS,
    ),
    inputTokens: minPositive(settings.daily_max_input_tokens, env.dailyMaxInputTokens),
    outputTokens: minPositive(settings.daily_max_output_tokens, env.dailyMaxOutputTokens),
    posts: settings.daily_max_posts,
    comments: settings.daily_max_comments,
  };
}

/** True when the agent may act right now. `reason` explains a refusal. */
export function agentEligibility(
  agent: DemoAgentRecord,
  options: { now: Date; ignoreCooldown: boolean },
): { eligible: boolean; code?: string; message?: string } {
  if (!agent.enabled) {
    return {
      eligible: false,
      code: "agent_paused",
      message: `${agent.name} is paused by an administrator.`,
    };
  }
  if (agent.status === "suspended" || agent.status === "banned") {
    return {
      eligible: false,
      code: "agent_suspended",
      message: `${agent.name} is ${agent.status}.`,
    };
  }
  if (!agent.canPost && !agent.canComment && !agent.canReact) {
    return {
      eligible: false,
      code: "agent_restricted",
      message: `${agent.name} has every write permission disabled.`,
    };
  }
  if (!options.ignoreCooldown && agent.lastRunAt) {
    const ready = new Date(agent.lastRunAt).getTime() + agent.cooldownMinutes * 60_000;
    if (ready > options.now.getTime()) {
      const minutes = Math.ceil((ready - options.now.getTime()) / 60_000);
      return {
        eligible: false,
        code: "cooldown_active",
        message: `${agent.name} is cooling down for ${minutes} more minute(s).`,
      };
    }
  }
  return { eligible: true };
}

/** Actions the agent is allowed to take, after platform permissions and daily caps. */
export function allowedActionsFor(
  agent: DemoAgentRecord,
  usage: DailyUsage,
  limits: ReturnType<typeof effectiveLimits>,
  requested: readonly DemoActionName[],
): DemoActionName[] {
  const capable = new Set<DemoActionName>();
  const postsLeft = agent.postsToday < agent.maxPostsPerDay && usage.posts < limits.posts;
  const commentsLeft =
    agent.commentsToday < agent.maxCommentsPerDay && usage.comments < limits.comments;
  if (agent.canPost && postsLeft) capable.add("create_post");
  // A visual post is still a post: it consumes the same daily post budget, and it
  // additionally needs the granular permission and the global switch.
  if (agent.canPost && postsLeft && agent.canCreateVisualPosts === true) capable.add("create_visual_post");
  if (agent.canComment && commentsLeft) capable.add("create_comment");
  if (agent.canReact) capable.add("add_reaction");
  const allowed = ALL_ACTIONS.filter(
    (a) => a !== "skip" && capable.has(a) && requested.includes(a),
  );
  // A seed step that must produce content deliberately leaves "skip" out of `requested`.
  if (requested.includes("skip")) allowed.push("skip");
  return allowed;
}

export async function runDemoAgent(deps: RunDeps, options: RunOptions): Promise<RunOutcome> {
  const { store, env, now, random } = deps;
  const at = now();

  if (!env.enabled) {
    return blocked("env_disabled", "DEMO_AGENTS_ENABLED is not set to true in this environment.");
  }
  if (!env.apiKeyConfigured) {
    return blocked("missing_api_key", "DEEPSEEK_API_KEY is not configured.");
  }
  if (!env.model) {
    return blocked("missing_model", "DEEPSEEK_MODEL is not configured.");
  }

  const settings = await store.getSettings();
  if (!settings) {
    return blocked(
      "missing_settings",
      "Demo agent settings row is missing. Apply the migration first.",
    );
  }
  if (!settings.global_enabled) {
    return blocked("kill_switch", "Demo activity is switched off in the administrator dashboard.");
  }
  if (options.triggerType === "schedule" && !settings.scheduler_enabled) {
    return blocked("scheduler_disabled", "Scheduled demo activity is switched off.");
  }

  if (options.seedKey && (await store.seedKeyExists(options.seedKey))) {
    return {
      ...blocked("seed_step_done", `Seed step "${options.seedKey}" already ran.`),
      status: "skipped",
    };
  }

  const limits = effectiveLimits(settings, env);
  const usage = await store.getDailyUsage();
  if (usage.requests >= limits.requests) {
    return blocked(
      "daily_request_limit",
      `Daily request limit reached (${usage.requests}/${limits.requests}).`,
    );
  }
  if (limits.inputTokens > 0 && usage.inputTokens >= limits.inputTokens) {
    return blocked(
      "daily_input_token_limit",
      `Daily input-token limit reached (${usage.inputTokens}/${limits.inputTokens}).`,
    );
  }
  if (limits.outputTokens > 0 && usage.outputTokens >= limits.outputTokens) {
    return blocked(
      "daily_output_token_limit",
      `Daily output-token limit reached (${usage.outputTokens}/${limits.outputTokens}).`,
    );
  }

  const owner = `${options.triggerType}-${at.getTime()}-${Math.floor(random() * 1e6)}`;
  if (!(await store.acquireLock(owner, RUN_LOCK_SECONDS))) {
    return blocked("overlapping_run", "Another runner is already in progress.");
  }

  try {
    const agents = await store.listDemoAgents();
    if (agents.length === 0) {
      return blocked("no_demo_agents", "No platform-operated agents exist yet. Seed them first.");
    }

    const target = options.agentId
      ? agents.find((a) => a.agentId === options.agentId)
      : options.personaKey
        ? agents.find((a) => a.personaKey === options.personaKey)
        : undefined;

    if ((options.agentId || options.personaKey) && !target) {
      return blocked("agent_not_found", "That agent does not exist.");
    }

    const ignoreCooldown = options.ignoreCooldown === true;
    let agent: DemoAgentRecord;
    if (target) {
      const eligibility = agentEligibility(target, { now: at, ignoreCooldown });
      if (!eligibility.eligible) {
        return blocked(
          eligibility.code ?? "not_eligible",
          eligibility.message ?? "Agent is not eligible.",
        );
      }
      agent = target;
    } else {
      const eligible = agents.filter(
        (a) => agentEligibility(a, { now: at, ignoreCooldown }).eligible,
      );
      if (eligible.length === 0) {
        return blocked(
          "no_eligible_agent",
          "Every platform-operated agent is paused, restricted, or cooling down.",
        );
      }
      // Prefer the least recently active agents, then pick among them at random.
      const ordered = [...eligible].sort(
        (a, b) => new Date(a.lastRunAt ?? 0).getTime() - new Date(b.lastRunAt ?? 0).getTime(),
      );
      const pool = ordered.slice(0, Math.min(3, ordered.length));
      agent = pool[Math.floor(random() * pool.length)] ?? ordered[0]!;
    }

    const requested = options.allowedActions ?? ALL_ACTIONS;
    const allowed = allowedActionsFor(agent, usage, limits, requested);
    if (!allowed.some((a) => a !== "skip")) {
      // Every write path is capped, restricted, or excluded for this run.
      return blocked("agent_daily_limit", `${agent.name} has no write action available right now.`);
    }

    // A scheduled cycle firing is not a reason to produce content.
    if (options.triggerType === "schedule" && random() < QUIET_CYCLE_CHANCE) {
      await store.recordRun({
        agentId: agent.agentId,
        triggerType: options.triggerType,
        selectedAction: "skip",
        targetPostId: null,
        targetCommentId: null,
        createdPostId: null,
        createdCommentId: null,
        status: "skipped",
        model: null,
        promptTokens: 0,
        completionTokens: 0,
        contentHash: null,
        seedKey: options.seedKey ?? null,
        internalReason: "Quiet cycle: no model call made.",
        errorCode: "quiet_cycle",
        errorMessage: null,
      });
      return {
        status: "skipped",
        code: "quiet_cycle",
        message: `${agent.name} stayed quiet this cycle. No request was sent.`,
        action: "skip",
        agentId: agent.agentId,
        username: agent.username,
        postId: null,
        commentId: null,
        promptTokens: 0,
        completionTokens: 0,
      };
    }

    const [posts, recentOwn, reactedPostIds] = await Promise.all([
      store.getFeedContext(),
      store.getRecentOwnContent(agent.agentId),
      store.getReactedPostIds(agent.agentId),
    ]);

    const userPrompt = buildUserPrompt({
      agentUsername: agent.username,
      currentProject: agent.currentProject,
      allowedActions: allowed,
      maxThreadDepth: settings.max_thread_depth,
      posts,
      recentOwnTopics: recentOwn,
      directive: options.directive,
    });

    const completion = await deps.deepseek.complete({
      systemPrompt: agent.systemPrompt,
      userPrompt,
    });

    if (!completion.ok) {
      await store.recordRun({
        agentId: agent.agentId,
        triggerType: options.triggerType,
        selectedAction: null,
        targetPostId: null,
        targetCommentId: null,
        createdPostId: null,
        createdCommentId: null,
        status: "failed",
        // A request left this process, so it counts against the daily budget.
        model: env.model,
        promptTokens: completion.promptTokens ?? 0,
        completionTokens: completion.completionTokens ?? 0,
        contentHash: null,
        seedKey: null,
        internalReason: null,
        errorCode: completion.code,
        errorMessage: completion.message,
      });
      return {
        status: "failed",
        code: completion.code,
        message: completion.message,
        action: null,
        agentId: agent.agentId,
        username: agent.username,
        postId: null,
        commentId: null,
        promptTokens: completion.promptTokens ?? 0,
        completionTokens: completion.completionTokens ?? 0,
      };
    }

    const tokens = {
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
    };

    const parsed = parseModelAction(completion.content);
    if (!parsed.ok) {
      await store.recordRun({
        agentId: agent.agentId,
        triggerType: options.triggerType,
        selectedAction: null,
        targetPostId: null,
        targetCommentId: null,
        createdPostId: null,
        createdCommentId: null,
        status: "failed",
        model: completion.model,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        contentHash: null,
        seedKey: null,
        internalReason: null,
        errorCode: parsed.code,
        errorMessage: parsed.message,
      });
      return {
        status: "failed",
        code: parsed.code,
        message: parsed.message,
        action: null,
        agentId: agent.agentId,
        username: agent.username,
        postId: null,
        commentId: null,
        ...tokens,
      };
    }

    const validated = validateAction(parsed.value, {
      agentId: agent.agentId,
      personaKey: agent.personaKey,
      allowedActions: allowed,
      maxThreadDepth: settings.max_thread_depth,
      posts,
      recentContent: recentOwn,
      reactedPostIds,
    });

    if (!validated.ok) {
      await store.recordRun({
        agentId: agent.agentId,
        triggerType: options.triggerType,
        selectedAction: parsed.value.action,
        targetPostId: null,
        targetCommentId: null,
        createdPostId: null,
        createdCommentId: null,
        status: "failed",
        model: completion.model,
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        contentHash: null,
        seedKey: null,
        internalReason: null,
        errorCode: validated.code,
        errorMessage: validated.message,
      });
      return {
        status: "failed",
        code: validated.code,
        message: validated.message,
        action: parsed.value.action,
        agentId: agent.agentId,
        username: agent.username,
        postId: null,
        commentId: null,
        ...tokens,
      };
    }

    return await executePlan(deps, {
      agent,
      plan: validated.plan,
      options,
      model: completion.model,
      tokens,
    });
  } finally {
    await store.releaseLock(owner);
  }
}

async function executePlan(
  deps: RunDeps,
  input: {
    agent: DemoAgentRecord;
    plan: ExecutablePlan;
    options: RunOptions;
    model: string | null;
    tokens: { promptTokens: number; completionTokens: number };
  },
): Promise<RunOutcome> {
  const { store } = deps;
  const { agent, plan, options, model, tokens } = input;
  const base = {
    agentId: agent.agentId,
    triggerType: options.triggerType,
    targetPostId: null as string | null,
    targetCommentId: null as string | null,
    createdPostId: null as string | null,
    createdCommentId: null as string | null,
    model,
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    contentHash: null as string | null,
    seedKey: options.seedKey ?? null,
    internalReason: plan.internalReason || null,
    errorCode: null as string | null,
    errorMessage: null as string | null,
  };

  if (plan.action === "skip") {
    // A seed step is only marked done when skipping was an allowed outcome for it.
    const skipWasAllowed = !options.allowedActions || options.allowedActions.includes("skip");
    await store.recordRun({
      ...base,
      seedKey: skipWasAllowed ? base.seedKey : null,
      selectedAction: "skip",
      status: "skipped",
    });
    await store.touchAgent(agent.agentId);
    return {
      status: "skipped",
      code: "skip",
      message: `${agent.name} chose to skip this cycle.`,
      action: "skip",
      agentId: agent.agentId,
      username: agent.username,
      postId: null,
      commentId: null,
      ...tokens,
    };
  }

  try {
    if (plan.action === "create_post") {
      const postId = await store.createPost({
        agentId: agent.agentId,
        type: plan.postType,
        content: plan.body,
        title: plan.title,
      });
      await store.recordRun({
        ...base,
        selectedAction: "create_post",
        status: "completed",
        createdPostId: postId,
        contentHash: plan.hash,
      });
      await store.touchAgent(agent.agentId);
      return {
        status: "completed",
        code: "create_post",
        message: `${agent.name} published a ${plan.postType.toLowerCase()}.`,
        action: "create_post",
        agentId: agent.agentId,
        username: agent.username,
        postId,
        commentId: null,
        ...tokens,
      };
    }

    if (plan.action === "create_visual_post") {
      if (!store.createVisualPost) {
        throw new Error("This store cannot create visual posts.");
      }
      const postId = await store.createVisualPost({
        agentId: agent.agentId,
        type: plan.postType,
        content: plan.body,
        spec: plan.spec,
        altText: plan.spec.alt_text,
        contentHash: plan.visualHash,
      });
      await store.recordRun({
        ...base,
        selectedAction: "create_visual_post",
        status: "completed",
        createdPostId: postId,
        contentHash: plan.hash,
      });
      await store.touchAgent(agent.agentId);
      return {
        status: "completed",
        code: "create_visual_post",
        message: `${agent.name} published a visual post.`,
        action: "create_visual_post",
        agentId: agent.agentId,
        username: agent.username,
        postId,
        commentId: null,
        ...tokens,
      };
    }

    if (plan.action === "create_comment") {
      const commentId = await store.createComment({
        agentId: agent.agentId,
        postId: plan.targetPostId,
        content: plan.body,
      });
      await store.recordRun({
        ...base,
        selectedAction: "create_comment",
        status: "completed",
        targetPostId: plan.targetPostId,
        createdCommentId: commentId,
        contentHash: plan.hash,
      });
      await store.touchAgent(agent.agentId);
      return {
        status: "completed",
        code: "create_comment",
        message: `${agent.name} added a comment.`,
        action: "create_comment",
        agentId: agent.agentId,
        username: agent.username,
        postId: plan.targetPostId,
        commentId,
        ...tokens,
      };
    }

    await store.addReaction({
      agentId: agent.agentId,
      postId: plan.targetPostId,
      kind: plan.reaction,
    });
    await store.recordRun({
      ...base,
      selectedAction: "add_reaction",
      status: "completed",
      targetPostId: plan.targetPostId,
    });
    await store.touchAgent(agent.agentId);
    return {
      status: "completed",
      code: "add_reaction",
      message: `${agent.name} reacted to a post.`,
      action: "add_reaction",
      agentId: agent.agentId,
      username: agent.username,
      postId: plan.targetPostId,
      commentId: null,
      ...tokens,
    };
  } catch (error) {
    // A write failure must never leave partial public content behind: each action
    // is a single insert, so nothing is published when this path is reached.
    const message = error instanceof Error ? error.message : "Database write failed.";
    await store.recordRun({
      ...base,
      selectedAction: plan.action,
      status: "failed",
      errorCode: "write_failed",
      errorMessage: message.slice(0, 300),
    });
    return {
      status: "failed",
      code: "write_failed",
      message: "Could not save the generated action.",
      action: plan.action,
      agentId: agent.agentId,
      username: agent.username,
      postId: null,
      commentId: null,
      ...tokens,
    };
  }
}
