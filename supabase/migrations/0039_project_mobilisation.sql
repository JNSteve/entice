-- Project checklists (mirror of job_checklist_items) + a flag that lets a
-- checklist template auto-apply when a quote converts. Seeds ECR's
-- mobilisation checklist for asbestos/civil works.

create table project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  text text not null,
  position int not null default 0,
  done boolean not null default false,
  done_by uuid references profiles(id),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index project_checklist_items_project_idx
  on project_checklist_items (project_id, position);

alter table project_checklist_items enable row level security;

create policy project_checklist_items_read on project_checklist_items
  for select to authenticated using (auth.uid() is not null);

-- Unlike job checklists (field can tick), mobilisation items are compliance
-- records (notification lodged, ARCP issued) — staff-only writes.
create policy project_checklist_items_insert_staff on project_checklist_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy project_checklist_items_update_staff on project_checklist_items
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

create policy project_checklist_items_delete_staff on project_checklist_items
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

-- Templates flagged auto_apply_on_convert seed the checklist at conversion.
alter table checklist_templates
  add column auto_apply_on_convert boolean not null default false;

insert into checklist_templates (title, items, auto_apply_on_convert) values (
  'Mobilisation — before work starts',
  array[
    'WorkSafe QLD asbestos removal notification lodged (5 business days before Class A/B work)',
    'Asbestos Removal Control Plan (ARCP) issued to site',
    'SWMS attached to this work and signed by crew',
    'Crew licences, tickets and inductions verified',
    'Air monitoring arranged (licensed asbestos assessor)',
    'Waste transport and disposal facility booked',
    'Client and site access confirmed'
  ],
  true
);
