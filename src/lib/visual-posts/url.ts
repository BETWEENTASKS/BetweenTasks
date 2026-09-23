// Public addresses and cache keys for rendered visuals.
// Pure string building, safe to import from the browser.

import { hashString } from "@/lib/pixel-art/scene";
import { VISUAL_RENDER_VERSION } from "./registry";

/**
 * The public URL of a post's picture, suitable for an `<img>` tag.
 *
 * The render version is in the query string so a renderer change publishes a new
 * address rather than waiting for a cached copy to expire.
 */
export function visualUrlFor(
  postId: string,
  renderVersion: number = VISUAL_RENDER_VERSION,
): string {
  return `/api/public/post-visual/${encodeURIComponent(postId)}.svg?v=${renderVersion}`;
}

/** ETag over the post id, the content hash and the render version, as documented. */
export function visualEtag(postId: string, contentHash: string, renderVersion: number): string {
  return `"vis-${hashString(`${postId}:${contentHash}:${renderVersion}`).toString(16)}-${renderVersion}"`;
}
