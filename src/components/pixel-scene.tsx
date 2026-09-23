// React rendering of a generated scene.
//
// Every rectangle and every text run becomes a React element. There is no
// `dangerouslySetInnerHTML` anywhere in this file, and there cannot be: a scene
// carries no markup to inject, only numbers, colours drawn from server-owned
// palettes, and strings that React escapes when it renders them as children.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { FONT_STACKS, type PixelScene } from "@/lib/pixel-art/scene";
import {
  avatarScene,
  describeAvatar,
  resolveAvatar,
  type AvatarConfig,
  type StoredAvatar,
} from "@/lib/pixel-art/avatar";

let sceneCounter = 0;

/**
 * Draws a scene inline.
 *
 * The clip rectangle is the guarantee that nothing — a very long word, an unusual
 * script, a font that measures wider than expected — can ever paint outside the
 * canvas.
 */
export function PixelSceneView({
  scene,
  className,
  title,
  decorative = false,
}: {
  scene: PixelScene;
  className?: string;
  title?: string;
  decorative?: boolean;
}) {
  // Stable per mount: two scenes on one page must not share a clip-path id.
  const clipId = useMemo(() => `bt-scene-${(sceneCounter += 1)}`, []);
  const label = title ?? scene.title;

  return (
    <svg
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      className={className}
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated" }}
      {...(decorative
        ? { "aria-hidden": true, role: "presentation" as const }
        : { role: "img" as const, "aria-label": label })}
    >
      {!decorative && <title>{label}</title>}
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={scene.width} height={scene.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {scene.rects.map((rect, index) => (
          <rect
            key={`r${index}`}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            fill={rect.fill}
            {...(rect.opacity !== undefined && rect.opacity < 1 ? { opacity: rect.opacity } : {})}
          />
        ))}
        {scene.texts.map((text, index) => (
          <text
            key={`t${index}`}
            x={text.x}
            y={text.y}
            fontFamily={FONT_STACKS[text.font]}
            fontSize={text.size}
            fill={text.fill}
            {...(text.bold ? { fontWeight: 700 } : {})}
            {...(text.anchor === "middle" ? { textAnchor: "middle" } : {})}
            {...(text.tracking ? { letterSpacing: text.tracking } : {})}
          >
            {text.text}
          </text>
        ))}
      </g>
    </svg>
  );
}

const SIZE_CLASS = {
  sm: "size-[42px]",
  md: "size-[58px]",
  lg: "size-[76px]",
  xl: "size-[96px]",
} as const;

/**
 * An agent's avatar.
 *
 * Accepts the agent row as it is stored. An agent that never chose anything — or
 * whose stored choice no longer validates — still gets a stable picture derived
 * from its id, so this never renders an empty box.
 */
export function PixelAvatar({
  agent,
  size = "md",
  className,
  config,
}: {
  agent: StoredAvatar;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  /** Overrides the stored configuration. Used by the administration preview. */
  config?: AvatarConfig;
}) {
  const resolved = useMemo(() => config ?? resolveAvatar(agent), [agent, config]);
  const scene = useMemo(() => avatarScene(resolved), [resolved]);
  return (
    <PixelSceneView
      scene={scene}
      title={describeAvatar(resolved)}
      className={cn("shrink-0 border-2 border-border bg-elevated", SIZE_CLASS[size], className)}
    />
  );
}
