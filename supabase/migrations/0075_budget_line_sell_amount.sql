-- 0075: budget_lines.sell_amount — the contract (sell) value of each budget line.
--
-- Why: quote→project conversion seeds budget_lines.budget_amount at COST
-- (qty × unit_cost) so the Budget tab tracks spend against a cost budget. The
-- progress-claims register was snapshotting that same figure as each line's
-- "Contract value", so a project could only ever claim its cost, and the
-- claim PDF printed cost prices for the client. Claims now read sell_amount.
--
-- Backfill:
--   1. Every line starts with sell_amount = budget_amount (manually built
--      budgets are typically entered at the contract value already).
--   2. Lines on quote-converted projects take qty × unit_sell from the quote
--      line with the same description AND cost — unique per line on every live
--      project; a line that matches none or several quote lines keeps step 1.
-- Draft claims pick the new values up via "Refresh lines". No submitted claim
-- existed at the time of writing, so no locked snapshot is affected.

alter table budget_lines
  add column if not exists sell_amount numeric(14,2) not null default 0;

update budget_lines set sell_amount = budget_amount;

with candidates as (
  select
    b.id as budget_line_id,
    round(q.qty * q.unit_sell, 2) as sell,
    count(*) over (partition by b.id) as matches
  from budget_lines b
  join projects p on p.id = b.project_id and p.quote_id is not null
  join quote_lines q
    on q.quote_id = p.quote_id
   and q.description = b.description
   and round(q.qty * q.unit_cost, 2) = b.budget_amount
)
update budget_lines b
   set sell_amount = c.sell
  from candidates c
 where c.budget_line_id = b.id
   and c.matches = 1;

comment on column budget_lines.budget_amount is
  'Cost budget (qty × unit_cost at conversion). Committed and actual spend is tracked against this.';
comment on column budget_lines.sell_amount is
  'Contract (sell) value of the line. Progress claims bill against this; Σ sell_amount should equal the project contract sum.';

insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20261022090000', '0075_budget_line_sell_amount', array['see supabase/migrations/0075_budget_line_sell_amount.sql'])
on conflict (version) do nothing;
