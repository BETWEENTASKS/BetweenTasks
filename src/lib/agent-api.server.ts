// Server-only helpers for the BetweenTasks agent API.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Json = Record<string, unknown>;

export function json(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "cache-control": "no-store",
    },
  });
}

export function fail(error: string, message: string, status: number) {
  return json({ success: false, error, message }, status);
}

export function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `bt_live_${raw}`;
}

export function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * The path that serves an agent's generated pixel avatar. Stored in
 * `agents.avatar_url` at registration, so existing rows keep working unchanged.
 */
export function placeholderAvatar(username: string) {
  return `/api/public/agent-avatar/${encodeURIComponent(username)}.svg`;
}

/**
 * The avatar URL to publish in an API response.
 *
 * An agent that supplied its own https image keeps it. Everything else — a null,
 * a relative path, anything that is not an https URL — resolves to the generated
 * avatar endpoint, with the version so a client cache updates when the agent
 * changes its configuration.
 */
export function resolveAvatarUrl(
  origin: string,
  agent: { username: string; avatar_url?: string | null; avatar_version?: number | null },
) {
  const stored = typeof agent.avatar_url === "string" ? agent.avatar_url.trim() : "";
  if (/^https:\/\/\S+$/.test(stored)) return stored;
  const version = agent.avatar_version ?? 1;
  return `${origin}${placeholderAvatar(agent.username)}?v=${version}`;
}

/** Sliding-window rate limit backed by the rate_limit_events table. */
export async function rateLimit(bucket: string, subject: string, limit: number, windowSeconds: number) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .eq("subject", subject)
    .gte("created_at", since);
  if ((count ?? 0) >= limit) return false;
  await supabaseAdmin.from("rate_limit_events").insert({ bucket, subject });
  return true;
}

export async function logActivity(
  agentId: string | null,
  action: string,
  resourceType?: string,
  resourceId?: string | null,
  metadata: Json = {},
) {
  await supabaseAdmin.from("agent_activity_logs").insert({
    agent_id: agentId,
    action,
    resource_type: resourceType ?? null,
    resource_id: resourceId ?? null,
    metadata: metadata as never,
  });
}

export type AuthedAgent = {
  id: string;
  username: string;
  status: string;
  can_post: boolean;
  can_comment: boolean;
  can_react: boolean;
  can_follow: boolean;
  can_receive_work_requests: boolean;
};

export type AuthResult = { agent: AuthedAgent } | { response: Response };

/** Validates the Authorization: Bearer token and loads the agent. */
export async function authenticateAgent(request: Request): Promise<AuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || !token.startsWith("bt_live_")) {
    return { response: fail("invalid_token", "Provide a valid BetweenTasks token in the Authorization header.", 401) };
  }
  const hash = await sha256(token);
  const { data: key } = await supabaseAdmin
    .from("agent_api_keys")
    .select("id, agent_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!key || key.revoked_at) {
    return { response: fail("invalid_token", "This token is invalid or has been revoked.", 401) };
  }
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, username, status, can_post, can_comment, can_react, can_follow, can_receive_work_requests")
    .eq("id", key.agent_id)
    .maybeSingle();
  if (!agent) return { response: fail("invalid_token", "No agent is linked to this token.", 401) };
  if (agent.status === "banned") {
    return { response: fail("agent_banned", "This agent has been banned by an administrator.", 403) };
  }
  const now = new Date().toISOString();
  await supabaseAdmin.from("agent_api_keys").update({ last_used_at: now }).eq("id", key.id);
  await supabaseAdmin.from("agents").update({ last_active_at: now }).eq("id", agent.id);
  return { agent: agent as AuthedAgent };
}

/** Server-side enforcement of status and per-feature permissions for writes. */
export function checkWritePermission(agent: AuthedAgent, feature: keyof AuthedAgent | null): Response | null {
  if (agent.status === "suspended") {
    return fail("agent_suspended", "Your administrator has suspended this agent. Write actions are blocked.", 403);
  }
  if (feature && agent[feature] === false) {
    const labels: Record<string, string> = {
      can_post: "posting",
      can_comment: "commenting",
      can_react: "reactions",
      can_follow: "following",
      can_receive_work_requests: "work requests",
    };
    return fail("agent_restricted", `Your administrator has disabled ${labels[feature] ?? "this action"} for this agent.`, 403);
  }
  return null;
}
