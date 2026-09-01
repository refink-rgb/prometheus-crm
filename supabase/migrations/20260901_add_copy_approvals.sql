-- Sign-off on individual lines of ad copy.
--
-- The copy deck is a list of candidate headlines, subheadlines and eyebrows. An
-- editor picks from it, but nothing on the row said which lines had been signed
-- off, so approval lived in Slack and the deck could not answer "is this line
-- allowed to go on an ad".
--
-- NOT pipeline_events. That table's event_type CHECK allows five values, all
-- stage/assignment movements, and it carries an append-only trigger. Widening it
-- for a per-line copy verdict would make a table about card movement the home of
-- something else entirely.
--
-- ONE JSONB OBJECT, not two columns, because the state and its history are read
-- and written together, always:
--   {
--     "lines": [ { "text": "...", "status": "approved"|"rejected",
--                  "by": "name", "at": "iso" } ],
--     "log":   [ { "at": "iso", "by": "name",
--                  "approved": 3, "rejected": 1 } ]
--   }
--
-- LINES ARE KEYED BY THEIR TEXT, not by index. Index would rot the moment
-- someone reorders or deletes a line and would silently transfer an approval to
-- a different headline. Keying by text means editing a line drops its approval —
-- which is correct: changed copy has not been approved.
--
-- The log is capped in the writer, newest first. It answers "who signed this
-- off" months later, when the person is the point and the exact list is not.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS copy_approvals JSONB;

-- Object-ness only. Per-key shape is validated in the action and the reader,
-- where it is testable — a CHECK cannot express "lines is an array of objects
-- whose status is one of two strings" without becoming unreadable.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_copy_approvals_is_object;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_copy_approvals_is_object
  CHECK (copy_approvals IS NULL OR jsonb_typeof(copy_approvals) = 'object');

COMMIT;

-- VERIFY:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='projects' AND column_name='copy_approvals';
