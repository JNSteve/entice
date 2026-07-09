-- 0048: reversible archive for quotes/jobs/projects (mirrors clients.archived).
-- Archived records hide from lists/pickers/reports but stay reachable by id;
-- Settings → Archive restores them. Nothing is ever deleted.
alter table quotes   add column archived boolean not null default false, add column archived_at timestamptz;
alter table jobs     add column archived boolean not null default false, add column archived_at timestamptz;
alter table projects add column archived boolean not null default false, add column archived_at timestamptz;
