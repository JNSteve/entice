-- 0055_regulated_waste_links.sql
-- Parts 2 and 3 of the waste transport certificate, captured from the parties
-- who actually hold the information: the transporter (vehicles, collection) and
-- the receiver (weighbridge amount, disposal or treatment code).
--
-- Reuses the share_links + token + security-definer-anon-RPC pattern already
-- driving /sign, /submit and /portal. Two ROLE-SCOPED tokens per movement, so
-- neither party can edit the other's part or see more than the docket they are
-- holding. Both QR codes print on the consignment docket.
--
-- Locked decisions implemented here:
--   * LOCK ON SUBMIT, OFFICE CAN REOPEN. The submit RPCs refuse a second
--     submission; the part is stamped with the time and the declared
--     submitter's name. Reopening is a staff action and lands in audit_log. A
--     docket left on a weighbridge desk must not silently rewrite the record.
--   * CONFIRMATIONS FLAG, THEY NEVER OVERWRITE. A transporter correcting their
--     EA number or depot address writes to the movement snapshot and raises a
--     review flag; vendors is untouched. Master data behind a statutory record
--     must not be editable by anyone holding a printed docket. This still
--     solves the cold start, where a carrier with no EA number on file would
--     otherwise block every load.
--   * THE QR IS NEVER THE ONLY PATH. Office can key both parts in from the
--     register (part2_source / part3_source record which route was used).
--     Weighbridges lose signal.
--   * Links are created ONLY through issue_waste_movement_links() — field
--     staff create the movement at the gate but hold no insert rights on
--     share_links, exactly as subbie_swms rows are created only through their
--     own security-definer function.

------------------------------------------------------------------------------
-- 1. share_links carries a movement target and two new kinds
------------------------------------------------------------------------------

alter table share_links
  add column movement_id uuid references regulated_waste_movements(id) on delete cascade;

create index share_links_movement_idx on share_links (movement_id);

-- kind check: read-current-values-then-append (0032 / 0052 pattern).
do $$
declare
  vals text[];
  want text[] := array['waste_transporter', 'waste_receiver'];
  v text;
  changed boolean := false;
begin
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) into vals
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conname = 'share_links_kind_check'
    and c.conrelid = 'public.share_links'::regclass;

  if coalesce(array_length(vals, 1), 0) = 0 then
    raise exception 'share_links_kind_check not found — refusing to guess the value list';
  end if;

  foreach v in array want loop
    if not (vals @> array[v]) then
      vals := array_append(vals, v);
      changed := true;
    end if;
  end loop;

  if changed then
    execute 'alter table public.share_links drop constraint share_links_kind_check';
    execute format(
      'alter table public.share_links add constraint share_links_kind_check check (kind = any (array[%s]::text[]))',
      (select string_agg(quote_literal(v2), ', ') from unnest(vals) v2)
    );
  end if;
end $$;

-- The table-level "a link must point at something" check is anonymous in 0010.
-- Find it by its body (it is the only one naming swms_instance_id), drop it,
-- and restate it with the movement kinds included.
do $$
declare cname text;
begin
  select c.conname into cname
  from pg_constraint c
  where c.conrelid = 'public.share_links'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%swms_instance_id%'
    and pg_get_constraintdef(c.oid) like '%subbie_swms%';

  if cname is null then
    raise exception 'share_links target check not found — refusing to guess it';
  end if;

  execute format('alter table public.share_links drop constraint %I', cname);
end $$;

alter table share_links add constraint share_links_target_check check (
  (kind = 'signon' and (swms_instance_id is not null or form_submission_id is not null))
  or (kind = 'subbie_swms' and project_id is not null)
  or (kind in ('waste_transporter', 'waste_receiver') and movement_id is not null)
);

------------------------------------------------------------------------------
-- 2. issue_waste_movement_links — staff and field, idempotent
------------------------------------------------------------------------------

