-- ECR IMS Rev 1 controls (portal brief 2026-10-07).
--   1. Directors, by the IMS-M-01 defined position on profiles.position.
--   2. Documents: a 'record' category (records are filed, not controlled) with
--      its 6. Records folder, whole-number revisions by default, and a
--      restricted flag — restricted rows and the attachments/restricted/ prefix
--      are visible to the directors only (SMS-R-16 health monitoring, SMS-14).
--   3. ncrs carries the SMS-R-08 register columns; only the Director
--      (Compliance and Technical) closes a corrective action (SMS-05); CAR
--      numbers run per year.
--   4. jobs carry the two facts that decide which records a job needs
--      (src/lib/job-records.ts): licensed removal class and regulated waste.

-- 1 ─────────────────────────────────────────────────────────────────────────
create or replace function is_director()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select position like 'Director (%' from profiles where id = auth.uid()), false)
$$;

create or replace function is_compliance_director()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select position = 'Director (Compliance and Technical)' from profiles where id = auth.uid()), false)
$$;

grant execute on function is_director() to authenticated;
grant execute on function is_compliance_director() to authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────
alter table documents drop constraint documents_category_check;
alter table documents add constraint documents_category_check check (category = any (array[
  'policy','procedure','work_instruction','form','register','plan','sds','external','other','record'
]));

alter table documents add column restricted boolean not null default false;
comment on column documents.restricted is
  'Directors only (profiles.position Director (...)). Store the file under attachments/restricted/.';

-- Records are filed, not revised: the folder they sit in under 6. Records.
alter table documents add column record_folder text;

-- IMS revisions are whole numbers from 0 (SMS-02 Rev 2); lettered revisions are not used.
alter table documents alter column version set default 'Rev 0';

drop policy documents_read on documents;
create policy documents_read on documents for select to authenticated
  using (auth.uid() is not null and (not restricted or is_director()));

drop policy attachments_select_scoped on storage.objects;
create policy attachments_select_scoped on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments' and (
      (storage.foldername(name))[1] = 'restricted' and public.is_director()
      -- coalesce: a root-level object has no folder, and NULL <> 'restricted' would hide it
      or coalesce((storage.foldername(name))[1], '') <> 'restricted' and (
        public.current_app_role() = any (array['admin','office'])
        or (storage.foldername(name))[1] = any (array[
          'job','project','diary','incident','form_submission','ncr','swms','whs-documents',
          'lot','waste_load','env_permit','regulated_waste_movement'
        ])
      )
    )
  );

-- 3 ─────────────────────────────────────────────────────────────────────────
alter table ncrs
  add column classification text,
  add column source_detail text,
  add column assigned_to_text text,
  add column due_date date,
  add column implemented text;

comment on column ncrs.classification is 'SMS-R-08: Major / Minor / OFI';
comment on column ncrs.source_detail is 'SMS-R-08 source as written (audit, finding, evaluation)';
comment on column ncrs.assigned_to_text is 'SMS-R-08 assigned to (person and position)';
comment on column ncrs.implemented is 'SMS-R-08 implemented (date and what was done)';

create or replace function ncrs_close_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for the service role (agent API, backups): not a person closing.
  if new.status = 'closed'
     and (tg_op = 'INSERT' or old.status is distinct from 'closed')
     and auth.uid() is not null
     and not is_compliance_director() then
    raise exception 'Only the Director (Compliance and Technical) closes a corrective action (SMS-05)';
  end if;
  return new;
end $$;

create trigger ncrs_close_guard before insert or update on ncrs
  for each row execute function ncrs_close_guard();

-- CAR numbers run per calendar year (CAR-2026-01 …). CAR-2026-01 to 10 and
-- IMP-2026-01 come across from SMS-R-08, so the 2026 sequence resumes at 11.
insert into sequences (key, next_value)
select 'car:2026', 11
where not exists (select 1 from sequences where key = 'car:2026');

-- 4 ─────────────────────────────────────────────────────────────────────────
alter table jobs
  add column licensed_removal text not null default 'none'
    check (licensed_removal in ('none','class_a','class_b')),
  add column regulated_waste boolean not null default false;

insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20261007090000', '0071_documents_first_issued', array['alter table documents add column first_issued date']),
  ('20261007100000', '0072_ims_rev1_controls', array['see supabase/migrations/0072_ims_rev1_controls.sql'])
on conflict (version) do nothing;
