# Progress claims bill the sell value, not the cost budget

**Date:** 2026-10-22 · **Status:** built on `feat/claims-sell-values` · **Migration:** 0075

## Problem

Quote → project conversion seeds `budget_lines.budget_amount` at **cost** (qty × unit cost) so the
Budget tab compares committed and actual spend against a cost budget. The progress-claims register
snapshotted that same figure as each line's "Contract value". On RP26020 the lines totalled
$221,593.10 against a $305,114.08 contract sum: claiming every line to 100% could only ever bill the
cost, and the claim PDF would have shown the client ECR's cost on every item. `projects.contract_sum`
(the sell total) was only used for the retention cap.

## Decision (owner, 2026-10-22)

Budget stays on cost. Claims move to sell. Keep it simple: one new column, no separate schedule-of-values
table, no per-claim retention switch (retention is held on the deposit claim like any other claim; a
"no retention on this claim" switch is a follow-up only if a client contract demands it).

## Design

- **Schema.** `budget_lines.sell_amount numeric(14,2) not null default 0`. Backfill: every line starts
  at `budget_amount`; lines on quote-converted projects take qty × unit_sell from the quote line with the
  same description *and* cost (unique for all 75 live lines; ambiguous or unmatched lines keep the
  budget figure). No claim had been submitted, so no locked snapshot is affected.
- **Conversion.** `projectPayloadFromQuote` emits `sell_amount = round2(qty × unit_sell)` per budget
  line. `budget_amount` logic is unchanged (cost, with the sell-only fallback).
- **Claims.** `buildSnapshotLines` reads `sell_amount` as the claim line value. Variations already used
  their sell amount. Retention, GST, previous/this-claim maths untouched.
- **Budget tab.** New editable **Sell** column (per line, group subtotal, grand total). Add-line dialog
  gets a Sell field; blank defaults to the budget amount so manually built budgets stay claimable.
- **Deposit helper.** Draft claims get a **Set all lines** button: one % applied to every line via the
  new `bulkPct()` rule in the claims engine (clamped to [previously-claimed floor, 100], so nothing is
  credited back silently). 20 = a 20% deposit; later claims net it off through "Previous" as before.
- **Not changed.** Claim PDF, portal, Xero push, reports (they read claim snapshots and totals).

## Rollout

1. Owner pastes `supabase/migrations/0075_budget_line_sell_amount.sql` into the Supabase SQL editor.
2. Merge to main, Vercel deploys.
3. On PC-1 (RP26020): **Refresh lines** pulls the sell values, then **Set all lines → 20**.
   Expected gross $61,022.82 (20% of $305,114.08), retention $6,102.28.
4. Manual projects (P-0012, P-0013): check the Sell column equals what the client is billed per line.
