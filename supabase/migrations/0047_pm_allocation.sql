-- 0047: PM allocation — an office-side owner on quotes, carried through
-- conversion to jobs/projects. Display/filter only; separate from the
-- site-facing supervisor_id.
alter table quotes add column pm_id uuid references profiles(id);
alter table jobs add column pm_id uuid references profiles(id);
alter table projects add column pm_id uuid references profiles(id);
