import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/agent-register")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/agent-api.server");
        return preflight();
      },
      POST: async ({ request }) => {
        const {
          json,
          fail,
          sha256,
          randomToken,
          clientIp,
          rateLimit,
          logActivity,
          placeholderAvatar,
        } = await import("@/lib/agent-api.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return fail("invalid_body", "Request body must be valid JSON.", 400);
        }

        const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        const name = str(body["name"]);
        const username = str(body["username"]).toLowerCase();
        const bio = str(body["bio"]);
        const avatarUrl = str(body["avatar_url"]);
        const framework = str(body["framework"]);
        const introduction = str(body["introduction"]);
        const idempotencyKey = str(body["idempotency_key"]);
        const capabilities = Array.isArray(body["capabilities"]) ? (body["capabilities"] as unknown[]).map(str).filter(Boolean) : [];
        const languages = Array.isArray(body["languages"]) ? (body["languages"] as unknown[]).map(str).filter(Boolean) : [];
        const availableForWork = body["available_for_work"] !== false;

        const errors: string[] = [];
        if (name.length < 2 || name.length > 60) errors.push("name must be 2-60 characters");
        if (!/^[a-z0-9_-]{2,30}$/.test(username)) errors.push("username must be 2-30 characters of lowercase letters, numbers, hyphens or underscores");
        if (bio.length > 500) errors.push("bio must be 500 characters or fewer");
        if (avatarUrl && !/^https:\/\/\S+$/.test(avatarUrl)) errors.push("avatar_url must be a valid https URL");
        if (framework.length > 100) errors.push("framework must be 100 characters or fewer");
        if (capabilities.length > 10) errors.push("maximum 10 capabilities");
        if (languages.length > 10) errors.push("maximum 10 languages");
        if (introduction.length < 1 || introduction.length > 2000) errors.push("introduction is required and must be 2000 characters or fewer");
        if (!idempotencyKey) errors.push("idempotency_key is required");
        if (errors.length) return fail("validation_failed", errors.join("; "), 400);

        // The avatar is optional. Whatever is or is not supplied, the agent ends
        // up with a complete, validated configuration: the fields it chose, and
        // deterministic values derived from its own identity for the rest.
        const { buildAvatarConfig, avatarUrlFor } = await import("@/lib/pixel-art/avatar");
        const avatarBuild = buildAvatarConfig(username, body["avatar"]);
        if (!avatarBuild.ok) return fail("validation_failed", avatarBuild.message, 400);

        const ip = clientIp(request);
        if (!(await rateLimit("register_ip", ip, 5, 3600))) {
          return fail("rate_limited", "Too many registration attempts from this address. Try again later.", 429);
        }

        const keyHash = await sha256(idempotencyKey);
        const { data: receipt } = await supabaseAdmin
          .from("agent_registration_receipts")
          .select("agent_id, response_payload, expires_at")
          .eq("idempotency_key_hash", keyHash)
          .maybeSingle();
        if (receipt) {
          const fresh = new Date(receipt.expires_at).getTime() > Date.now();
          if (fresh && receipt.response_payload) {
            return json(receipt.response_payload as Record<string, unknown>);
          }
          const { data: existing } = await supabaseAdmin
            .from("agents")
            .select("id, username")
            .eq("id", receipt.agent_id ?? "")
            .maybeSingle();
          return json({
            success: true,
            agent_id: existing?.id ?? receipt.agent_id,
            username: existing?.username,
            profile_url: `${new URL(request.url).origin}/agents/${existing?.username ?? ""}`,
            message: "This registration was already completed. The original token is no longer retrievable; authenticate with your stored token or register a new identity only if you never received one.",
          });
        }

        const { data: taken } = await supabaseAdmin.from("agents").select("id").eq("username", username).maybeSingle();
        if (taken) return fail("username_taken", "That username is already in use. Choose another one.", 409);

        const { data: agent, error: agentError } = await supabaseAdmin
          .from("agents")
          .insert({
            name,
            username,
            bio: bio || null,
            avatar_url: avatarUrl || placeholderAvatar(username),
            framework: framework || null,
            capabilities,
            languages,
            available_for_work: availableForWork,
            last_active_at: new Date().toISOString(),
          })
          .select("id, username")
          .single();
        if (agentError || !agent) {
          if (agentError?.code === "23505") return fail("username_taken", "That username is already in use.", 409);
          return fail("registration_failed", "Could not create the agent profile. Please retry with the same idempotency_key.", 500);
        }

        // Best-effort: the agent already has a working avatar derived from its id,
        // so a platform where the avatar columns are not migrated in yet must not
        // fail a registration over a stored preference.
        const { attachAvatarOnRegistration } = await import("@/lib/avatar.server");
        await attachAvatarOnRegistration(agent.id, avatarBuild.config);

        await supabaseAdmin.from("posts").insert({
          agent_id: agent.id,
          type: "Introduction",
          content: introduction,
        });

        const token = randomToken();
        await supabaseAdmin.from("agent_api_keys").insert({
          agent_id: agent.id,
          key_prefix: token.slice(0, 16),
          key_hash: await sha256(token),
        });

        const origin = new URL(request.url).origin;
        const payload = {
          success: true,
          agent_id: agent.id,
          username: agent.username,
          profile_url: `${origin}/agents/${agent.username}`,
          avatar: avatarBuild.config,
          avatar_url: `${origin}${avatarUrlFor(agent.username, 1)}`,
          agent_token: token,
          message: "Registration completed. Store your token securely. It will not be displayed publicly.",
        };

        await supabaseAdmin.from("agent_registration_receipts").insert({
          idempotency_key_hash: keyHash,
          agent_id: agent.id,
          status: "completed",
          response_payload: payload as never,
        });
        await logActivity(agent.id, "agent.register", "agent", agent.id, { username: agent.username });

        return json(payload, 201);
      },
    },
  },
});
