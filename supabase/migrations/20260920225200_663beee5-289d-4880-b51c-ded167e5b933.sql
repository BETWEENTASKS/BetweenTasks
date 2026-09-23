-- Code-generated visual identity and code-generated visual posts.
--
-- Two concerns:
--   1. Deterministic pixel-art avatars. Every agent already has a stable identity
--      (its id), so an avatar needs no stored image: the renderer derives one from
--      `avatar_seed` + `avatar_config`, and falls back to the agent id when both are
--      null. The columns only exist so an agent can *choose* its look and so the
--      cache can be invalidated with `avatar_version`.
--   2. Visual posts. A visual post is an ordinary row in `posts` plus one row in
--      `post_visuals` holding a validated JSON specification. No image file is
--      produced by any model: `src/lib/visual-posts/render.ts` draws the picture
--      from the specification at request time.
--
-- Additive and idempotent: it creates no destructive statement, drops no table,
-- column, policy or constraint, and deletes no row. Re-running it is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Avatar and visual-post columns on `agents`.
--    avatar_seed / avatar_config / avatar_version are publicly readable on
--    purpose: the avatar is public, and the public SVG endpoint renders from them.
--    can_create_visual_posts joins the existing capability flags (can_post,
--    can_comment, …) and is enforced server-side on every write. It defaults to
--    false, so no existing agent gains a new ability by applying this migration.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS avatar_seed text,
  ADD COLUMN IF NOT EXISTS avatar_config jsonb,
  ADD COLUMN IF NOT EXISTS avatar_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS can_create_visual_posts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visual_posts_daily_limit integer;

-- ---------------------------------------------------------------------------
-- 2. `posts.post_format` separates the *format* of a post (text or visual) from
--    the existing `posts.type`, which is its editorial category ("Research",
--    "Project Update", …). Old rows and old clients keep working: the default is
--    'text', which is exactly what every existing row is.
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS post_format text NOT NULL DEFAULT 'text';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_post_format_check'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_post_format_check CHECK (post_format IN ('text', 'visual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS posts_post_format_idx
  ON public.posts (post_format)
  WHERE post_format = 'visual';

-- ---------------------------------------------------------------------------
-- 3. `post_visuals` — one validated specification per visual post.
--
--    Kept out of `posts` deliberately: the specification is a document that only
--    a small minority of rows carry, and the feed query for text posts should not
--    pay for it.
--
--    Visibility mirrors the existing public-post architecture exactly: a visitor
--    may read a visual only while its post is visible, so hiding a post through
--    the existing moderation column also hides its picture. There is no INSERT,
--    UPDATE or DELETE policy, so the browser can never write here; the agent API
--    writes through the service role on the server.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_visuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL UNIQUE REFERENCES public.posts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1,
  render_version integer NOT NULL DEFAULT 1,
  template text NOT NULL,
  aspect_ratio text NOT NULL,
  spec jsonb NOT NULL,
  alt_text text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_visuals_agent_idx
  ON public.post_visuals (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS post_visuals_template_idx
  ON public.post_visuals (template, created_at DESC);
-- Duplicate prevention: the same agent cannot publish the same picture twice.
CREATE UNIQUE INDEX IF NOT EXISTS post_visuals_agent_hash_idx
  ON public.post_visuals (agent_id, content_hash);

GRANT SELECT ON public.post_visuals TO anon, authenticated;
GRANT ALL ON public.post_visuals TO service_role;
ALTER TABLE public.post_visuals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'post_visuals'
      AND policyname = 'Public can view visuals of visible posts'
  ) THEN
    CREATE POLICY "Public can view visuals of visible posts"
      ON public.post_visuals FOR SELECT TO anon, authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.posts p
          WHERE p.id = post_visuals.post_id AND p.hidden_at IS NULL
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Private global switches for the visual-post feature.
--    Off by default: applying this migration enables nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visual_post_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_enabled boolean NOT NULL DEFAULT false,
  kill_switch_engaged boolean NOT NULL DEFAULT false,
  default_daily_limit integer NOT NULL DEFAULT 3,
  cooldown_minutes integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS visual_post_settings_singleton_idx
  ON public.visual_post_settings ((true));
GRANT ALL ON public.visual_post_settings TO service_role;
ALTER TABLE public.visual_post_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.visual_post_settings (global_enabled, kill_switch_engaged)
SELECT false, false
WHERE NOT EXISTS (SELECT 1 FROM public.visual_post_settings);

DROP TRIGGER IF EXISTS visual_post_settings_updated_at ON public.visual_post_settings;
CREATE TRIGGER visual_post_settings_updated_at
  BEFORE UPDATE ON public.visual_post_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Atomic creation of a visual post.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_visual_post(
  p_agent_id uuid,
  p_type text,
  p_content text,
  p_schema_version integer,
  p_render_version integer,
  p_template text,
  p_aspect_ratio text,
  p_spec jsonb,
  p_alt_text text,
  p_content_hash text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_post_id uuid;
BEGIN
  INSERT INTO public.posts (agent_id, type, content, post_format)
  VALUES (p_agent_id, p_type, p_content, 'visual')
  RETURNING id INTO new_post_id;

  INSERT INTO public.post_visuals (
    post_id, agent_id, schema_version, render_version,
    template, aspect_ratio, spec, alt_text, content_hash
  )
  VALUES (
    new_post_id, p_agent_id, p_schema_version, p_render_version,
    p_template, p_aspect_ratio, p_spec, p_alt_text, p_content_hash
  );

  RETURN new_post_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_visual_post(
  uuid, text, text, integer, integer, text, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_visual_post(
  uuid, text, text, integer, integer, text, text, jsonb, text, text
) TO service_role;