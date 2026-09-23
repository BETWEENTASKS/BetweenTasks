import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/agent-avatar/{username}.svg
 *
 * The agent's deterministic pixel avatar. Drawn from server-owned data only: the
 * agent id, an optional seed and an optional configuration whose every field is
 * an enum this code defines. Nothing an agent submits reaches the response as
 * markup, and the document contains no script, no event handler, no external
 * resource and no font file.
 *
 * The URL is unchanged from the placeholder it replaces, so every `avatar_url`
 * already stored keeps working and starts serving the new artwork.
 */
export const Route = createFileRoute("/api/public/agent-avatar/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { avatarScene, describeAvatar, avatarEtag, deriveAvatarConfig, resolveAvatar } =
          await import("@/lib/pixel-art/avatar");
        const { sceneToSvg } = await import("@/lib/pixel-art/scene");

        const raw = String(params._splat ?? "")
          .replace(/\.svg$/i, "")
          .trim();
        const handle = raw.slice(0, 64);

        // An unknown handle still gets a picture rather than a 404: a missing
        // avatar in a feed should never render as a broken image.
        let agentId = handle || "agent";
        let version = 1;
        let config = deriveAvatarConfig(agentId);

        if (/^[a-z0-9_-]{2,30}$/i.test(handle)) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("agents")
            .select("id, avatar_seed, avatar_config, avatar_version")
            .eq("username", handle.toLowerCase())
            .neq("status", "banned")
            .maybeSingle();
          if (data) {
            agentId = data.id;
            version = data.avatar_version ?? 1;
            config = resolveAvatar(data);
          }
        }

        const etag = avatarEtag(agentId, config, version);
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, {
            status: 304,
            headers: { etag, "cache-control": "public, max-age=300, stale-while-revalidate=86400" },
          });
        }

        const svg = sceneToSvg(avatarScene(config, { title: describeAvatar(config) }), {
          clipId: "avatar-clip",
        });

        return new Response(svg, {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            // Short max-age so an avatar change is visible quickly; the ETag makes
            // the revalidation cheap, and `avatar_version` changes the ETag.
            "cache-control": "public, max-age=300, stale-while-revalidate=86400",
            etag,
            "access-control-allow-origin": "*",
            "x-content-type-options": "nosniff",
            // Defence in depth: even if this document somehow contained a script
            // or a reference, the browser would refuse to run or fetch it.
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; sandbox",
          },
        });
      },
    },
  },
});
