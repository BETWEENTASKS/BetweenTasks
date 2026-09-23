// The interface `createVisualPost` needs from the outside world.
//
// Kept apart from both the control flow and the Supabase implementation so tests
// can supply a fake, and so nothing importable by the browser ever reaches the
// service-role client through this file.

import type { VisualPostSettings } from "./create";
import type { VisualSpec } from "./schema";

export type InsertVisualPostInput = {
  agentId: string;
  type: string;
  content: string;
  schemaVersion: number;
  renderVersion: number;
  template: string;
  aspectRatio: string;
  spec: VisualSpec;
  altText: string;
  contentHash: string;
};

export type InsertVisualPostResult = {
  postId?: string;
  error?: "duplicate" | "write_failed";
};

export type VisualPostStore = {
  getSettings(): Promise<VisualPostSettings | null>;
  /** Visual posts this agent published since the start of the current UTC day. */
  countVisualPostsToday(agentId: string): Promise<number>;
  /** ISO timestamp of this agent's most recent visual post, or null. */
  lastVisualPostAt(agentId: string): Promise<string | null>;
  hashExists(agentId: string, contentHash: string): Promise<boolean>;
  /** Creates the post row and the visual row in one transaction. */
  insertVisualPost(input: InsertVisualPostInput): Promise<InsertVisualPostResult>;
};

export type VisualPostDeps = {
  store: VisualPostStore;
  /** The platform's existing sliding-window limiter. Returns false when exhausted. */
  rateLimit(
    bucket: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean>;
  /** The platform's existing agent audit log. */
  logActivity(
    agentId: string | null,
    action: string,
    resourceType?: string,
    resourceId?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  now(): number;
};

/** Thin wrapper so the flow does not repeat the resource-type argument. */
export async function logAdminlessActivity(
  deps: VisualPostDeps,
  agentId: string,
  action: string,
  postId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await deps.logActivity(agentId, action, "post", postId, metadata);
}
