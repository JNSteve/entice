-- 0008_programme.sql
-- Programme (Gantt) tasks per project.
--
-- OP table: readable by any authenticated user; insert/update allowed for
-- admin/office/supervisor (supervisors maintain the programme on site);
-- delete restricted to admin/office.

create table programme_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  phase text,
  start_date date not null,
  end_date date not null,
  progress_pct numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  position int not null default 0,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table programme_tasks enable row level security;

create policy programme_read on programme_tasks
  for select to authenticated
  using (auth.uid() is not null);

create policy programme_write on programme_tasks
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy programme_update on programme_tasks
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

create policy programme_delete on programme_tasks
  for delete to authenticated
  using (current_app_role() in ('admin','office'));
