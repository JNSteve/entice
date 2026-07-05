-- 0027_go_live_hardening.sql
-- Go-live hardening batch (ISO roadmap §4.11 / §5 Phase-5 essentials):
--
--   1. Daily off-DB backup pipeline — private `backups` storage bucket,
--      `backup_runs` register, and service-role-only helper RPCs used by the
--      /api/cron/backup route (runtime table discovery + storage manifest).
--      ISO 7.5.3.2: records protected from loss.
--   2. In-app error capture — `app_errors` register written ONLY through the
--      anon-callable SECURITY DEFINER `log_app_error()` (crudely rate-limited),
--      read/resolve is admin-only.
--   3. Access review register — `access_reviews` (ACR-xxxx via
--      next_number('access_review')), admin full / office read, audit-trailed.
--
-- Conventions follow 0025/0024/0022: current_app_role() RLS, audit_whs()
-- AFTER triggers, next_number sequences, append-only audit_log.
--
-- Locked decisions implemented here:
--   * The `backups` bucket takes NO user-role write policies — every write
--     (export upload, blob mirror, prune) happens through the service role,
--     which bypasses storage RLS. Admins may read/download only.
--   * `backup_runs` has NO client INSERT/UPDATE/DELETE policies — rows are
--     written exclusively by the backup route under the service role.
--     backup_runs IS the log, so no audit trigger (noise, not evidence).
--   * `app_errors` INSERTs happen only via log_app_error(); the direct INSERT
--     path stays closed to every client role. The rate limiter DROPS silently
--     (returns false) instead of raising — raising inside error handling
--     would cascade failures into the very pages reporting them.
--   * app_errors UPDATE is admin-only and a guard trigger freezes every
--     column except `resolved` — the error record itself is evidence.

------------------------------------------------------------------------------
-- 1. backups bucket (private) + storage policies
------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- Admin download/list only. Deliberately NO insert/update/delete policies:
-- writes happen exclusively via the service role (bypasses RLS).
create policy "backups_select_admin" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and current_app_role() = 'admin');

------------------------------------------------------------------------------
-- 2. backup_runs
------------------------------------------------------------------------------

create table backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','failed')),
  tables_count int,
  rows_total bigint,
  storage_objects_count int,
  storage_bytes_mirrored bigint,
  export_bytes bigint,
  path text,                            -- key inside the backups bucket
  error text,
  trigger text not null check (trigger in ('cron','manual')),
  created_by uuid references profiles(id)
);
create index backup_runs_started_idx on backup_runs (started_at desc);
create index backup_runs_status_idx on backup_runs (status);

alter table backup_runs enable row level security;

create policy backup_runs_select_admin_office on backup_runs
  for select to authenticated
  using (current_app_role() in ('admin','office'));
-- No INSERT/UPDATE/DELETE policies: service-role writes only.

------------------------------------------------------------------------------
-- 3. Service-role helper RPCs for the backup route
--    (PostgREST cannot read information_schema / storage.objects directly)
------------------------------------------------------------------------------

-- Every base table in public, with the column the route should ORDER BY for
-- stable 1000-row pagination (primary key when one exists, first column
-- otherwise). Discovered at runtime so new tables are never missed.
create function backup_list_tables()
returns table(table_name text, order_col text)
language sql stable security definer set search_path = public as $$
  select c.relname::text,
         coalesce(
           (select a.attname::text
              from pg_index i
              join pg_attribute a
                on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
             where i.indrelid = c.oid and i.indisprimary
             limit 1),
           (select a.attname::text
              from pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
             order by a.attnum
             limit 1)
         )
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relname
$$;

revoke execute on function backup_list_tables() from anon, authenticated, public;
grant execute on function backup_list_tables() to service_role;

