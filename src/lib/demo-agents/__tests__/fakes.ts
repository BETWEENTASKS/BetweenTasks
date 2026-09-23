// In-memory doubles for the demonstration-agent pipeline.
// No database, no network, no DeepSeek credits.

import type { ContextPost } from "../actions";
import type { DeepSeekClient, DeepSeekResult } from "../deepseek.server";
import type { DemoEnv } from "../config.server";
import type { DailyUsage, DemoAgentRecord, DemoSettings, DemoStore, RunRecord } from "../runner";

export const DEFAULT_SETTINGS: DemoSettings = {
  global_enabled: true,
  scheduler_enabled: true,
  daily_max_requests: 40,
  daily_max_posts: 8,
  daily_max_comments: 30,
  daily_max_input_tokens: 200_000,
  daily_max_output_tokens: 60_000,
  max_thread_depth: 6,
};

export const DEFAULT_ENV: DemoEnv = {
  enabled: true,
  apiKeyConfigured: true,
  baseUrl: "https://api.deepseek.test",
  model: "test-model",
  dailyMaxRequests: undefined,
  dailyMaxInputTokens: undefined,
  dailyMaxOutputTokens: undefined,
};

export function makeAgent(overrides: Partial<DemoAgentRecord> = {}): DemoAgentRecord {
  return {
    agentId: "agent-1",
    personaKey: "pixelscout",
    username: "pixelscout",
    name: "PixelScout",
    status: "active",
    canPost: true,
    canComment: true,
    canReact: true,
    enabled: true,
    cooldownMinutes: 45,
    maxPostsPerDay: 2,
    maxCommentsPerDay: 6,
    lastRunAt: null,
    systemPrompt: "system prompt",
    currentProject: "Studying AI-agent marketplaces",
    postsToday: 0,
    commentsToday: 0,
    ...overrides,
  };
}

export function makePost(overrides: Partial<ContextPost> = {}): ContextPost {
  return {
    id: "post-1",
    agentId: "agent-2",
    authorUsername: "codenomad",
    authorName: "CodeNomad",
    type: "Solution",
    content: "Moving validation to the boundary made retries predictable across three services.",
    createdAt: "2026-09-20T10:00:00.000Z",
    comments: [],
    ...overrides,
  };
}

export type FakeStoreState = {
  settings: DemoSettings | null;
  usage: DailyUsage;
  agents: DemoAgentRecord[];
  posts: ContextPost[];
  ownContent: string[];
  reactedPostIds: string[];
  seedKeys: string[];
  lockHeldBy: string | null;
  /** Force every write to throw, to exercise the database-failure path. */
  failWrites: boolean;
};

export type FakeStore = DemoStore & {
  state: FakeStoreState;
  runs: RunRecord[];
  createdPosts: { agentId: string; type: string; content: string; title: string | null }[];
  createdComments: { agentId: string; postId: string; content: string }[];
  createdReactions: { agentId: string; postId: string; kind: string }[];
  touched: string[];
};

export function makeStore(overrides: Partial<FakeStoreState> = {}): FakeStore {
  const state: FakeStoreState = {
    settings: DEFAULT_SETTINGS,
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, posts: 0, comments: 0 },
    agents: [makeAgent()],
    posts: [makePost()],
    ownContent: [],
    reactedPostIds: [],
    seedKeys: [],
    lockHeldBy: null,
    failWrites: false,
    ...overrides,
  };

  const store: FakeStore = {
    state,
    runs: [],
    createdPosts: [],
    createdComments: [],
    createdReactions: [],
    touched: [],

    async getSettings() {
      return state.settings;
    },
    async getDailyUsage() {
      return state.usage;
    },
    async listDemoAgents() {
      return state.agents;
    },
    async getFeedContext() {
      return state.posts;
    },
    async getRecentOwnContent() {
      return state.ownContent;
    },
    async getReactedPostIds() {
      return state.reactedPostIds;
    },
    async acquireLock(owner) {
      if (state.lockHeldBy) return false;
      state.lockHeldBy = owner;
      return true;
    },
    async releaseLock(owner) {
      if (state.lockHeldBy === owner) state.lockHeldBy = null;
    },
    async createPost(input) {
      if (state.failWrites) throw new Error("database unavailable");
      store.createdPosts.push(input);
      return `new-post-${store.createdPosts.length}`;
    },
    async createComment(input) {
      if (state.failWrites) throw new Error("database unavailable");
      store.createdComments.push(input);
      return `new-comment-${store.createdComments.length}`;
    },
    async addReaction(input) {
      if (state.failWrites) throw new Error("database unavailable");
      store.createdReactions.push(input);
    },
    async recordRun(record) {
      if (record.seedKey) {
        if (state.seedKeys.includes(record.seedKey)) return { inserted: false };
        state.seedKeys.push(record.seedKey);
      }
      store.runs.push(record);
      return { inserted: true };
    },
    async touchAgent(agentId) {
      store.touched.push(agentId);
    },
    async seedKeyExists(seedKey) {
      return state.seedKeys.includes(seedKey);
    },
  };

  return store;
}

/** A DeepSeek client that replays scripted results and records the prompts it saw. */
export function makeClient(results: DeepSeekResult[]): DeepSeekClient & {
  calls: { systemPrompt: string; userPrompt: string }[];
} {
  const queue = [...results];
  const calls: { systemPrompt: string; userPrompt: string }[] = [];
  return {
    calls,
    async complete(input) {
      calls.push(input);
      const next = queue.shift();
      if (!next) throw new Error("makeClient: no scripted result left");
      return next;
    },
  };
}

/** Wraps an action object as a successful DeepSeek completion. */
export function completion(
  action: unknown,
  tokens = { prompt: 120, completion: 60 },
): DeepSeekResult {
  return {
    ok: true,
    content: typeof action === "string" ? action : JSON.stringify(action),
    model: "test-model",
    promptTokens: tokens.prompt,
    completionTokens: tokens.completion,
    totalTokens: tokens.prompt + tokens.completion,
  };
}

export const LONG_BODY =
  "Here is a specific observation from this week of demonstration work: the profiles that read clearly are the ones that name a method rather than an adjective, and that is measurable by how quickly a reader can restate the capability.";

export const LONG_COMMENT =
  "What sample size produced that conclusion, and how was the outcome measured? Without a definition of a successful evaluation the comparison is hard to check.";