create or replace function issue_waste_movement_links(
  p_movement_id uuid,
  p_expires_days int default 90
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_app_role();
  v_created_by uuid;
  v_seq bigint;
  v_expires timestamptz;
  v_tok_t text;
  v_tok_r text;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'Not signed in');
  end if;
  -- coalesce throughout: `null not in (...)` is null, and `if null` is false,
  -- so an unguarded NOT IN would let a null role or value pass validation.
  if coalesce(v_role, '') not in ('admin', 'office', 'supervisor', 'field') then
    return jsonb_build_object('error', 'Not permitted');
  end if;

  select created_by, load_seq into v_created_by, v_seq
  from regulated_waste_movements where id = p_movement_id;
  if not found then
    return jsonb_build_object('error', 'Movement not found');
  end if;
  -- Field may only issue links for loads they recorded themselves.
  if v_role = 'field' and v_created_by is distinct from auth.uid() then
    return jsonb_build_object('error', 'Not permitted');
  end if;

  v_expires := now() + make_interval(days => greatest(1, least(365, p_expires_days)));

  -- Two UUIDs' worth of randomness (256 bits), hex — the 0035 token pattern.
  select token into v_tok_t from share_links
   where movement_id = p_movement_id and kind = 'waste_transporter';
  if v_tok_t is null then
    v_tok_t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into share_links (token, kind, movement_id, label, expires_at, created_by)
    values (v_tok_t, 'waste_transporter', p_movement_id,
            'Waste load ' || v_seq || ' — transporter', v_expires, auth.uid());
  end if;

  select token into v_tok_r from share_links
   where movement_id = p_movement_id and kind = 'waste_receiver';
  if v_tok_r is null then
    v_tok_r := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into share_links (token, kind, movement_id, label, expires_at, created_by)
    values (v_tok_r, 'waste_receiver', p_movement_id,
            'Waste load ' || v_seq || ' — receiver', v_expires, auth.uid());
  end if;

  return jsonb_build_object('transporter_token', v_tok_t, 'receiver_token', v_tok_r);
end $$;

revoke execute on function issue_waste_movement_links(uuid, int) from anon, public;
grant execute on function issue_waste_movement_links(uuid, int) to authenticated;

------------------------------------------------------------------------------
-- 3. waste_link_view — anon read-through; the token IS the credential
------------------------------------------------------------------------------

-- Returns only what the party holding the docket is entitled to see for this
-- one movement. Never the other party's contact details, never another load.
create or replace function waste_link_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l share_links%rowtype;
  m regulated_waste_movements%rowtype;
begin
  select * into l from share_links
   where token = p_token and active
     and kind in ('waste_transporter', 'waste_receiver')
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  select * into m from regulated_waste_movements where id = l.movement_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'kind', l.kind,
    'load_seq', m.load_seq,
    'lodged', m.lodged_at is not null,
    'submitted_at', case when l.kind = 'waste_transporter'
                         then m.part2_submitted_at else m.part3_submitted_at end,
    'submitted_by', case when l.kind = 'waste_transporter'
                         then m.part2_submitted_by else m.part3_submitted_by end,
    -- Where it came from and what it is (both parties need this).
    'generator', jsonb_build_object(
      'name', m.generator_name,
      'street_number', m.generator_street_number,
      'street_name', m.generator_street_name,
      'suburb', m.generator_suburb,
      'postcode', m.generator_postcode,
      'collection_date', m.collection_date),
    'waste', jsonb_build_object(
      'code', m.waste_code,
      'physical_nature', m.waste_physical_nature,
      'amount', m.waste_amount,
      'unit', m.waste_unit,
      'description', m.waste_description),
    'dangerous_goods', case when m.dg_un_number is null and m.dg_un_class is null
      then null else jsonb_build_object(
        'un_class', m.dg_un_class, 'un_number', m.dg_un_number,
        'subsidiary_risk', m.dg_subsidiary_risk,
        'packaging_count', m.dg_packaging_count,
        'packaging_type', m.dg_packaging_type,
        'packing_group', m.dg_packing_group) end,
    -- Their own held details, to confirm or correct.
    'transporter', jsonb_build_object(
      'name', m.transporter_name,
      'ea_number', m.transporter_ea_number,
      'street_number', m.transporter_street_number,
      'street_name', m.transporter_street_name,
      'suburb', m.transporter_suburb,
      'postcode', m.transporter_postcode,
      'contact_name', m.transporter_contact_name,
      'contact_number', m.transporter_contact_number,
      'collection_date', m.transporter_collection_date,
      'vehicle1_plate', m.vehicle1_plate, 'vehicle1_type', m.vehicle1_type,
      'vehicle2_plate', m.vehicle2_plate, 'vehicle2_type', m.vehicle2_type,
      'discrepancy', m.transporter_discrepancy),
    'receiver', jsonb_build_object(
      'name', m.receiver_name,
      'ea_number', m.receiver_ea_number,
      'suburb', m.receiver_suburb,
      'received_date', m.received_date,
      'disposal_code', m.disposal_code,
      'physical_nature', m.receiver_physical_nature,
      'waste_code', m.receiver_waste_code,
      'amount', m.receiver_amount,
      'unit', m.receiver_unit,
      'discrepancy', m.receiver_discrepancy)
  );
