-- 0033_cp3_email.sql
-- Client Portal CP3 — email engine, notification preferences and feedback
-- (roadmap docs/superpowers/plans/2026-07-03-client-portal-roadmap.md §CP3).
--
--   * email_log — every attempted outbound email (sent | failed | skipped).
--     The app degrades gracefully: with no RESEND_API_KEY configured the send
--     wrapper still logs the attempt as 'skipped', so the owner can see what
--     WOULD have gone out before turning sending on. Admin SELECT only; the
--     ONLY write path is log_email() below (definer, flood-capped) — it works
--     identically from the cron route, office server actions and the
--     anonymous portal actions (mirrors log_app_error from 0027).
--   * client_links.notifications_enabled — per-link opt-out for the daily
--     client compliance digest (office toggles it on the client Portal card).
--   * portal_feedback — post-completion satisfaction ratings captured in the
--     portal ("How did we do?"), one per link per completed work. Feeds the
--     customer_satisfaction_avg AUTO metric (src/lib/kpi-metrics.ts).
--
-- Security shape is identical to CP1/CP2: NO anon table policies anywhere;
-- anonymous writes go through SECURITY DEFINER functions that validate the
-- token internally (portal_live_link), enforce rate limits and return null
-- for dead tokens.

------------------------------------------------------------------------------
-- 1. email_log
------------------------------------------------------------------------------

create table email_log (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  subject text not null,
  template text not null,               -- template key, e.g. 'office_new_request'
  entity_kind text,                     -- related entity ('portal_request', 'client', …)
  entity_id uuid,
  status text not null check (status in ('sent','failed','skipped')),
  provider_id text,                     -- Resend message id when sent
  error text,
  created_at timestamptz not null default now()
);
create index email_log_created_idx on email_log (created_at desc);
-- Digest idempotency lookup: template + entity + day.
create index email_log_dedup_idx on email_log (template, entity_kind, entity_id, created_at desc);

alter table email_log enable row level security;

create policy email_log_select_admin on email_log
  for select to authenticated
  using (current_app_role() = 'admin');
-- No INSERT/UPDATE/DELETE policies for any client role — rows are written
-- exclusively via log_email() (or the service role in the cron route).
-- email_log IS the log, so no audit trigger (noise, not evidence).

