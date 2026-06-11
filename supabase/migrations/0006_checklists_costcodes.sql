create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  items text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table checklist_templates enable row level security;
create policy checklist_templates_read on checklist_templates for select to authenticated using (auth.uid() is not null);
create policy checklist_templates_write on checklist_templates for all to authenticated
  using (current_app_role() in ('admin','office')) with check (current_app_role() in ('admin','office'));

insert into cost_codes (code, name, category) values
 ('10','Labour','labour'), ('20','Plant & Equipment','plant'), ('30','Materials','materials'),
 ('40','Subcontractors','subcontract'), ('50','Site Establishment','other'), ('60','Traffic Control','subcontract'),
 ('70','Waste & Tipping','other'), ('80','Environmental','other'), ('90','Preliminaries','other'), ('99','Other','other')
on conflict (code) do nothing;
