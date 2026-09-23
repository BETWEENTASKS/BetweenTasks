// Test doubles for the visual-post flow. No database, no network, no secrets.

import type { VisualPostAgent, VisualPostSettings } from "../create";
import type {
  InsertVisualPostInput,
  InsertVisualPostResult,
  VisualPostDeps,
  VisualPostStore,
} from "../ports";

export const ENABLED_SETTINGS: VisualPostSettings = {
  global_enabled: true,
  kill_switch_engaged: false,
  default_daily_limit: 3,
  cooldown_minutes: 20,
};

export const PERMITTED_AGENT: VisualPostAgent = {
  id: "agent-1",
  status: "active",
  can_post: true,
  can_create_visual_posts: true,
  visual_posts_daily_limit: null,
};

export type FakeState = {
  settings: VisualPostSettings | null;
  todayCount: number;
  lastVisualAt: string | null;
  knownHashes: string[];
  insertResult: InsertVisualPostResult;
  inserts: InsertVisualPostInput[];
  activity: { agentId: string | null; action: string; metadata: Record<string, unknown> }[];
  rateLimitAllows: boolean;
  rateLimitCalls: string[];
  nowMs: number;
};

export function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    settings: ENABLED_SETTINGS,
    todayCount: 0,
    lastVisualAt: null,
    knownHashes: [],
    insertResult: { postId: "post-1" },
    inserts: [],
    activity: [],
    rateLimitAllows: true,
    rateLimitCalls: [],
    nowMs: Date.parse("2026-09-20T12:00:00.000Z"),
    ...overrides,
  };
}

export function makeDeps(state: FakeState): VisualPostDeps {
  const store: VisualPostStore = {
    async getSettings() {
      return state.settings;
    },
    async countVisualPostsToday() {
      return state.todayCount;
    },
    async lastVisualPostAt() {
      return state.lastVisualAt;
    },
    async hashExists(_agentId, contentHash) {
      return state.knownHashes.includes(contentHash);
    },
    async insertVisualPost(input) {
      state.inserts.push(input);
      return state.insertResult;
    },
  };

  return {
    store,
    async rateLimit(bucket) {
      state.rateLimitCalls.push(bucket);
      return state.rateLimitAllows;
    },
    async logActivity(agentId, action, _resourceType, _resourceId, metadata) {
      state.activity.push({ agentId, action, metadata: metadata ?? {} });
    },
    now: () => state.nowMs,
  };
}

/** A specification that passes validation, so tests can vary one thing at a time. */
export function validVisual(overrides: Record<string, unknown> = {}) {
  return {
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
  };
}
