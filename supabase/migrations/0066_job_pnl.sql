-- 0066: job & project P&L.
--   * jobs.contract_price — quote sell subtotal (ex GST) stored at conversion
--   * job_price_adjustments — +/- log on top of the job price
--   * costs gains labour lines (hours × rate, staff or typed worker)
--   * timesheet_entries.cost_rate — profiles.hourly_cost locked at approval

alter table jobs add column contract_price numeric(14,2);

update jobs j
set contract_price = q.subtotal
from (
  select quote_id, round(sum(round(qty * unit_sell, 2)), 2) as subtotal
  from quote_lines
  group by quote_id
) q
where j.quote_id = q.quote_id and j.contract_price is null;

create table job_price_adjustments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  date date not null default current_date,
  description text not null,
  amount numeric(14,2) not null check (amount <> 0),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index job_price_adjustments_job_idx on job_price_adjustments (job_id);
alter table job_price_adjustments enable row level security;
create policy job_price_adjustments_admin_office_all on job_price_adjustments
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

alter table costs
  add column hours numeric(8,2),
  add column rate numeric(10,2),
  add column worker_id uuid references profiles(id),
  add column worker_name text;
alter table costs drop constraint if exists costs_source_check;
alter table costs add constraint costs_source_check
  check (source in ('manual','docket','labour'));
alter table costs add constraint costs_labour_fields_check
  check (source <> 'labour' or (hours > 0 and rate >= 0));
create index if not exists costs_parent_idx on costs (parent_type, parent_id);

alter table timesheet_entries add column cost_rate numeric(10,2);

-- Backfill BEFORE the trigger exists (the trigger would keep the old null).
update timesheet_entries t
set cost_rate = p.hourly_cost
from profiles p
where p.id = t.user_id and t.approved;

create or replace function timesheet_stamp_cost_rate() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.approved and (tg_op = 'INSERT' or not old.approved) then
    new.cost_rate := (select hourly_cost from profiles where id = new.user_id);
  elsif not new.approved then
    new.cost_rate := null;
  elsif current_app_role() is distinct from 'admin'
        and current_app_role() is distinct from 'office' then
    new.cost_rate := old.cost_rate;
  end if;
  return new;
end $$;

create trigger timesheet_entries_cost_rate
  before insert or update on timesheet_entries
  for each row execute function timesheet_stamp_cost_rate();
