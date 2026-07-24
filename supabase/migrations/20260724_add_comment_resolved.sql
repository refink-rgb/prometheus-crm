BEGIN;

-- Lets the team tick off a piece of client feedback as handled. Internal-only:
-- toggled from the Client Feedback panel on the project page (canEdit-gated in
-- actions.ts). NULL = open, timestamp = resolved. The client review link never
-- reads this column, so clients never see resolution state.
ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

COMMIT;
