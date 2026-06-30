-- 0013_documents.sql
-- Generalise the WHS-only document library into a COMPANY-WIDE controlled
-- document register (ISO 9001 §7.5): rename whs_documents → documents, broaden
-- its category/system taxonomy, add a formal approval lifecycle
-- (draft → in_review → approved → issued → superseded/archived) with reviewer/
-- approver capture, and a read-acknowledgement register on issued documents.
--
-- Existing rows are preserved (and their attachments): the rename keeps every
-- whs_documents row, status 'current' migrates to 'issued', system defaults to
-- 'ohs'. file_path/filename become nullable so a draft may exist before its
-- file is uploaded (the app guards issuing without a file).
--
-- Conventions follow 0010_whs.sql / 0012_whs_documents.sql:
-- current_app_role() for RLS, audit_whs() row trigger ({table}_audit).

------------------------------------------------------------------------------
-- 1. Rename the table (preserves rows + attachments) and its indexes
------------------------------------------------------------------------------

-- Guarded so a re-run (after the rename already happened) is a no-op.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'whs_documents')
     and not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'documents') then
    alter table whs_documents rename to documents;
  end if;
end $$;

-- Rename indexes for clarity (no-ops if a prior run already renamed them).
alter index if exists whs_documents_supersedes_idx  rename to documents_supersedes_idx;
alter index if exists whs_documents_status_idx       rename to documents_status_idx;
alter index if exists whs_documents_uploaded_by_idx  rename to documents_uploaded_by_idx;

-- A table rename does NOT rename its constraints. PostgREST resource embedding
-- targets a constraint by name (profiles!documents_uploaded_by_fkey), so rename
-- the carried-over FK + self-FK constraints to the documents_* convention.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'whs_documents_uploaded_by_fkey') then
    alter table documents rename constraint whs_documents_uploaded_by_fkey to documents_uploaded_by_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'whs_documents_supersedes_id_fkey') then
    alter table documents rename constraint whs_documents_supersedes_id_fkey to documents_supersedes_id_fkey;
  end if;
end $$;

------------------------------------------------------------------------------
-- 2. Broaden the taxonomy: category + new ISO management system dimension
------------------------------------------------------------------------------

-- Category: add work_instruction, plan-family stays, add external. The check
-- constraint name is auto-generated on the original table; drop by discovery.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'documents'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%category%';
  if c is not null then
    execute format('alter table documents drop constraint %I', c);
  end if;
end $$;

alter table documents
  add constraint documents_category_check
  check (category in (
    'policy','procedure','work_instruction','form',
    'register','plan','sds','external','other'
  ));

-- System: which ISO management system the document belongs to. Existing WHS
-- documents are occupational health & safety.
alter table documents
  add column if not exists system text not null default 'ohs'
    check (system in ('qms','ems','ohs','integrated'));

------------------------------------------------------------------------------
-- 3. Approval lifecycle
------------------------------------------------------------------------------

-- Migrate the legacy status vocabulary first, then swap the check constraint.
update documents set status = 'issued' where status = 'current';

do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'documents'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table documents drop constraint %I', c);
  end if;
end $$;

alter table documents alter column status set default 'draft';
alter table documents
  add constraint documents_status_check
  check (status in ('draft','in_review','approved','issued','superseded','archived'));

-- Lifecycle actor/timestamp capture.
alter table documents
  add column if not exists reviewed_by  uuid references profiles(id),
  add column if not exists reviewed_at  timestamptz,
  add column if not exists approved_by  uuid references profiles(id),
  add column if not exists approved_at  timestamptz,
  add column if not exists issued_at    timestamptz;

-- Migrated 'issued' rows were already in force: stamp issued_at from created_at.
update documents set issued_at = created_at where status = 'issued' and issued_at is null;

------------------------------------------------------------------------------
-- 4. A draft may have no file yet — relax the NOT NULLs (app guards issue)
------------------------------------------------------------------------------

alter table documents alter column file_path drop not null;
alter table documents alter column filename  drop not null;

------------------------------------------------------------------------------
-- 5. RLS — recreate policies on the renamed table (rename carries them, but be
--    idempotent: drop + recreate so a re-run lands in a known state).
------------------------------------------------------------------------------

alter table documents enable row level security;

drop policy if exists whs_documents_read   on documents;
drop policy if exists whs_documents_write  on documents;
drop policy if exists whs_documents_update on documents;
drop policy if exists whs_documents_delete on documents;
drop policy if exists documents_read   on documents;
drop policy if exists documents_write  on documents;
drop policy if exists documents_update on documents;
drop policy if exists documents_delete on documents;

create policy documents_read on documents
  for select to authenticated using (auth.uid() is not null);
create policy documents_write on documents
  for insert to authenticated with check (current_app_role() in ('admin','office'));
create policy documents_update on documents
  for update to authenticated using (current_app_role() in ('admin','office'));
create policy documents_delete on documents
  for delete to authenticated using (current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 6. Audit trigger — rename onto the new table name
------------------------------------------------------------------------------

drop trigger if exists whs_documents_audit on documents;
drop trigger if exists documents_audit     on documents;
create trigger documents_audit after insert or update or delete on documents
  for each row execute function audit_whs();

------------------------------------------------------------------------------
-- 7. Read-acknowledgement register (ISO 9001 §7.5.3 controlled distribution)
------------------------------------------------------------------------------
-- One row per (document, user, version): a user acknowledges they have read the
-- current issued version. A new version resets everyone's outstanding state.

create table if not exists document_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version int not null,
  user_id uuid references profiles(id),
  name text not null,
  acknowledged_at timestamptz not null default now(),
  unique (document_id, user_id, version)
);
create index if not exists document_acknowledgements_document_idx
  on document_acknowledgements (document_id);
create index if not exists document_acknowledgements_user_idx
  on document_acknowledgements (user_id);

alter table document_acknowledgements enable row level security;

drop policy if exists document_acknowledgements_read   on document_acknowledgements;
drop policy if exists document_acknowledgements_insert on document_acknowledgements;
drop policy if exists document_acknowledgements_delete on document_acknowledgements;

create policy document_acknowledgements_read on document_acknowledgements
  for select to authenticated using (auth.uid() is not null);
-- A user may only record their OWN acknowledgement (no update — immutable).
create policy document_acknowledgements_insert on document_acknowledgements
  for insert to authenticated with check (user_id = auth.uid());
create policy document_acknowledgements_delete on document_acknowledgements
  for delete to authenticated using (current_app_role() = 'admin');

drop trigger if exists document_acknowledgements_audit on document_acknowledgements;
create trigger document_acknowledgements_audit
  after insert or update or delete on document_acknowledgements
  for each row execute function audit_whs();