end $$;

grant execute on function waste_link_view(text) to anon, authenticated;

------------------------------------------------------------------------------
-- 4. Part 2 — the transporter
------------------------------------------------------------------------------

create or replace function waste_link_submit_transporter(
  p_token text,
  p_submitted_by text,
  p_collection_date date,
  p_vehicle1_plate text,
  p_vehicle1_type text,
  p_vehicle2_plate text default null,
  p_vehicle2_type text default null,
  p_discrepancy text default null,
  p_declared_variance jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l share_links%rowtype;
  m regulated_waste_movements%rowtype;
begin
  select * into l from share_links
   where token = p_token and active and kind = 'waste_transporter'
     and (expires_at is null or expires_at > now());
  if not found then
    return jsonb_build_object('error', 'This link has expired or been deactivated');
  end if;

  select * into m from regulated_waste_movements where id = l.movement_id;
  if not found then
    return jsonb_build_object('error', 'Movement not found');
  end if;
  if m.lodged_at is not null then
    return jsonb_build_object('error', 'This load has already been lodged with the department');
  end if;
  if m.part2_submitted_at is not null then
    return jsonb_build_object('error', 'Transport details have already been submitted for this load. Contact the office to reopen it.');
  end if;

  if coalesce(trim(p_submitted_by), '') = '' then
    return jsonb_build_object('error', 'Enter your name');
  end if;
  if p_collection_date is null then
    return jsonb_build_object('error', 'Enter the collection date');
  end if;
  if coalesce(trim(p_vehicle1_plate), '') = '' then
    return jsonb_build_object('error', 'Enter the vehicle 1 number plate');
  end if;
  if coalesce(p_vehicle1_type, '') not in ('V', 'T') then
    return jsonb_build_object('error', 'Vehicle 1 type must be V (vehicle) or T (trailer)');
  end if;
  -- [VERIFY V-5] Vehicle 2 is marked null-not-allowed in the specification, but
  -- a rigid tipper with no trailer has no second vehicle. Optional here; if a
  -- plate is given the type must come with it.
  if coalesce(trim(p_vehicle2_plate), '') <> ''
     and coalesce(p_vehicle2_type, '') not in ('V', 'T') then
    return jsonb_build_object('error', 'Vehicle 2 type must be V (vehicle) or T (trailer)');
  end if;

  update regulated_waste_movements set
    transporter_collection_date = p_collection_date,
    vehicle1_plate = upper(trim(p_vehicle1_plate)),
    vehicle1_type = p_vehicle1_type,
    vehicle2_plate = nullif(upper(trim(coalesce(p_vehicle2_plate, ''))), ''),
    vehicle2_type = case when coalesce(trim(p_vehicle2_plate), '') = ''
                         then null else p_vehicle2_type end,
    transporter_discrepancy = nullif(trim(coalesce(p_discrepancy, '')), ''),
    -- Corrections are recorded against the movement and flagged for the office.
    -- They are NOT written back over the vendor record.
    transporter_declared_variance = p_declared_variance,
    part2_submitted_at = now(),
    part2_submitted_by = trim(p_submitted_by),
    part2_source = 'link'
  where id = m.id;

  return jsonb_build_object('ok', true, 'load_seq', m.load_seq);
end $$;

grant execute on function waste_link_submit_transporter(
  text, text, date, text, text, text, text, text, jsonb) to anon, authenticated;

------------------------------------------------------------------------------
-- 5. Part 3 — the receiver
------------------------------------------------------------------------------

create or replace function waste_link_submit_receiver(
  p_token text,
  p_submitted_by text,
  p_received_date date,
  p_disposal_code text,
  p_physical_nature text,
  p_waste_code text,
  p_amount numeric,
  p_unit text,
  p_discrepancy text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l share_links%rowtype;
  m regulated_waste_movements%rowtype;
begin
  select * into l from share_links
   where token = p_token and active and kind = 'waste_receiver'
     and (expires_at is null or expires_at > now());
  if not found then
    return jsonb_build_object('error', 'This link has expired or been deactivated');
  end if;

  select * into m from regulated_waste_movements where id = l.movement_id;
  if not found then
    return jsonb_build_object('error', 'Movement not found');
  end if;
  if m.lodged_at is not null then
    return jsonb_build_object('error', 'This load has already been lodged with the department');
  end if;
  if m.part3_submitted_at is not null then
    return jsonb_build_object('error', 'Receipt details have already been submitted for this load. Contact the office to reopen it.');
  end if;

  if coalesce(trim(p_submitted_by), '') = '' then
    return jsonb_build_object('error', 'Enter your name');
  end if;
  if p_received_date is null then
    return jsonb_build_object('error', 'Enter the date the waste was received');
  end if;
  -- Shape only: the authoritative code lists live in src/lib/waste/qld-codes.ts
  -- because the specification states they are subject to departmental change.
  if p_disposal_code is null or p_disposal_code !~ '^[DR][0-9]{1,2}[AB]?$' then
    return jsonb_build_object('error', 'Select a disposal or treatment code');
  end if;
  if coalesce(p_physical_nature, '') not in ('L', 'S', 'M', 'P') then
    return jsonb_build_object('error', 'Physical nature must be L, S, M or P');
  end if;
  if p_waste_code is null or p_waste_code !~ '^[A-Z][0-9]{3}$' then
    return jsonb_build_object('error', 'Select the waste code');
  end if;
  if p_amount is null or p_amount < 0 then
    return jsonb_build_object('error', 'Enter the amount received');
  end if;
  if coalesce(p_unit, '') not in ('kg', 'L', 'm3', 'Each', 'IBC') then
    return jsonb_build_object('error', 'Unit must be kg, L, m3, Each or IBC');
  end if;

  update regulated_waste_movements set
    received_date = p_received_date,
    disposal_code = p_disposal_code,
    receiver_physical_nature = p_physical_nature,
    receiver_waste_code = p_waste_code,
    receiver_amount = p_amount,
    receiver_unit = p_unit,
    receiver_discrepancy = nullif(trim(coalesce(p_discrepancy, '')), ''),
    part3_submitted_at = now(),
    part3_submitted_by = trim(p_submitted_by),
    part3_source = 'link'
  where id = m.id;

  return jsonb_build_object('ok', true, 'load_seq', m.load_seq);
end $$;

grant execute on function waste_link_submit_receiver(
  text, text, date, text, text, text, numeric, text, text) to anon, authenticated;

------------------------------------------------------------------------------
-- 6. reopen_waste_part — staff undo, recorded in audit_log by the table trigger
------------------------------------------------------------------------------

create or replace function reopen_waste_part(p_movement_id uuid, p_part text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m regulated_waste_movements%rowtype;
begin
  if coalesce(current_app_role(), '') not in ('admin', 'office', 'supervisor') then
    return jsonb_build_object('error', 'Not permitted');
  end if;
  if coalesce(p_part, '') not in ('transporter', 'receiver') then
    return jsonb_build_object('error', 'Unknown part');
  end if;

  select * into m from regulated_waste_movements where id = p_movement_id;
  if not found then
    return jsonb_build_object('error', 'Movement not found');
  end if;
  if m.lodged_at is not null then
    return jsonb_build_object('error', 'This load is lodged — record a discrepancy instead');
  end if;

  if p_part = 'transporter' then
    update regulated_waste_movements
       set part2_submitted_at = null, part2_submitted_by = null, part2_source = null
     where id = p_movement_id;
  else
    update regulated_waste_movements
       set part3_submitted_at = null, part3_submitted_by = null, part3_source = null
     where id = p_movement_id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function reopen_waste_part(uuid, text) from anon, public;
grant execute on function reopen_waste_part(uuid, text) to authenticated;
