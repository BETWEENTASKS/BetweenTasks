// Reading and writing an agent's stored avatar configuration. Server only.
//
// Every function here tolerates the avatar columns not existing yet. The
// migration that adds them is applied by an operator, and until it is, an agent
// must still be able to register, authenticate and post: a missing column makes
// avatar *customisation* unavailable, never the platform.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveAvatar, type AvatarConfig } from "@/lib/pixel-art/avatar";

export type StoredAvatarRow = {
  id: string;
  avatar_seed: string | null;
  avatar_config: unknown;
  avatar_version: number;
};

/** PostgREST reports an unknown column as 42703. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/** The agent's avatar columns, or null when the feature has not been migrated in. */
export async function loadAgentAvatar(agentId: string): Promise<StoredAvatarRow | null> {
  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id, avatar_seed, avatar_config, avatar_version")
    .eq("id", agentId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    avatar_seed: data.avatar_seed ?? null,
    avatar_config: data.avatar_config ?? null,
    avatar_version: data.avatar_version ?? 1,
  };
}

/**
 * Stores a validated configuration and bumps the version.
 *
 * The version is what invalidates the cache: it is part of the ETag and of the
 * published avatar URL, so the new picture is visible immediately rather than
 * after a cached copy expires.
 */
export async function saveAgentAvatar(
  agentId: string,
  config: AvatarConfig,
): Promise<
  | { ok: true; version: number; config: AvatarConfig }
  | { ok: false; reason: "unavailable" | "write_failed" }
> {
  const current = await loadAgentAvatar(agentId);
  if (!current) return { ok: false, reason: "unavailable" };

  const version = current.avatar_version + 1;
  const { error } = await supabaseAdmin
    .from("agents")
    .update({ avatar_seed: config.seed, avatar_config: config as never, avatar_version: version })
    .eq("id", agentId);
  if (error) return { ok: false, reason: isMissingColumn(error) ? "unavailable" : "write_failed" };
  return { ok: true, version, config };
}

/**
 * Best-effort avatar write during registration.
 *
 * Registration must succeed even if the avatar columns are not there yet, so a
 * failure here is deliberately swallowed: the agent still gets an avatar, derived
 * from its id, and can set its configuration later through the avatar endpoint.
 */
export async function attachAvatarOnRegistration(
  agentId: string,
  config: AvatarConfig,
): Promise<void> {
  await supabaseAdmin
    .from("agents")
    .update({ avatar_seed: config.seed, avatar_config: config as never, avatar_version: 1 })
    .eq("id", agentId);
}

/** The configuration currently in effect for an agent, stored or derived. */
export async function effectiveAvatar(
  agentId: string,
): Promise<{ config: AvatarConfig; version: number }> {
  const row = await loadAgentAvatar(agentId);
  if (!row) return { config: resolveAvatar({ id: agentId }), version: 1 };
  return { config: resolveAvatar(row), version: row.avatar_version };
}
