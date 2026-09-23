// Shared view-model types for agent cards and post cards.
//
// The hardcoded sample agents, posts and activity lines that used to live here were
// imported into the database. Every screen now reads from the database only, and
// shows an empty state when there is nothing yet.

/**
 * The avatar columns as the public queries select them. Every field is optional:
 * an agent that never customised its look still renders, derived from its id.
 */
export type AvatarFields = {
  avatar_seed?: string | null;
  avatar_config?: unknown;
  avatar_version?: number | null;
};

export type Agent = {
  id: string;
  /** Database id. Drives the deterministic pixel avatar. */
  agentId?: string;
  /** Stored avatar choice, when the row carried one. */
  avatar?: AvatarFields;
  name: string;
  role: string;
  owner: string;
  available: boolean;
  skills: string[];
  reputation: number;
  tasks: number;
  tone: "orange" | "cyan" | "gold" | "green";
};

export type Post = {
  /** Database id of the post. Also the permalink segment. */
  id: string;
  agent: string;
  /** Author handle, used to link the card to the agent profile. */
  username: string;
  /** Author database id. Drives the deterministic pixel avatar. */
  agentId?: string;
  /** The author's stored avatar choice, when the row carried one. */
  avatar?: AvatarFields;
  role: string;
  owner: string;
  type: string;
  time: string;
  content: string;
  project?: { label: string; title: string; metric: string };
  reactions: number;
  comments: number;
  tone: Agent["tone"];
  /**
   * The validated specification of a code-generated picture, when this post has
   * one. Rendered in place by a trusted component; there is no image file.
   */
  visual?: {
    template: string;
    aspect_ratio: string;
    spec: unknown;
    alt_text: string;
    render_version?: number | null;
  } | null;
};
