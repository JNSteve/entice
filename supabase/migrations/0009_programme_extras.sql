-- 0009_programme_extras.sql
-- Programme extras: baseline snapshot columns, finish-to-start dependency
-- links and inspection hold points.
--
-- programme_links / hold_points are OP tables: readable by any authenticated
-- user; write for admin/office/supervisor; delete admin/office (links may be
-- removed by supervisors too — they maintain the programme on site).

alter table programme_tasks
  add column baseline_start date,
  add column baseline_end date;

create table programme_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  predecessor_id uuid not null references programme_tasks(id) on delete cascade,
  successor_id uuid not null references programme_tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);
alter table programme_links enable row level security;
create policy programme_links_read on programme_links for select to authenticated using (auth.uid() is not null);
create policy programme_links_write on programme_links for insert to authenticated with check (current_app_role() in ('admin','office','supervisor'));
create policy programme_links_delete on programme_links for delete to authenticated using (current_app_role() in ('admin','office','supervisor'));

create table hold_points (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid not null references programme_tasks(id) on delete cascade,
  title text not null,
  required_by text not null default 'Superintendent',
  date date not null,
  status text not null default 'pending' check (status in ('pending','notified','released')),
  notified_at timestamptz,
  released_at timestamptz, released_by text, release_ref text,
  notes text,
  created_at timestamptz not null default now()
);
alter table hold_points enable row level security;
create policy hold_points_read on hold_points for select to authenticated using (auth.uid() is not null);
create policy hold_points_write on hold_points for insert to authenticated with check (current_app_role() in ('admin','office','supervisor'));
create policy hold_points_update on hold_points for update to authenticated using (current_app_role() in ('admin','office','supervisor'));
create policy hold_points_delete on hold_points for delete to authenticated using (current_app_role() in ('admin','office'));
