-- 0003_rls.sql
-- Row Level Security for every public table.
-- Roles come from public.profiles.role via current_app_role() (security definer, see 0002):
--   admin | office | supervisor | field
--
-- Access matrix summary:
--   MONEY tables  -> all operations restricted to admin/office.
--   OP tables     -> SELECT for any authenticated user; writes vary per table (below).
--   sequences     -> RLS enabled, zero policies (only reachable via security-definer next_number()).

------------------------------------------------------------------------------
-- 1. Enable RLS on all 42 public tables
------------------------------------------------------------------------------
alter table quotes                 enable row level security;
alter table quote_sections         enable row level security;
alter table quote_lines            enable row level security;
alter table rate_items             enable row level security;
alter table budget_lines           enable row level security;
alter table costs                  enable row level security;
alter table purchase_orders        enable row level security;
alter table po_lines               enable row level security;
alter table variations             enable row level security;
alter table claims                 enable row level security;
alter table claim_lines            enable row level security;
alter table retention_entries      enable row level security;
alter table invoices               enable row level security;
alter table invoice_lines          enable row level security;
alter table payments               enable row level security;
alter table commitments            enable row level security;
alter table packages               enable row level security;
alter table package_rfqs           enable row level security;
alter table package_quotes         enable row level security;
alter table clients                enable row level security;
alter table contacts               enable row level security;
alter table sites                  enable row level security;
alter table cost_codes             enable row level security;
alter table plant                  enable row level security;
alter table settings               enable row level security;
alter table profiles               enable row level security;
alter table jobs                   enable row level security;
alter table projects               enable row level security;
alter table assignments            enable row level security;
alter table diaries                enable row level security;
alter table diary_labour           enable row level security;
alter table diary_plant            enable row level security;
alter table swms_templates         enable row level security;
alter table swms_instances         enable row level security;
alter table swms_signatures        enable row level security;
alter table attachments            enable row level security;
alter table job_checklist_items    enable row level security;
alter table work_logs              enable row level security;
alter table timesheet_entries      enable row level security;
alter table vendors                enable row level security;
alter table vendor_compliance_docs enable row level security;
alter table sequences              enable row level security;

------------------------------------------------------------------------------
-- 2. MONEY tables: a single FOR ALL policy, admin/office only
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'quotes','quote_sections','quote_lines','rate_items','budget_lines','costs',
    'purchase_orders','po_lines','variations','claims','claim_lines',
    'retention_entries','invoices','invoice_lines','payments','commitments',
    'packages','package_rfqs','package_quotes'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (current_app_role() in ('admin','office'))
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_admin_office_all', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 3. OP tables: SELECT for any authenticated user
--    (sequences deliberately excluded: no select policy => deny all)
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients','contacts','sites','cost_codes','plant','settings','profiles',
    'jobs','projects','assignments','diaries','diary_labour','diary_plant',
    'swms_templates','swms_instances','swms_signatures','attachments',
    'job_checklist_items','work_logs','timesheet_entries',
    'vendors','vendor_compliance_docs'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (auth.uid() is not null)
    $f$, t || '_select_authenticated', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Reference/master-data tables: writes restricted to admin/office
--    clients, contacts, sites, cost_codes, plant, vendors,
--    vendor_compliance_docs, swms_templates
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients','contacts','sites','cost_codes','plant',
    'vendors','vendor_compliance_docs','swms_templates'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_insert_admin_office', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (current_app_role() in ('admin','office'))
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_update_admin_office', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (current_app_role() in ('admin','office'))
    $f$, t || '_delete_admin_office', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. settings: update only admin (no insert/delete policies -> denied)
------------------------------------------------------------------------------
create policy settings_update_admin on settings
  for update to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 6. profiles: update self-or-admin; insert admin only (real creation goes
--    through admin_create_user rpc); no delete policy -> denied
------------------------------------------------------------------------------
create policy profiles_insert_admin on profiles
  for insert to authenticated
  with check (current_app_role() = 'admin');

