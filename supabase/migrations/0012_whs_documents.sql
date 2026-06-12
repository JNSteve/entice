-- 0012_whs_documents.sql
-- WHS document library: controlled safety documents (policies, procedures,
-- management plans, SDS, registers, blank forms) with simple version control
-- (supersedes chain), review-due tracking, and the standard WHS audit trail.
--
-- Files live in the private attachments bucket under whs-documents/ and are
-- served via short-lived signed URLs. Conventions follow 0010_whs.sql:
-- current_app_role() for RLS, audit_whs() row trigger ({table}_audit).

create table whs_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other' check (category in ('policy','procedure','plan','sds','register','form','other')),
  doc_number text,
  version text not null default 'Rev A',
  status text not null default 'current' check (status in ('current','superseded','archived')),
  supersedes_id uuid references whs_documents(id),
  file_path text not null,
  filename text not null,
  content_type text, size int,
  review_due date,
  notes text,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index whs_documents_supersedes_idx on whs_documents (supersedes_id);
create index whs_documents_status_idx on whs_documents (status);
create index whs_documents_uploaded_by_idx on whs_documents (uploaded_by);

alter table whs_documents enable row level security;
create policy whs_documents_read on whs_documents for select to authenticated using (auth.uid() is not null);
create policy whs_documents_write on whs_documents for insert to authenticated with check (current_app_role() in ('admin','office'));
create policy whs_documents_update on whs_documents for update to authenticated using (current_app_role() in ('admin','office'));
create policy whs_documents_delete on whs_documents for delete to authenticated using (current_app_role() = 'admin');

create trigger whs_documents_audit after insert or update or delete on whs_documents
  for each row execute function audit_whs();
