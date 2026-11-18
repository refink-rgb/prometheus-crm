-- Prometheus 2.0, phase 2: creating work from a template.
--
--   create_work()   makes one piece of work with its deliverables and tasks in
--                   a single transaction, so a failure never leaves half a job.
--                   The app works out the dates and owners; this only saves.
--   templates       the two starting service lines: Test (offer, landing page
--                   and creatives, each optional) and Evergreen ads. BFCM keeps
--                   its own planner. Templates are edited in the app at
--                   /v2/templates; this only adds them if missing.
--
-- Needs 20261117_work_2_0_foundations.sql first. Safe to re-run.
-- Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/mhizyjlvqrhwzjqywiwz/sql/new

BEGIN;

-- p_work:         { brand_id, template_id, service_line, name, launch_date, pod_id, owner_id, created_by }
-- p_deliverables: [{ key, kind, label }]
-- p_tasks:        [{ key, title, deliverable, parent, role, owner_id, due_date }]
--                 parents listed before their subtasks; deliverable and parent are keys
CREATE OR REPLACE FUNCTION public.create_work(p_work JSONB, p_deliverables JSONB, p_tasks JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_work UUID;
  v_id   UUID;
  d      JSONB;
  t      JSONB;
  dmap   JSONB := '{}'::jsonb;
  tmap   JSONB := '{}'::jsonb;
  i      INTEGER := 0;
BEGIN
  INSERT INTO public.work (brand_id, template_id, service_line, name, launch_date, pod_id, owner_id, created_by)
  VALUES (
    (p_work->>'brand_id')::uuid,
    NULLIF(p_work->>'template_id', '')::uuid,
    p_work->>'service_line',
    p_work->>'name',
    NULLIF(p_work->>'launch_date', '')::date,
    NULLIF(p_work->>'pod_id', '')::uuid,
    NULLIF(p_work->>'owner_id', '')::uuid,
    NULLIF(p_work->>'created_by', '')::uuid
  )
  RETURNING id INTO v_work;

  FOR d IN SELECT value FROM jsonb_array_elements(p_deliverables) LOOP
    INSERT INTO public.work_deliverables (work_id, kind, label, sort_order)
    VALUES (v_work, d->>'kind', d->>'label', i)
    RETURNING id INTO v_id;
    dmap := dmap || jsonb_build_object(d->>'key', v_id);
    i := i + 1;
  END LOOP;

  i := 0;
  FOR t IN SELECT value FROM jsonb_array_elements(p_tasks) LOOP
    IF t->>'deliverable' IS NOT NULL AND NOT dmap ? (t->>'deliverable') THEN
      RAISE EXCEPTION 'Task "%" belongs to a deliverable that is not in this work', t->>'title';
    END IF;
    IF t->>'parent' IS NOT NULL AND NOT tmap ? (t->>'parent') THEN
      RAISE EXCEPTION 'Subtask "%" comes before its parent', t->>'title';
    END IF;
    INSERT INTO public.work_tasks (work_id, deliverable_id, parent_id, key, title, role, owner_id, due_date, sort_order)
    VALUES (
      v_work,
      (dmap->>(t->>'deliverable'))::uuid,
      (tmap->>(t->>'parent'))::uuid,
      t->>'key',
      t->>'title',
      NULLIF(t->>'role', ''),
      NULLIF(t->>'owner_id', '')::uuid,
      NULLIF(t->>'due_date', '')::date,
      i
    )
    RETURNING id INTO v_id;
    tmap := tmap || jsonb_build_object(t->>'key', v_id);
    i := i + 1;
  END LOOP;

  RETURN v_work;
END $$;

REVOKE ALL ON FUNCTION public.create_work(JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work(JSONB, JSONB, JSONB) TO authenticated;

-- ── starting templates ───────────────────────────────────────────────────
-- Steps follow today's moment stages: brief, in progress, internal review,
-- client review, revisions, ready, live. Days are before launch; weekends move
-- to the Friday before.

INSERT INTO public.work_templates (name, description, sort_order, deliverables, tasks)
SELECT 'Test',
  'A marketing test: an offer, a landing page and creatives. Leave out the landing page or the creatives when the test only needs one.',
  1,
  '[
    {"key": "offer",     "kind": "offer",        "label": "Offer",        "optional": true},
    {"key": "lp",        "kind": "landing_page", "label": "Landing page", "optional": true},
    {"key": "creatives", "kind": "creative_set", "label": "Creatives",    "optional": true}
  ]'::jsonb,
  '[
    {"key": "offer_draft",    "title": "Draft the offer",                     "deliverable": "offer",     "role": "account_manager", "days_before_launch": 24, "parent": null},
    {"key": "offer_internal", "title": "Internal offer review",               "deliverable": "offer",     "role": "account_manager", "days_before_launch": 22, "parent": null},
    {"key": "offer_client",   "title": "Client approves the offer",           "deliverable": "offer",     "role": "account_manager", "days_before_launch": 19, "parent": null},
    {"key": "lp_brief",       "title": "Write the landing page brief",        "deliverable": "lp",        "role": "account_manager", "days_before_launch": 17, "parent": null},
    {"key": "lp_build",       "title": "Build the page",                      "deliverable": "lp",        "role": "lp_builder",      "days_before_launch": 12, "parent": null},
    {"key": "lp_internal",    "title": "Internal review",                     "deliverable": "lp",        "role": "account_manager", "days_before_launch": 9,  "parent": null},
    {"key": "lp_client",      "title": "Client review",                       "deliverable": "lp",        "role": "account_manager", "days_before_launch": 7,  "parent": null},
    {"key": "lp_changes",     "title": "Make the client''s changes",          "deliverable": "lp",        "role": "lp_builder",      "days_before_launch": 4,  "parent": null},
    {"key": "lp_qa",          "title": "Final QA",                            "deliverable": "lp",        "role": "lp_builder",      "days_before_launch": 2,  "parent": null},
    {"key": "lp_qa_devices",  "title": "Check desktop and mobile",            "deliverable": "lp",        "role": "lp_builder",      "days_before_launch": 2,  "parent": "lp_qa"},
    {"key": "lp_qa_links",    "title": "Test every link and the discount code", "deliverable": "lp",      "role": "lp_builder",      "days_before_launch": 2,  "parent": "lp_qa"},
    {"key": "lp_live",        "title": "Page goes live",                      "deliverable": "lp",        "role": "lp_builder",      "days_before_launch": 0,  "parent": null},
    {"key": "cr_brief",       "title": "Write the creative brief",            "deliverable": "creatives", "role": "account_manager", "days_before_launch": 17, "parent": null},
    {"key": "cr_make",        "title": "Make the creatives",                  "deliverable": "creatives", "role": "designer",        "days_before_launch": 12, "parent": null},
    {"key": "cr_internal",    "title": "Internal review",                     "deliverable": "creatives", "role": "account_manager", "days_before_launch": 9,  "parent": null},
    {"key": "cr_client",      "title": "Client review",                       "deliverable": "creatives", "role": "account_manager", "days_before_launch": 7,  "parent": null},
    {"key": "cr_changes",     "title": "Make the client''s changes",          "deliverable": "creatives", "role": "designer",        "days_before_launch": 4,  "parent": null},
    {"key": "cr_final",       "title": "Final files to Drive",                "deliverable": "creatives", "role": "designer",        "days_before_launch": 2,  "parent": null},
    {"key": "cr_final_sizes", "title": "Check every size and format",         "deliverable": "creatives", "role": "designer",        "days_before_launch": 2,  "parent": "cr_final"},
    {"key": "cr_final_copy",  "title": "Check the copy against the brief",    "deliverable": "creatives", "role": "designer",        "days_before_launch": 2,  "parent": "cr_final"},
    {"key": "cr_live",        "title": "Ads go live",                         "deliverable": "creatives", "role": "account_manager", "days_before_launch": 0,  "parent": null}
  ]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.work_templates WHERE lower(btrim(name)) = 'test' AND archived_at IS NULL);

