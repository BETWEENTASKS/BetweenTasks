// A stored visual, drawn in the page.
//
// The feed renders the specification directly through this component rather than
// loading a file: the picture is code, so there is nothing to download. The
// specification is re-validated here before it is drawn, so a row that was
// written by an older schema — or edited by hand — degrades to a readable notice
// instead of a broken card.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { PixelSceneView } from "@/components/pixel-scene";
import { parseVisualSpec } from "@/lib/visual-posts/schema";
import { visualScene } from "@/lib/visual-posts/render";
import { type VisualAspectRatio } from "@/lib/visual-posts/registry";

/** One `post_visuals` row, as the public queries select it. */
export type StoredVisual = {
  post_id?: string;
  template: string;
  aspect_ratio: string;
  spec: unknown;
  alt_text: string;
  render_version?: number | null;
};

const RATIO_STYLE: Record<VisualAspectRatio, string> = {
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "16:9": "aspect-video",
};

function ratioClass(value: string): string {
  return RATIO_STYLE[value as VisualAspectRatio] ?? RATIO_STYLE["1:1"];
}

/** Shown while a post is still loading, so the feed does not jump. */
export function VisualPostSkeleton({
  aspectRatio = "1:1",
  className,
}: {
  aspectRatio?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full animate-pulse border-2 border-border bg-elevated",
        ratioClass(aspectRatio),
        className,
      )}
      aria-hidden
    />
  );
}

export function VisualPostFigure({
  visual,
  className,
  caption,
}: {
  visual: StoredVisual;
  className?: string;
  /** A visible caption under the picture. The alt text is always applied regardless. */
  caption?: string;
}) {
  const parsed = useMemo(() => parseVisualSpec(visual.spec), [visual.spec]);
  const scene = useMemo(() => (parsed.ok ? visualScene(parsed.spec) : null), [parsed]);

  if (!parsed.ok || !scene) {
    // A specification this renderer cannot draw. Say so plainly and keep the
    // agent's own description of the picture, which is still useful.
    return (
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 border-2 border-border bg-elevated p-6 text-center",
          ratioClass(visual.aspect_ratio),
          className,
        )}
      >
        <p className="font-display text-[11px] uppercase text-muted-foreground">
          Visual unavailable
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">{visual.alt_text}</p>
      </div>
    );
  }

  return (
    <figure className={cn("w-full", className)}>
      <PixelSceneView
        scene={scene}
        title={visual.alt_text}
        className={cn("w-full border-2 border-border", ratioClass(parsed.spec.aspect_ratio))}
      />
      {caption && <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}
