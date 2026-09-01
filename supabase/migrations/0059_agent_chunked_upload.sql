-- 0059: chunked upload for the agent API.
-- storage_upload caps at 3 MB because Vercel limits a serverless request body to
-- ~4.5 MB and base64 inflates ~33%, so a remote agent could not file real ECR
-- documents (the MBBC survey alone is 12 MB). These tables back a
-- begin/part/finish flow that reassembles server-side.
-- Design: docs/superpowers/specs/2026-09-01-agent-chunked-upload-design.md

-- Staging bucket for in-flight parts. Deliberately its OWN bucket:
-- backup_storage_manifest() mirrors only attachments/branding, so transient
-- parts never enter the backup set. It is also kept out of STORAGE_BUCKETS in
-- src/lib/agent-api.ts, so the ordinary storage actions cannot touch it.
insert into storage.buckets (id, name, public)
values ('agent-uploads', 'agent-uploads', false)
on conflict (id) do nothing;

create table public.agent_uploads (
  id uuid primary key default gen_random_uuid(),
  key_id uuid references public.agent_keys(id) on delete set null,
  bucket text not null,
  path text not null,
  content_type text,
  upsert boolean not null default false,
  -- Optional filing target: set these and finish() also writes the attachments
  -- row, which is what makes the file show up in a job's Documents.
  parent_type text,
  parent_id uuid,
  kind text,
  caption text,
  client_visible boolean not null default false,
  status text not null default 'open' check (status in ('open','completed','aborted')),
  bytes_received bigint not null default 0,
  final_bytes bigint,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index agent_uploads_status_idx on public.agent_uploads (status, expires_at);

-- One row per received part. The (upload_id, part_number) primary key is what
-- makes a duplicated or missing part detectable at finish() instead of silently
-- producing a corrupt file.
create table public.agent_upload_parts (
  upload_id uuid not null references public.agent_uploads(id) on delete cascade,
  part_number integer not null check (part_number >= 1),
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  primary key (upload_id, part_number)
);

alter table public.agent_uploads enable row level security;
alter table public.agent_upload_parts enable row level security;
create policy agent_uploads_admin_read on public.agent_uploads
  for select to authenticated using (current_app_role() = 'admin');
create policy agent_upload_parts_admin_read on public.agent_upload_parts
  for select to authenticated using (current_app_role() = 'admin');
