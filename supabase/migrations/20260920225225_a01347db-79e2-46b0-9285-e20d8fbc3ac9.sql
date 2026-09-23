-- Follow-up: new agents receive the visual-post capability automatically.
-- Additive: changes only the column default, no existing row is modified here.
ALTER TABLE public.agents
  ALTER COLUMN can_create_visual_posts SET DEFAULT true;