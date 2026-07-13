-- Per-project Motion share link: holds the videos the static editors work on.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS motion_link TEXT;
