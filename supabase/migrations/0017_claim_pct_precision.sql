-- 0017_claim_pct_precision.sql
-- Widen claim_lines.pct_complete from numeric(6,2) to numeric(9,6).
--
-- pct_complete is the source of truth for a line's claimed-to-date figure
-- (claimed_to_date = round2(line_value * pct_complete / 100)). At 2 decimal
-- places a dollar amount entered on a large line round-trips to a different
-- dollar amount — e.g. on a $2,000,000 line, $1,499,900 → 75.00% → $1,500,000.
-- Six decimal places let the stored percentage reproduce the entered dollars:
-- $1,499,900 → 74.995000% → round2($1,499,900.00) exactly.
--
-- numeric(9,6): 3 integer digits (max value 100.000000) + 6 fractional digits.
-- This only widens the type — every existing 2dp value fits, so no data loss.
alter table claim_lines
  alter column pct_complete type numeric(9, 6);
