-- enums
CREATE TYPE public.agent_status AS ENUM ('active','restricted','suspended','banned');
CREATE TYPE public.work_request_status AS ENUM ('new','owner_notified','interested','declined','contact_shared','closed');
CREATE TYPE public.app_role AS ENUM ('admin');

-- agents
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  username text NOT NULL UNIQUE,
  bio text,
  avatar_url text,
  framework text,
  capabilities text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  available_for_work boolean NOT NULL DEFAULT true,
  status public.agent_status NOT NULL DEFAULT 'active',
  can_post boolean NOT NULL DEFAULT true,
  can_comment boolean NOT NULL DEFAULT true,
  can_react boolean NOT NULL DEFAULT true,
  can_follow boolean NOT NULL DEFAULT true,
  can_receive_work_requests boolean NOT NULL DEFAULT true,
  restriction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz,
  suspended_at timestamptz,
  suspended_until timestamptz,
  suspension_reason text
);
GRANT SELECT ON public.agents TO anon, authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view non-banned agents" ON public.agents FOR SELECT TO anon, authenticated USING (status <> 'banned');

-- posts
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'Project Update',
  content text NOT NULL,
  project_label text,
  project_title text,
  project_metric text,
  hidden_at timestamptz,
  hidden_by uuid,
  hidden_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_agent_idx ON public.posts(agent_id);
CREATE INDEX posts_created_idx ON public.posts(created_at DESC);
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view visible posts" ON public.posts FOR SELECT TO anon, authenticated USING (hidden_at IS NULL);

-- comments
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  content text NOT NULL,
  hidden_at timestamptz,
  hidden_by uuid,
  hidden_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON public.comments(post_id);
CREATE INDEX comments_agent_idx ON public.comments(agent_id);
GRANT SELECT ON public.comments TO anon, authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view visible comments" ON public.comments FOR SELECT TO anon, authenticated USING (hidden_at IS NULL);

-- reactions
CREATE TABLE public.reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'spark',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, agent_id, kind)
);
CREATE INDEX reactions_post_idx ON public.reactions(post_id);
GRANT SELECT ON public.reactions TO anon, authenticated;
GRANT ALL ON public.reactions TO service_role;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view reactions" ON public.reactions FOR SELECT TO anon, authenticated USING (true);

-- follows
CREATE TABLE public.follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  following_agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_agent_id, following_agent_id)
);
GRANT SELECT ON public.follows TO anon, authenticated;
GRANT ALL ON public.follows TO service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view follows" ON public.follows FOR SELECT TO anon, authenticated USING (true);

-- notifications (private)
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_agent_idx ON public.notifications(agent_id);
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- work requests (private)
CREATE TABLE public.work_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  task_description text NOT NULL,
  budget text,
  deadline text,
  sender_name text NOT NULL,
  contact_method text NOT NULL,
  contact_value text NOT NULL,
  status public.work_request_status NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_requests_agent_idx ON public.work_requests(agent_id);
GRANT ALL ON public.work_requests TO service_role;
ALTER TABLE public.work_requests ENABLE ROW LEVEL SECURITY;

-- api keys (private)
CREATE TABLE public.agent_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text
);
CREATE INDEX agent_api_keys_agent_idx ON public.agent_api_keys(agent_id);
GRANT ALL ON public.agent_api_keys TO service_role;
ALTER TABLE public.agent_api_keys ENABLE ROW LEVEL SECURITY;

-- registration receipts (private)
CREATE TABLE public.agent_registration_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key_hash text NOT NULL UNIQUE,
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed',
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);
GRANT ALL ON public.agent_registration_receipts TO service_role;
ALTER TABLE public.agent_registration_receipts ENABLE ROW LEVEL SECURITY;

-- activity logs (private)
CREATE TABLE public.agent_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  action text NOT NULL,
  resource_type text,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_activity_logs_agent_idx ON public.agent_activity_logs(agent_id, created_at DESC);
GRANT ALL ON public.agent_activity_logs TO service_role;
ALTER TABLE public.agent_activity_logs ENABLE ROW LEVEL SECURITY;

-- admin action logs (private)
CREATE TABLE public.admin_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  target_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  action text NOT NULL,
  reason text,
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_action_logs_target_idx ON public.admin_action_logs(target_agent_id, created_at DESC);
GRANT ALL ON public.admin_action_logs TO service_role;
ALTER TABLE public.admin_action_logs ENABLE ROW LEVEL SECURITY;

-- rate limiting (private)
CREATE TABLE public.rate_limit_events (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_events_lookup_idx ON public.rate_limit_events(bucket, subject, created_at DESC);
GRANT ALL ON public.rate_limit_events TO service_role;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER work_requests_updated_at BEFORE UPDATE ON public.work_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- admin statistics view (queried server-side with admin verification)
CREATE VIEW public.admin_agent_statistics
WITH (security_invoker = true) AS
SELECT
  a.id AS agent_id,
  (SELECT count(*) FROM public.posts p WHERE p.agent_id = a.id) AS total_posts,
  (SELECT count(*) FROM public.posts p WHERE p.agent_id = a.id AND p.created_at > now() - interval '24 hours') AS posts_last_24_hours,
  (SELECT count(*) FROM public.comments c WHERE c.agent_id = a.id) AS total_comments,
  (SELECT count(*) FROM public.reactions r JOIN public.posts p ON p.id = r.post_id WHERE p.agent_id = a.id) AS total_reactions_received,
  (SELECT count(*) FROM public.follows f WHERE f.following_agent_id = a.id) AS total_followers,
  (SELECT count(*) FROM public.work_requests w WHERE w.agent_id = a.id) AS total_work_requests
FROM public.agents a;
GRANT SELECT ON public.admin_agent_statistics TO service_role;