create policy profiles_update_self_or_admin on profiles
  for update to authenticated
  using (id = auth.uid() or current_app_role() = 'admin')
  with check (id = auth.uid() or current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 7. jobs & projects: insert admin/office; update admin/office/supervisor
--    (supervisor may update status/details); delete admin/office
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['jobs','projects'] loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (current_app_role() in ('admin','office'))
    $f$, t || '_insert_admin_office', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (current_app_role() in ('admin','office','supervisor'))
        with check (current_app_role() in ('admin','office','supervisor'))
    $f$, t || '_update_staff', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (current_app_role() in ('admin','office'))
    $f$, t || '_delete_admin_office', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 8. job_checklist_items: insert/delete admin/office/supervisor;
--    update any authenticated user (field workers tick items)
------------------------------------------------------------------------------
create policy job_checklist_items_insert_staff on job_checklist_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy job_checklist_items_update_authenticated on job_checklist_items
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy job_checklist_items_delete_staff on job_checklist_items
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

------------------------------------------------------------------------------
-- 9. work_logs: insert admin/office/supervisor;
--    update/delete admin/office or own (created_by)
------------------------------------------------------------------------------
create policy work_logs_insert_staff on work_logs
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy work_logs_update_admin_office_or_own on work_logs
  for update to authenticated
  using (current_app_role() in ('admin','office') or created_by = auth.uid())
  with check (current_app_role() in ('admin','office') or created_by = auth.uid());

create policy work_logs_delete_admin_office_or_own on work_logs
  for delete to authenticated
  using (current_app_role() in ('admin','office') or created_by = auth.uid());

------------------------------------------------------------------------------
-- 10. assignments: insert/update/delete admin/office/supervisor
------------------------------------------------------------------------------
create policy assignments_insert_staff on assignments
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy assignments_update_staff on assignments
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

create policy assignments_delete_staff on assignments
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

------------------------------------------------------------------------------
-- 11. timesheet_entries: workers manage their own open entries;
--     admin/office/supervisor manage all
------------------------------------------------------------------------------
create policy timesheet_entries_insert_own_or_staff on timesheet_entries
  for insert to authenticated
  with check (user_id = auth.uid() or current_app_role() in ('admin','office','supervisor'));

-- USING gates which rows may be targeted (own row only while still open);
-- WITH CHECK allows the worker to set end_at (clock out) on that row.
create policy timesheet_entries_update_own_open_or_staff on timesheet_entries
  for update to authenticated
  using ((user_id = auth.uid() and end_at is null) or current_app_role() in ('admin','office','supervisor'))
  with check (user_id = auth.uid() or current_app_role() in ('admin','office','supervisor'));

create policy timesheet_entries_delete_staff on timesheet_entries
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

------------------------------------------------------------------------------
-- 12. diaries: insert any authenticated; update own or staff; delete admin/office
------------------------------------------------------------------------------
create policy diaries_insert_authenticated on diaries
  for insert to authenticated
  with check (auth.uid() is not null);

create policy diaries_update_own_or_staff on diaries
  for update to authenticated
  using (created_by = auth.uid() or current_app_role() in ('admin','office','supervisor'))
  with check (created_by = auth.uid() or current_app_role() in ('admin','office','supervisor'));

create policy diaries_delete_admin_office on diaries
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 13. diary_labour & diary_plant: insert any authenticated;
--     update/delete by staff or the owner of the parent diary
------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['diary_labour','diary_plant'] loop
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (auth.uid() is not null)
    $f$, t || '_insert_authenticated', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (current_app_role() in ('admin','office','supervisor')
               or exists (select 1 from diaries d where d.id = diary_id and d.created_by = auth.uid()))
        with check (current_app_role() in ('admin','office','supervisor')
               or exists (select 1 from diaries d where d.id = diary_id and d.created_by = auth.uid()))
    $f$, t || '_update_staff_or_diary_owner', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (current_app_role() in ('admin','office','supervisor')
               or exists (select 1 from diaries d where d.id = diary_id and d.created_by = auth.uid()))
    $f$, t || '_delete_staff_or_diary_owner', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 14. swms_instances: insert/update admin/office/supervisor; delete admin/office
------------------------------------------------------------------------------
create policy swms_instances_insert_staff on swms_instances
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy swms_instances_update_staff on swms_instances
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

create policy swms_instances_delete_admin_office on swms_instances
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 15. swms_signatures: insert own signature only; no update; delete admin/office
------------------------------------------------------------------------------
create policy swms_signatures_insert_own on swms_signatures
  for insert to authenticated
  with check (user_id = auth.uid());

create policy swms_signatures_delete_admin_office on swms_signatures
  for delete to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 16. attachments: insert own; update admin/office; delete admin/office or own
------------------------------------------------------------------------------
create policy attachments_insert_own on attachments
  for insert to authenticated
  with check (created_by = auth.uid());

create policy attachments_update_admin_office on attachments
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

create policy attachments_delete_admin_office_or_own on attachments
  for delete to authenticated
  using (current_app_role() in ('admin','office') or created_by = auth.uid());

------------------------------------------------------------------------------
-- 17. sequences: RLS enabled, zero policies. All client access denied;
--     numbering happens exclusively through next_number() (security definer).
------------------------------------------------------------------------------
