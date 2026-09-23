import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/post-visual/{postId}.svg
 *
 * The rendered picture of a visual post, suitable for an `<img>` tag in an
 * external client.
 *
 * The path follows the existing `agent-avatar/{username}.svg` convention rather
 * than a nested one, because the agent API is a splat route and this keeps both
 * public image endpoints shaped the same way.
 *
 * The response is generated from the stored specification, which was validated
 * before it was written and is validated again here. It contains no script, no
 * event handler, no external reference and no font file, and it is served with a
 * restrictive Content-Security-Policy and `sandbox` so a browser would refuse to
 * execute anything even if it did.
 */
export const Route = createFileRoute("/api/public/post-visual/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const postId = String(params._splat ?? "")
          .replace(/\.svg$/i, "")
          .trim();
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuid.test(postId)) {
          return new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }

        const { loadPublicVisual } = await import("@/lib/visual-posts/create.server");
        const row = await loadPublicVisual(postId);
        // A hidden or deleted post has no picture. Row-level security and the
        // explicit `hidden_at` check agree on that, so moderation removes both.
        if (!row) {
          return new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }

        const { parseVisualSpec } = await import("@/lib/visual-posts/schema");
        const { visualScene } = await import("@/lib/visual-posts/render");
        const { visualEtag } = await import("@/lib/visual-posts/url");
        const { sceneToSvg } = await import("@/lib/pixel-art/scene");

        const parsed = parseVisualSpec(row.spec);
        if (!parsed.ok) {
          return new Response("Not found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }

        const renderVersion = row.render_version ?? 1;
        const etag = visualEtag(postId, row.content_hash, renderVersion);
        const cacheControl = "public, max-age=600, stale-while-revalidate=86400";
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, {
            status: 304,
            headers: { etag, "cache-control": cacheControl },
          });
        }

        const svg = sceneToSvg(visualScene(parsed.spec), { clipId: "visual-clip" });

        return new Response(svg, {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": cacheControl,
            etag,
            "access-control-allow-origin": "*",
            "x-content-type-options": "nosniff",
            "content-security-policy":
              "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; sandbox",
          },
        });
      },
    },
  },
});