INSERT INTO public.work_templates (name, description, sort_order, deliverables, tasks)
SELECT 'Evergreen ads',
  'A set of always-on ad creatives.',
  2,
  '[
    {"key": "creatives", "kind": "creative_set", "label": "Creatives", "optional": false}
  ]'::jsonb,
  '[
    {"key": "cr_brief",    "title": "Write the creative brief",   "deliverable": "creatives", "role": "account_manager", "days_before_launch": 10, "parent": null},
    {"key": "cr_make",     "title": "Make the creatives",         "deliverable": "creatives", "role": "designer",        "days_before_launch": 6,  "parent": null},
    {"key": "cr_internal", "title": "Internal review",            "deliverable": "creatives", "role": "account_manager", "days_before_launch": 4,  "parent": null},
    {"key": "cr_client",   "title": "Client review",              "deliverable": "creatives", "role": "account_manager", "days_before_launch": 3,  "parent": null},
    {"key": "cr_changes",  "title": "Make the client''s changes", "deliverable": "creatives", "role": "designer",        "days_before_launch": 1,  "parent": null},
    {"key": "cr_live",     "title": "Ads go live",                "deliverable": "creatives", "role": "account_manager", "days_before_launch": 0,  "parent": null}
  ]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.work_templates WHERE lower(btrim(name)) = 'evergreen ads' AND archived_at IS NULL);

COMMIT;
