-- Anonymous agent conversations and owner dashboard. Additive and disabled by default.
DO $$ BEGIN CREATE TYPE public.conversation_intent AS ENUM ('question','hire'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.conversation_status AS ENUM ('open','owner_attention','closed','blocked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.conversation_sender AS ENUM ('guest','agent','owner','system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS anonymous_chat_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.anonymous_chat_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), global_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(), CHECK (global_enabled IN (true,false))
);
CREATE UNIQUE INDEX IF NOT EXISTS anonymous_chat_settings_singleton_idx ON public.anonymous_chat_settings ((true));
INSERT INTO public.anonymous_chat_settings (global_enabled) SELECT false WHERE NOT EXISTS (SELECT 1 FROM public.anonymous_chat_settings);

CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE RESTRICT,
  intent public.conversation_intent NOT NULL, status public.conversation_status NOT NULL DEFAULT 'open',
  guest_alias text NOT NULL CHECK (char_length(guest_alias) BETWEEN 3 AND 40), guest_access_hash text NOT NULL UNIQUE,
  agent_unread boolean NOT NULL DEFAULT true, owner_attention_at timestamptz, contact_shared_at timestamptz,
  hiring_reviewed_at timestamptz, last_message_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_conversations_agent_idx ON public.agent_conversations(agent_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  sender_type public.conversation_sender NOT NULL, content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  client_message_id uuid, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
  UNIQUE (conversation_id, sender_type, client_message_id)
);
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON public.conversation_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.conversation_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('email','telegram','phone','other')),
  contact_value text NOT NULL CHECK (char_length(contact_value) BETWEEN 1 AND 500), consented_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- At most one current value for each of the four supported contact types.
-- Re-submission updates that value instead of growing this private table without bound.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_contacts_type_idx
  ON public.conversation_contacts(conversation_id, contact_type);
CREATE TABLE IF NOT EXISTS public.owner_dashboard_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.owner_dashboard_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.agent_owner_settings (
  agent_id uuid PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE, contact_type text,
  contact_value text CHECK (contact_value IS NULL OR char_length(contact_value) <= 500), allow_agent_contact_sharing boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['anonymous_chat_settings','agent_conversations','conversation_messages','conversation_contacts','owner_dashboard_links','owner_dashboard_sessions','agent_owner_settings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
END LOOP; END $$;

DROP TRIGGER IF EXISTS anonymous_chat_settings_updated_at ON public.anonymous_chat_settings;
CREATE TRIGGER anonymous_chat_settings_updated_at BEFORE UPDATE ON public.anonymous_chat_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS agent_conversations_updated_at ON public.agent_conversations;
CREATE TRIGGER agent_conversations_updated_at BEFORE UPDATE ON public.agent_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS agent_owner_settings_updated_at ON public.agent_owner_settings;
CREATE TRIGGER agent_owner_settings_updated_at BEFORE UPDATE ON public.agent_owner_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
