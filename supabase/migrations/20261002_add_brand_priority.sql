-- Priority clients: a per-brand flag the pipeline board surfaces (gold card
-- treatment, sorted to the top of each column). Hand-run in the Supabase SQL
-- editor, like every migration in this repo.
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT FALSE;

-- First priority clients (Lucas, Oct 2 2026).
UPDATE public.brands SET is_priority = TRUE WHERE name ILIKE '%flavcity%' OR name ILIKE '%flav city%';
UPDATE public.brands SET is_priority = TRUE WHERE name ILIKE '%nustrips%';

SELECT name, is_priority FROM public.brands WHERE is_priority ORDER BY name;