-- The only client-visible write path. Granted to anon + authenticated so the
-- send wrapper can log from every context (anonymous portal actions, office
-- server actions, cron). Crude flood control mirrors log_app_error: once 200
-- rows landed in the last hour, drop silently.
create function log_email(
  p_to text,
  p_subject text,
  p_template text,
  p_status text,
  p_entity_kind text default null,
  p_entity_id uuid default null,
  p_provider_id text default null,
  p_error text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status is null or p_status not in ('sent','failed','skipped') then
    return false;
  end if;
  if (select count(*) from email_log where created_at > now() - interval '1 hour') >= 200 then
    return false;
  end if;
  insert into email_log
    (to_address, subject, template, status, entity_kind, entity_id, provider_id, error)
  values (
    left(coalesce(nullif(trim(p_to), ''), '(none)'), 320),
    left(coalesce(nullif(trim(p_subject), ''), '(no subject)'), 500),
    left(coalesce(nullif(trim(p_template), ''), 'unknown'), 100),
    p_status,
    left(p_entity_kind, 50),
    p_entity_id,
    left(p_provider_id, 100),
    left(p_error, 1000)
  );
  return true;
end $$;

grant execute on function log_email(text, text, text, text, text, uuid, text, text)
  to anon, authenticated;

------------------------------------------------------------------------------
-- 2. client_links.notifications_enabled (daily digest opt-out, per link)
------------------------------------------------------------------------------

alter table client_links
  add column notifications_enabled boolean not null default true;

------------------------------------------------------------------------------
-- 3. portal_feedback
------------------------------------------------------------------------------

create table portal_feedback (
  id uuid primary key default gen_random_uuid(),
  client_link_id uuid not null references client_links(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  -- Exactly one completed work reference.
  job_id uuid references jobs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  check (
    (job_id is not null and project_id is null)
    or (job_id is null and project_id is not null)
  )
);
create index portal_feedback_client_idx on portal_feedback (client_id, created_at desc);
create index portal_feedback_site_idx on portal_feedback (site_id);
create index portal_feedback_created_idx on portal_feedback (created_at);
-- One rating per link per completed work (belt & braces with the fn check).
create unique index portal_feedback_link_job_idx
  on portal_feedback (client_link_id, job_id) where job_id is not null;
create unique index portal_feedback_link_project_idx
  on portal_feedback (client_link_id, project_id) where project_id is not null;

alter table portal_feedback enable row level security;

-- Staff read-only evidence; writes happen exclusively in
-- portal_submit_feedback() — no INSERT/UPDATE/DELETE policy at all.
create policy portal_feedback_select_admin_office on portal_feedback
  for select to authenticated
  using (current_app_role() in ('admin','office'));

-- Audit trail (audit_whs from 0010).
create trigger portal_feedback_audit
  after insert or update or delete on portal_feedback
  for each row execute function audit_whs();

------------------------------------------------------------------------------
-- 4. Anonymous portal fns (security definer; token validated internally)
------------------------------------------------------------------------------

-- Client rates a COMPLETED work on one of their own properties. Rules:
--   * jobs must be completed/invoiced/paid; projects must be closed — the
--     same grouping the portal's works-history timeline uses
--     (workGroupForJob/workGroupForProject in src/lib/portal-experience.ts).
--   * one rating per link per work; 10 submissions per rolling 24h per link.
-- Returns:
--   null                      dead token / work not this client's / not completed
--   {'error':'invalid'}       bad rating or oversized comment
--   {'error':'rate_limited'}  over the daily cap
--   {'error':'already'}       this link already rated this work
--   {'ok':true}               stored
create function portal_submit_feedback(
  p_token text, p_kind text, p_id uuid, p_rating int, p_comment text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_site uuid;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind not in ('job','project') then return null; end if;

  if p_rating is null or p_rating < 1 or p_rating > 5
     or char_length(coalesce(v_comment, '')) > 2000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if p_kind = 'job' then
    select j.site_id into v_site
      from jobs j
      join sites s on s.id = j.site_id and s.client_id = l.client_id
     where j.id = p_id and j.status in ('completed','invoiced','paid');
  else
    select p.site_id into v_site
      from projects p
      join sites s on s.id = p.site_id and s.client_id = l.client_id
     where p.id = p_id and p.status = 'closed';
  end if;
  if v_site is null then return null; end if;

  if (select count(*) from portal_feedback
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  if exists (select 1 from portal_feedback
              where client_link_id = l.id
                and ((p_kind = 'job' and job_id = p_id)
                  or (p_kind = 'project' and project_id = p_id))) then
    return jsonb_build_object('error', 'already');
  end if;

  insert into portal_feedback
    (client_link_id, client_id, site_id, job_id, project_id, rating, comment)
  values (
    l.id, l.client_id, v_site,
    case when p_kind = 'job' then p_id end,
    case when p_kind = 'project' then p_id end,
    p_rating, v_comment
  );

  return jsonb_build_object('ok', true);
end $$;

-- The feedback THIS LINK has already submitted (drives the works-tab card
-- state: rate vs thank-you). Optionally scoped to one property.
create function portal_my_feedback(p_token text, p_site uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'job_id', f.job_id,
      'project_id', f.project_id,
      'rating', f.rating)
      order by f.created_at desc)
    from portal_feedback f
    where f.client_link_id = l.id
      and (p_site is null or f.site_id = p_site)
  ), '[]'::jsonb);
end $$;

-- Property name for notification emails composed from the anonymous portal
-- actions (they cannot read sites directly). Null unless the site belongs to
-- the token's client — same guard as every other portal fn.
create function portal_site_name(p_token text, p_site uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.name
  from portal_live_link(p_token) l
  join sites s on s.id = p_site and s.client_id = l.client_id
  where l.id is not null;
$$;

grant execute on function portal_submit_feedback(text, text, uuid, int, text) to anon, authenticated;
grant execute on function portal_my_feedback(text, uuid) to anon, authenticated;
grant execute on function portal_site_name(text, uuid) to anon, authenticated;
