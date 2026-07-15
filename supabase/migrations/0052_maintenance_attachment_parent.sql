-- 0052: allow 'maintenance' attachments.
-- 0051 added the maintenance_entries table and taught the app that photo
-- evidence attaches with parent_type 'maintenance', but the attachments
-- CHECK constraint still rejected the value — every evidence upload failed
-- with "new row for relation 'attachments' violates check constraint". This
-- appends 'maintenance' to the live constraint idempotently (same read-current-
-- values-then-append pattern proven in 0032).
do $$
declare
  vals text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}'::text[]) into vals
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
  where c.conname = 'attachments_parent_type_check'
    and c.conrelid = 'public.attachments'::regclass;

  if coalesce(array_length(vals, 1), 0) = 0 then
    raise exception 'attachments_parent_type_check not found — refusing to guess the value list';
  end if;

  if not (vals @> array['maintenance']) then
    vals := array_append(vals, 'maintenance');
    execute 'alter table public.attachments drop constraint attachments_parent_type_check';
    execute format(
      'alter table public.attachments add constraint attachments_parent_type_check check (parent_type = any (array[%s]::text[]))',
      (select string_agg(quote_literal(v), ', ') from unnest(vals) v)
    );
  end if;
end $$;
