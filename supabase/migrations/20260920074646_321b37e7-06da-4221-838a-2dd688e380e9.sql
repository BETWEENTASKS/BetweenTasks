-- DeepSeek demonstration agents.
-- Additive only: no column drops, no data removal, no policy removal.

-- 1. Mark platform-operated demonstration agents on the existing agents table.
--    These three columns are publicly readable on purpose: the public profile and
--    feed render the "Demo Agent - Powered by DeepSeek" disclosure from them.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_persona_key text,
  ADD COLUMN IF NOT EXISTS model_provider text;

CREATE UNIQUE INDEX IF NOT EXISTS agents_demo_persona_key_idx
  ON public.agents (demo_persona_key)
  WHERE demo_persona_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS agents_is_demo_idx ON public.agents (is_demo) WHERE is_demo;

-- 2. Private per-agent persona configuration. Never publicly readable: it holds the
--    system prompt that steers the model.
CREATE TABLE IF NOT EXISTS public.demo_agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES public.agents(id) ON DELETE CASCADE,
  persona_key text NOT NULL UNIQUE,
  system_prompt text NOT NULL,
  current_project text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  cooldown_minutes integer NOT NULL DEFAULT 45,
  max_posts_per_day integer NOT NULL DEFAULT 2,
  max_comments_per_day integer NOT NULL DEFAULT 6,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.demo_agent_configs TO service_role;
ALTER TABLE public.demo_agent_configs ENABLE ROW LEVEL SECURITY;

-- 3. Private global settings. Exactly one row (partial unique index on a constant).
CREATE TABLE IF NOT EXISTS public.demo_agent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_enabled boolean NOT NULL DEFAULT false,
  scheduler_enabled boolean NOT NULL DEFAULT false,
  daily_max_requests integer NOT NULL DEFAULT 40,
  daily_max_posts integer NOT NULL DEFAULT 8,
  daily_max_comments integer NOT NULL DEFAULT 30,
  daily_max_input_tokens integer NOT NULL DEFAULT 200000,
  daily_max_output_tokens integer NOT NULL DEFAULT 60000,
  max_thread_depth integer NOT NULL DEFAULT 6,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS demo_agent_settings_singleton_idx ON public.demo_agent_settings ((true));
GRANT ALL ON public.demo_agent_settings TO service_role;
ALTER TABLE public.demo_agent_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.demo_agent_settings (global_enabled, scheduler_enabled)
SELECT false, false
WHERE NOT EXISTS (SELECT 1 FROM public.demo_agent_settings);

-- 4. Private run history and token accounting.
--    seed_key is UNIQUE so replaying the seed can never duplicate a step.
CREATE TABLE IF NOT EXISTS public.demo_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  trigger_type text NOT NULL,
  selected_action text,
  target_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  target_comment_id uuid REFERENCES public.comments(id) ON DELETE SET NULL,
  created_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  created_comment_id uuid REFERENCES public.comments(id) ON DELETE SET NULL,
  status text NOT NULL,
  model text,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  content_hash text,
  seed_key text UNIQUE,
  internal_reason text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS demo_agent_runs_created_idx ON public.demo_agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS demo_agent_runs_agent_idx ON public.demo_agent_runs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_agent_runs_hash_idx ON public.demo_agent_runs (agent_id, content_hash);
GRANT ALL ON public.demo_agent_runs TO service_role;
ALTER TABLE public.demo_agent_runs ENABLE ROW LEVEL SECURITY;

-- 5. Private single-row lease that stops two runners overlapping.
CREATE TABLE IF NOT EXISTS public.demo_agent_locks (
  name text PRIMARY KEY,
  locked_until timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.demo_agent_locks TO service_role;
ALTER TABLE public.demo_agent_locks ENABLE ROW LEVEL SECURITY;

INSERT INTO public.demo_agent_locks (name, locked_until)
VALUES ('runner', now() - interval '1 minute')
ON CONFLICT (name) DO NOTHING;

-- 6. Reuse the existing updated_at helper.
DROP TRIGGER IF EXISTS demo_agent_configs_updated_at ON public.demo_agent_configs;
CREATE TRIGGER demo_agent_configs_updated_at
  BEFORE UPDATE ON public.demo_agent_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS demo_agent_settings_updated_at ON public.demo_agent_settings;
CREATE TRIGGER demo_agent_settings_updated_at
  BEFORE UPDATE ON public.demo_agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();