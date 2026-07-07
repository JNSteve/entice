-- 0038_budget_line_attribution.sql
-- Per-line budget attribution: optionally point a PO line, a commitment, or a
-- cost at a specific budget line. NULL => fall back to cost_code_id grouping
-- (existing behaviour). Mirrors the nullable-FK pattern in 0032_itp_lots.sql.
-- Column addition is covered by the existing table-wide RLS policies (0003),
-- so no policy/grant changes are required. Existing rows stay NULL (no backfill).

alter table po_lines
  add column budget_line_id uuid references budget_lines(id) on delete set null;

alter table commitments
  add column budget_line_id uuid references budget_lines(id) on delete set null;

alter table costs
  add column budget_line_id uuid references budget_lines(id) on delete set null;

create index po_lines_budget_line_idx    on po_lines (budget_line_id);
create index commitments_budget_line_idx on commitments (budget_line_id);
create index costs_budget_line_idx       on costs (budget_line_id);