-- Manifest of every object in the business buckets (attachments + branding):
-- name, size, updated_at. The route embeds this in the export and mirrors
-- new/changed blobs into backups/storage/<bucket>/<name>.
create function backup_storage_manifest()
returns table(bucket text, name text, size bigint, updated_at timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id::text,
         o.name::text,
         coalesce((o.metadata->>'size')::bigint, 0),
         o.updated_at
    from storage.objects o
   where o.bucket_id in ('attachments','branding')
   order by o.bucket_id, o.name
$$;

revoke execute on function backup_storage_manifest() from anon, authenticated, public;
grant execute on function backup_storage_manifest() to service_role;

------------------------------------------------------------------------------
-- 4. app_errors + log_app_error()
------------------------------------------------------------------------------

create table app_errors (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  source text not null check (source in ('server','client')),
  path text,
  message text not null,
  stack text,                           -- trimmed to 4000 chars by log_app_error
  user_role text,
  resolved boolean not null default false
);
create index app_errors_at_idx on app_errors (at desc);
create index app_errors_unresolved_idx on app_errors (at desc) where not resolved;

alter table app_errors enable row level security;

create policy app_errors_select_admin on app_errors
  for select to authenticated
  using (current_app_role() = 'admin');
create policy app_errors_update_admin on app_errors
  for update to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');
-- No INSERT policy for any role — inserts go through log_app_error() only.
-- No DELETE policy — captured errors are records; resolve them instead.

-- Guard: an UPDATE may only flip `resolved`; every other column is frozen.
create function app_errors_update_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - 'resolved') is distinct from (to_jsonb(old) - 'resolved') then
    raise exception 'only the resolved flag may be updated on app_errors';
  end if;
  return new;
end $$;

revoke execute on function app_errors_update_guard() from anon, authenticated, public;

create trigger app_errors_update_guard
  before update on app_errors
  for each row execute function app_errors_update_guard();

-- The only write path. Granted to anon + authenticated so the branded error
-- pages (client) and instrumentation onRequestError (server, anon key) can
-- report. Crude flood control: once 100 rows landed in the last hour, drop
-- silently — the return value says whether the row was stored.
create function log_app_error(
  p_source text,
  p_path text,
  p_message text,
  p_stack text default null,
  p_user_role text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_source is null or p_source not in ('server','client') then
    return false;
  end if;
  if (select count(*) from app_errors where at > now() - interval '1 hour') >= 100 then
    return false;
  end if;
  insert into app_errors (source, path, message, stack, user_role)
  values (
    p_source,
    left(coalesce(p_path, ''), 500),
    left(coalesce(nullif(trim(p_message), ''), '(no message)'), 1000),
    left(p_stack, 4000),
    left(p_user_role, 20)
  );
  return true;
end $$;

grant execute on function log_app_error(text, text, text, text, text)
  to anon, authenticated;

------------------------------------------------------------------------------
-- 5. access_reviews (ACR-xxxx)
------------------------------------------------------------------------------

create table access_reviews (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- ACR-0001 via next_number('access_review')
  reviewed_on date not null,
  reviewer_id uuid references profiles(id),
  findings text not null,
  actions text,
  next_review_due date not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index access_reviews_reviewed_idx on access_reviews (reviewed_on desc);
create index access_reviews_due_idx on access_reviews (next_review_due);

alter table access_reviews enable row level security;

create policy access_reviews_select_admin_office on access_reviews
  for select to authenticated
  using (current_app_role() in ('admin','office'));
create policy access_reviews_insert_admin on access_reviews
  for insert to authenticated
  with check (current_app_role() = 'admin');
create policy access_reviews_update_admin on access_reviews
  for update to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');
create policy access_reviews_delete_admin on access_reviews
  for delete to authenticated
  using (current_app_role() = 'admin');

-- Audit trigger (reuse audit_whs() from 0010_whs.sql — immutable trail).
create trigger access_reviews_audit
  after insert or update or delete on access_reviews
  for each row execute function audit_whs();

-- Sequence: ACR numbering. No seeds — reviews must be real (ACR-0001 is the
-- first genuine review recorded through the UI).
insert into sequences (key, next_value) values ('access_review', 1)
on conflict (key) do nothing;
