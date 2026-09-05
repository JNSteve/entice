# Xero Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect ECR to Xero over OAuth 2.0 so invoices and certified claims are sent through Xero, paid/void state and Xero-raised invoices flow back nightly, contacts are linked, every job gets a Xero tracking option, the portal shows a pay-now link, and every push/pull is logged in a register.

**Architecture:** A `src/lib/xero/` module owns everything Xero: config + scopes, AES-256-GCM token storage, a small fetch client with refresh-once / 429-once behaviour, pure mappers (ECR ↔ Xero), push (invoice/claim), pull (sync), reference cache, contacts, tracking, and a register. Two route handlers do the OAuth dance. Server actions and the existing cron call into the module. All Xero DB access uses `createAdminClient()` (service role) after the usual `requireRole` guard; the connection row has no RLS policies so no user session can read tokens.

**Tech Stack:** Next.js 16 App Router (`'use server'` actions, `after()`, async `params`/`searchParams`), Supabase (Postgres, RLS, service role), Node `crypto` (AES-256-GCM, timingSafeEqual), zod, vitest, Tailwind + Base UI shadcn components, lucide-react, sonner.

**Spec:** `docs/superpowers/specs/2026-09-05-xero-integration-design.md` — §3 (data boundary) and §12 (VERIFY register) are binding.

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md). Next 16: `params`/`searchParams` are Promises; `after()` comes from `next/server`; JSX drops the space after `{expr}` on the same line — use template literals.
- **Scopes are exactly** `offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings` (spec §3). A unit test pins the string. Never add a scope.
- **Never request or store**: bills (`ACCPAY`), bank data, payroll, reports, journals, contact addresses/phones/bank details/emails. Contacts cache holds `contact_id, name, abn, has_email` only.
- **ECR creates in Xero, then only reads.** The only Xero mutations are: create contact, create invoice (AUTHORISED), email invoice, create tracking option, archive a tracking option ECR created.
- Tokens: encrypted with AES-256-GCM using `XERO_TOKEN_KEY` (base64, 32 bytes) from env; never logged, never returned to a client component, never in a response body. OAuth callback answers with a **302**, never a body containing `code`/`state`.
- Env vars: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_TOKEN_KEY`; redirect URI = `${NEXT_PUBLIC_APP_URL}/api/xero/callback`. Read inline as `process.env.X` (the project has no env module).
- Migration `0063_xero.sql` is committed but **applied by the owner** pasting into the Supabase SQL editor with `insert into supabase_migrations.schema_migrations (version, name) values ('20260905090000', '0063_xero');` appended in the paste (not in the file). Do not deploy before it is applied.
- Live DB is production. Any test row must be named `zz…` and deleted afterwards. Never touch Xero with a real org during the build — Demo Company only.
- Verification before every commit: `npx tsc --noEmit`, `npm run lint`, `npx vitest run --maxWorkers=1`. Page changes need an HTTP load; buttons/dialogs need a click-level check.
- Dev server needs `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-tls-npm-workaround'` (memory) or server-side Supabase calls fail. Never run two dev servers on one `.next`.
- Any raw `<input>/<select>/<textarea>` needs `text-base md:text-sm`.
- Money in the portal stays behind `client_links.show_financials`. The only new portal field is `pay_url`.
- Line kinds reuse `RATE_KINDS` from `src/lib/zod.ts`: `'labour' | 'plant' | 'material' | 'subbie' | 'other'` (the spec's draft list is superseded by this).
- Commit messages: imperative, prefixed `feat:`/`fix:`/`docs:`/`refactor:`/`test:`, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0063_xero.sql` | Schema: connection singleton, link columns, caches, settings mapping, register, `portal_billing` + `pay_url` |
| `src/lib/xero-csv.ts` + `tests/xero-csv.test.ts` | The existing CSV export, moved (frees `src/lib/xero/`) |
| `src/lib/xero/config.ts` | Scope string, Xero URLs, env readers, redirect URI |
| `src/lib/xero/crypto.ts` | `encryptSecret` / `decryptSecret` (AES-256-GCM) |
| `src/lib/xero/oauth-state.ts` | CSRF `state` generation + cookie hash + timing-safe verify |
| `src/lib/xero/types.ts` | Xero API response shapes + `XeroMapping` |
| `src/lib/xero/map.ts` | Pure mappers: dates, ABN, contact match, invoice/claim payloads, status derivation, reference parsing |
| `src/lib/xero/client.ts` | `createXeroApi(deps)` (testable) + `xeroApiForAdmin(admin)`; 401 refresh-once, 429 wait-once, validation error parsing |
| `src/lib/xero/tokens.ts` | Exchange code, refresh, load/store connection, `needs_reconnect` + office email |
| `src/lib/xero/register.ts` | `startRun` / `logEvent` / `finishRun` |
| `src/lib/xero/reference.ts` | Accounts, tax rates, tracking categories → cache tables |
| `src/lib/xero/contacts.ts` | Contacts cache + ABN/name auto-link + `ensureContactForClient` |
| `src/lib/xero/tracking.ts` | `ensureTrackingOption` for a job/project; archive stale options |
| `src/lib/xero/push.ts` | `pushInvoiceToXero`, `pushClaimToXero` (idempotent, no status flip) |
| `src/lib/xero/pull.ts` | `runXeroSync` — token warm-up, reference, contacts, invoices, payments, tracking hygiene |
| `src/lib/xero/status.ts` | `getXeroStatus()` — safe summary for pages (never throws, never exposes tokens) |
| `src/lib/job-status.ts` | `syncJobStatus` extracted from `invoices/actions.ts` so push/pull can share it |
| `src/app/api/xero/connect/route.ts` | Admin-only → 302 to Xero consent |
| `src/app/api/xero/callback/route.ts` | Verifies state, exchanges code, stores connection, 302 to Settings |
| `src/app/(office)/settings/xero-actions.ts` | Mapping save, link contact, Sync now, disconnect, confirm org switch, retry claim push |
| `src/app/(office)/settings/xero-section.tsx` | Settings → Xero tab UI |
| `src/app/(office)/settings/settings-tabs.tsx`, `page.tsx` | Register the tab + load its data |
| `src/app/(office)/invoices/actions.ts` | `markInvoiceSent` pushes when connected; payment/void guards; `linkInvoiceToJob` |
| `src/app/(office)/invoices/[id]/page.tsx`, `invoice-editor.tsx` | Xero panel, "Send via Xero", managed-in-Xero note, line `kind` select |
| `src/app/(office)/projects/[id]/claims/actions.ts`, `[claimId]/page.tsx`, `claim-editor.tsx` | Certify pushes; Xero status line |
| `src/app/(office)/money/page.tsx`, `xero-export-button.tsx`, `match-job-dialog.tsx` | Xero column, Needs matching filter, Sync now, CSV hidden when connected |
| `src/app/(office)/jobs/[id]/page.tsx`, `invoice-section.tsx` | "from Xero" tag |
| `src/app/(office)/dashboard-cards.tsx`, `src/app/(office)/page.tsx` | System health rows for Xero |
| `src/app/portal/[token]/portal-ui.tsx`, `sites/[siteId]/page.tsx` | Pay now button |
| `src/app/api/cron/notify/route.ts` | Runs the nightly sync |
| `src/lib/email.ts` | `office_xero_reconnect` template |
| `src/lib/zod.ts` | `kind` on `invoiceLineUpdateSchema`, `xeroMappingSchema` |
| `supabase/seed/rls-check.mjs` | Probes: connection unreadable, register/caches admin+office only |
| `.env.example` | Document the three Xero vars |

---

### Task 1: Migration 0063 — schema, RLS, portal billing pay link

**Files:**
- Create: `supabase/migrations/0063_xero.sql`

**Interfaces:**
- Produces: tables `xero_connection`, `xero_accounts`, `xero_tax_rates`, `xero_tracking_categories`, `xero_tracking_options`, `xero_contacts`, `xero_sync_runs`, `xero_sync_events`; columns listed below; `portal_billing` rows gain `pay_url`.

- [ ] **Step 1: Write the migration**

```sql
-- 0063: Xero integration (two-way invoicing over OAuth 2.0).
--   * xero_connection — singleton, encrypted tokens, NO RLS policies (service role only).
--   * invoices/claims/payments/clients/jobs/projects — Xero link columns.
--   * invoice_lines.kind — drives the income-account mapping (RATE_KINDS values).
--   * Reference caches (accounts, tax rates, tracking, contacts) — admin/office read.
--   * settings.xero_* — account/tax/tracking mapping + email mode.
--   * xero_sync_runs / xero_sync_events — the register (admin/office read, never pruned).
--   * portal_billing — adds pay_url (Xero online invoice) for invoices.
-- Design: docs/superpowers/specs/2026-09-05-xero-integration-design.md

------------------------------------------------------------------------------
-- 1. Connection singleton — service role only
------------------------------------------------------------------------------
create table xero_connection (
  id int primary key default 1 check (id = 1),
  tenant_id text,
  tenant_name text,
  connection_id text,
  access_token_enc text,            -- AES-256-GCM "iv.ct.tag" (base64url parts)
  refresh_token_enc text,
  access_expires_at timestamptz,
  scopes text,
  status text not null default 'disconnected'
    check (status in ('connected','needs_reconnect','disconnected')),
  connected_by uuid references profiles(id),
  connected_at timestamptz,
  last_refresh_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  updated_at timestamptz not null default now()
);
insert into xero_connection (id) values (1);
alter table xero_connection enable row level security;
-- Intentionally NO policies: tokens are secrets. Only the service role reads/writes.

------------------------------------------------------------------------------
-- 2. Link columns
------------------------------------------------------------------------------
alter table invoices
  add column origin text not null default 'ecr' check (origin in ('ecr','xero')),
  add column xero_invoice_id text unique,
  add column xero_number text,
  add column xero_status text,
  add column xero_total numeric(14,2),
  add column xero_amount_paid numeric(14,2),
  add column xero_amount_credited numeric(14,2),
  add column xero_amount_due numeric(14,2),
  add column xero_online_url text,
  add column xero_pushed_at timestamptz,
  add column xero_emailed_at timestamptz,
  add column xero_synced_at timestamptz,
  add column needs_review boolean not null default false;

alter table invoice_lines
  add column kind text check (kind in ('labour','plant','material','subbie','other'));

alter table claims
  add column xero_invoice_id text unique,
  add column xero_status text,
  add column xero_amount_due numeric(14,2),
  add column xero_online_url text,
  add column xero_pushed_at timestamptz,
  add column xero_synced_at timestamptz;

alter table payments
  add column xero_payment_id text unique,
  add column source text not null default 'ecr' check (source in ('ecr','xero'));

alter table clients  add column xero_contact_id text unique;
alter table jobs     add column xero_tracking_option_id text;
alter table projects add column xero_tracking_option_id text;

------------------------------------------------------------------------------
-- 3. Reference caches — admin/office read, service-role writes
------------------------------------------------------------------------------
create table xero_accounts (
  code text primary key,
  name text not null,
  type text not null,
  tax_type text,
  status text,
  synced_at timestamptz not null default now()
);
create table xero_tax_rates (
  tax_type text primary key,
  name text not null,
  effective_rate numeric(6,3),
  status text,
  synced_at timestamptz not null default now()
);
create table xero_tracking_categories (
  id text primary key,
  name text not null,
  status text,
  synced_at timestamptz not null default now()
);
create table xero_tracking_options (
  id text primary key,
  category_id text not null references xero_tracking_categories(id) on delete cascade,
  name text not null,
  status text,
  synced_at timestamptz not null default now()
);
-- Spec §3: contacts cache holds ONLY id, name, ABN and whether an email exists.
create table xero_contacts (
  contact_id text primary key,
  name text not null,
  abn text,
  has_email boolean not null default false,
  status text,
  synced_at timestamptz not null default now()
);

alter table xero_accounts            enable row level security;
alter table xero_tax_rates           enable row level security;
alter table xero_tracking_categories enable row level security;
alter table xero_tracking_options    enable row level security;
alter table xero_contacts            enable row level security;

create policy xero_accounts_select on xero_accounts
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_tax_rates_select on xero_tax_rates
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_tracking_categories_select on xero_tracking_categories
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_tracking_options_select on xero_tracking_options
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_contacts_select on xero_contacts
  for select to authenticated using (current_app_role() in ('admin','office'));
-- No write policies: the sync writes with the service role.

------------------------------------------------------------------------------
-- 4. Settings mapping
------------------------------------------------------------------------------
alter table settings
  add column xero_email_mode text not null default 'xero'
    check (xero_email_mode in ('xero','ecr')),
  add column xero_default_account text,
  add column xero_account_by_kind jsonb not null default '{}'::jsonb,
  add column xero_claims_account text,
  add column xero_gst_tax_type text not null default 'OUTPUT',
  add column xero_no_gst_tax_type text not null default 'EXEMPTOUTPUT',
  add column xero_tracking_category_id text;

------------------------------------------------------------------------------
-- 5. Register — admin/office read, service-role writes, never pruned
------------------------------------------------------------------------------
create table xero_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','partial','failed')),
  trigger text not null check (trigger in ('cron','manual','push')),
  invoices_pulled int not null default 0,
  invoices_created int not null default 0,
  payments_upserted int not null default 0,
  contacts_linked int not null default 0,
  pushed int not null default 0,
  warnings int not null default 0,
  errors int not null default 0,
  error text,
  created_by uuid references profiles(id)
);
create index xero_sync_runs_started_idx on xero_sync_runs (started_at desc);

create table xero_sync_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references xero_sync_runs(id) on delete cascade,
  direction text not null check (direction in ('push','pull')),
  entity text not null
    check (entity in ('invoice','claim','payment','contact','tracking','reference','connection')),
  entity_id uuid,
  xero_id text,
  action text not null
    check (action in ('created','updated','voided','matched','unmatched','archived','skipped','warning','failed')),
  detail text,
  created_at timestamptz not null default now()
);
create index xero_sync_events_run_idx on xero_sync_events (run_id, created_at);
create index xero_sync_events_entity_idx on xero_sync_events (entity, entity_id);

alter table xero_sync_runs   enable row level security;
alter table xero_sync_events enable row level security;
create policy xero_sync_runs_select on xero_sync_runs
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_sync_events_select on xero_sync_events
  for select to authenticated using (current_app_role() in ('admin','office'));
-- No INSERT/UPDATE/DELETE policies for any role.

------------------------------------------------------------------------------
-- 6. portal_billing — 0044 definition + pay_url (invoices only)
------------------------------------------------------------------------------
create or replace function portal_billing(p_token text, p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or not l.show_financials then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(row_j order by row_j->>'date' desc, row_j->>'number')
    from (
      select jsonb_build_object(
        'kind', 'invoice',
        'id', i.id,
        'number', i.number,
        'context', j.number || ' — ' || j.title,
        'date', i.issue_date,
        'amount', (select round(coalesce(sum(round(il.qty * il.unit_sell, 2)), 0)
                          * (1 + i.gst_rate / 100), 2)
                     from invoice_lines il where il.invoice_id = i.id),
        'status', i.status,
        'pay_url', case when i.status = 'sent' then i.xero_online_url else null end) as row_j
      from invoices i
      join jobs j on j.id = i.job_id and j.site_id = p_site
      where i.client_id = l.client_id
        and i.status in ('sent','paid')

      union all

      select jsonb_build_object(
        'kind', 'claim',
        'id', c.id,
        'number', p.number || ' · Claim ' || c.number::text,
        'context', p.number || ' — ' || p.name,
        'date', c.reference_date,
        'amount', c.total_inc_gst,
        'status', c.status,
        'pay_url', null) as row_j
      from claims c
      join projects p on p.id = c.project_id
        and p.site_id = p_site and p.client_id = l.client_id
      where c.status in ('submitted','certified','paid')
    ) rows
  ), '[]'::jsonb);
end $$;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run (Git Bash): `node -e "const s=require('fs').readFileSync('supabase/migrations/0063_xero.sql','utf8');console.log((s.match(/create table/g)||[]).length,'tables;',(s.match(/create policy/g)||[]).length,'policies')"`
Expected: `8 tables; 7 policies`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0063_xero.sql
git commit -m "feat(xero): migration 0063 — connection, link columns, caches, mapping, register, portal pay link

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Move the CSV export to `src/lib/xero-csv.ts`

**Files:**
- Move: `src/lib/xero.ts` → `src/lib/xero-csv.ts`
- Move: `tests/xero.test.ts` → `tests/xero-csv.test.ts`
- Modify: `src/app/(office)/money/xero-export-button.tsx:17`

- [ ] **Step 1: Move the files with git**

```bash
git mv src/lib/xero.ts src/lib/xero-csv.ts
git mv tests/xero.test.ts tests/xero-csv.test.ts
```

- [ ] **Step 2: Fix the imports**

In `tests/xero-csv.test.ts` line 2 change `'../src/lib/xero'` to `'../src/lib/xero-csv'`.
In `src/app/(office)/money/xero-export-button.tsx` line 17 change `'@/lib/xero'` to `'@/lib/xero-csv'`.

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/xero-csv.test.ts --maxWorkers=1 && npx tsc --noEmit`
Expected: 9 tests pass; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/xero-csv.ts tests/xero-csv.test.ts "src/app/(office)/money/xero-export-button.tsx"
git commit -m "refactor: move the Xero CSV export to xero-csv.ts ahead of the live integration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `config.ts` — scopes, URLs, env, redirect URI

**Files:**
- Create: `src/lib/xero/config.ts`
- Test: `tests/xero-config.test.ts`

**Interfaces:**
- Produces: `XERO_SCOPES: string`, `XERO_AUTHORIZE_URL`, `XERO_TOKEN_URL`, `XERO_CONNECTIONS_URL`, `XERO_API_BASE`, `xeroEnv(): { clientId, clientSecret, tokenKey } | null`, `xeroRedirectUri(): string`, `xeroConfigured(): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/xero-config.test.ts
import { afterEach, describe, expect, test } from 'vitest'
import {
  XERO_API_BASE,
  XERO_AUTHORIZE_URL,
  XERO_SCOPES,
  XERO_TOKEN_URL,
  xeroConfigured,
  xeroEnv,
  xeroRedirectUri,
} from '../src/lib/xero/config'

const saved = { ...process.env }
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

describe('xero config', () => {
  test('scope string is exactly the five approved scopes (spec §3)', () => {
    expect(XERO_SCOPES).toBe(
      'offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings'
    )
    expect(XERO_SCOPES).not.toMatch(/payroll|bank|reports|journals|attachments|transactions/)
  })

  test('endpoints are the Xero identity + accounting hosts', () => {
    expect(XERO_AUTHORIZE_URL).toBe('https://login.xero.com/identity/connect/authorize')
    expect(XERO_TOKEN_URL).toBe('https://identity.xero.com/connect/token')
    expect(XERO_API_BASE).toBe('https://api.xero.com/api.xro/2.0')
  })

  test('redirect URI is derived from NEXT_PUBLIC_APP_URL without a double slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://entice-pink.vercel.app/'
    expect(xeroRedirectUri()).toBe('https://entice-pink.vercel.app/api/xero/callback')
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(xeroRedirectUri()).toBe('http://localhost:3000/api/xero/callback')
  })

  test('xeroEnv is null unless all three vars are present', () => {
    delete process.env.XERO_CLIENT_ID
    process.env.XERO_CLIENT_SECRET = 's'
    process.env.XERO_TOKEN_KEY = 'k'
    expect(xeroEnv()).toBeNull()
    expect(xeroConfigured()).toBe(false)
    process.env.XERO_CLIENT_ID = 'id'
    expect(xeroEnv()).toEqual({ clientId: 'id', clientSecret: 's', tokenKey: 'k' })
    expect(xeroConfigured()).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/xero-config.test.ts`
Expected: FAIL — cannot resolve `../src/lib/xero/config`.

- [ ] **Step 3: Implement**

```ts
// src/lib/xero/config.ts
/**
 * Xero integration — constants and environment.
 *
 * THE SCOPE STRING IS A CONTRACT (spec §3). Sales invoices, payments,
 * contacts and settings (accounts / tax rates / tracking) only. No payroll,
 * bank, reports, journals or attachments — ever. tests/xero-config.test.ts
 * pins it.
 */

export const XERO_SCOPES =
  'offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings'

export const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize'
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

export type XeroEnv = { clientId: string; clientSecret: string; tokenKey: string }

/** All three secrets, or null when any is missing (integration unavailable). */
export function xeroEnv(): XeroEnv | null {
  const clientId = process.env.XERO_CLIENT_ID?.trim()
  const clientSecret = process.env.XERO_CLIENT_SECRET?.trim()
  const tokenKey = process.env.XERO_TOKEN_KEY?.trim()
  if (!clientId || !clientSecret || !tokenKey) return null
  return { clientId, clientSecret, tokenKey }
}

export function xeroConfigured(): boolean {
  return xeroEnv() !== null
}

/** Must match a redirect URI registered on the Xero app, character for character. */
export function xeroRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  )
  return `${base}/api/xero/callback`
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/xero-config.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/xero/config.ts tests/xero-config.test.ts
git commit -m "feat(xero): config — pinned scope string, endpoints, env and redirect URI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 4: `crypto.ts` — AES-256-GCM token encryption

**Files:**
- Create: `src/lib/xero/crypto.ts`
- Test: `tests/xero-crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plain: string, keyB64: string): string` → `"iv.ct.tag"` (base64url parts); `decryptSecret(blob: string, keyB64: string): string` (throws on tamper / wrong key / bad key length); `newTokenKey(): string` (32 random bytes, base64 — used once to mint `XERO_TOKEN_KEY`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/xero-crypto.test.ts
import { describe, expect, test } from 'vitest'
import { decryptSecret, encryptSecret, newTokenKey } from '../src/lib/xero/crypto'

describe('xero token crypto', () => {
  const key = newTokenKey()

  test('newTokenKey is 32 bytes of base64', () => {
    expect(Buffer.from(key, 'base64')).toHaveLength(32)
  })

  test('round trip', () => {
    const blob = encryptSecret('refresh-token-abc', key)
    expect(blob.split('.')).toHaveLength(3)
    expect(blob).not.toContain('refresh-token-abc')
    expect(decryptSecret(blob, key)).toBe('refresh-token-abc')
  })

  test('two encryptions of the same value differ (random IV)', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key))
  })

  test('tampered ciphertext is rejected', () => {
    const [iv, ct, tag] = encryptSecret('secret', key).split('.')
    const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)
    expect(() => decryptSecret(`${iv}.${flipped}.${tag}`, key)).toThrow()
  })

  test('wrong key is rejected', () => {
    const blob = encryptSecret('secret', key)
    expect(() => decryptSecret(blob, newTokenKey())).toThrow()
  })

  test('a key that is not 32 bytes is rejected up front', () => {
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow(
      /32 bytes/
    )
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/xero-crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/xero/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Refresh/access tokens at rest (xero_connection) are AES-256-GCM encrypted
 * with XERO_TOKEN_KEY — a 32-byte key that lives ONLY in the Vercel env
 * (Xero security standard: symmetric encryption, key separate from code).
 * Blob format: base64url(iv).base64url(ciphertext).base64url(tag).
 */

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

function keyBuffer(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) {
    throw new Error('XERO_TOKEN_KEY must decode to exactly 32 bytes')
  }
  return key
}

/** Mint a new key: paste the output into Vercel as XERO_TOKEN_KEY. */
export function newTokenKey(): string {
  return randomBytes(32).toString('base64')
}

export function encryptSecret(plain: string, keyB64: string): string {
  const key = keyBuffer(keyB64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, ct, tag].map((b) => b.toString('base64url')).join('.')
}

export function decryptSecret(blob: string, keyB64: string): string {
  const key = keyBuffer(keyB64)
  const parts = blob.split('.')
  if (parts.length !== 3) throw new Error('Malformed encrypted secret')
  const [iv, ct, tag] = parts.map((p) => Buffer.from(p, 'base64url'))
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/xero-crypto.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/xero/crypto.ts tests/xero-crypto.test.ts
git commit -m "feat(xero): AES-256-GCM token encryption with env-held key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `oauth-state.ts` — CSRF state for the connect flow

**Files:**
- Create: `src/lib/xero/oauth-state.ts`
- Test: `tests/xero-oauth-state.test.ts`

**Interfaces:**
- Produces: `newOAuthState(): string`, `hashOAuthState(state: string): string` (sha256 hex — what the cookie stores), `oauthStateMatches(state: string | null, cookieHash: string | undefined): boolean` (timing-safe), `XERO_STATE_COOKIE = 'xero_oauth_state'`, `XERO_STATE_TTL_SECONDS = 600`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/xero-oauth-state.test.ts
import { describe, expect, test } from 'vitest'
import {
  XERO_STATE_COOKIE,
  XERO_STATE_TTL_SECONDS,
  hashOAuthState,
  newOAuthState,
  oauthStateMatches,
} from '../src/lib/xero/oauth-state'

describe('xero oauth state', () => {
  test('state is url-safe and long enough', () => {
    const s = newOAuthState()
    expect(s).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(newOAuthState()).not.toBe(s)
  })

  test('hash verifies only the original state', () => {
    const s = newOAuthState()
    const h = hashOAuthState(s)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(oauthStateMatches(s, h)).toBe(true)
    expect(oauthStateMatches(newOAuthState(), h)).toBe(false)
    expect(oauthStateMatches(null, h)).toBe(false)
    expect(oauthStateMatches(s, undefined)).toBe(false)
    expect(oauthStateMatches(s, 'zz')).toBe(false)
  })

  test('cookie constants', () => {
    expect(XERO_STATE_COOKIE).toBe('xero_oauth_state')
    expect(XERO_STATE_TTL_SECONDS).toBe(600)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/xero-oauth-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/xero/oauth-state.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * OAuth `state` for /api/xero/connect → /api/xero/callback. The connect route
 * sets an httpOnly cookie holding sha256(state) (never the state itself) and
 * sends the plaintext state to Xero; the callback compares timing-safely.
 */
export const XERO_STATE_COOKIE = 'xero_oauth_state'
export const XERO_STATE_TTL_SECONDS = 600

export function newOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}

export function oauthStateMatches(
  state: string | null,
  cookieHash: string | undefined
): boolean {
  if (!state || !cookieHash) return false
  const a = Buffer.from(hashOAuthState(state), 'utf8')
  const b = Buffer.from(cookieHash, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/xero-oauth-state.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/xero/oauth-state.ts tests/xero-oauth-state.test.ts
git commit -m "feat(xero): hashed, timing-safe OAuth state helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: `types.ts` + `map.ts` — pure mappers (ECR ↔ Xero)

**Files:**
- Create: `src/lib/xero/types.ts`
- Create: `src/lib/xero/map.ts`
- Test: `tests/xero-map.test.ts`

**Interfaces:**
- Produces (types): `XeroInvoice`, `XeroLineItem`, `XeroPayment`, `XeroContact`, `XeroAccount`, `XeroTaxRate`, `XeroTrackingCategory`, `XeroTrackingOption`, `XeroMapping`, `EcrInvoiceForPush`, `EcrClaimForPush`.
- Produces (fns): `parseXeroDate(v): string | null` (ISO date `YYYY-MM-DD`), `parseXeroInstant(v): string | null` (ISO timestamp), `normaliseAbn(v): string | null`, `matchContactToClient(contact, clients): string | null`, `buildInvoicePayload(inv, mapping, contactId, tracking): XeroInvoicePayload`, `buildClaimPayload(claim, mapping, contactId, tracking): XeroInvoicePayload`, `claimInvoiceNumber(projectNumber, claimNumber): string`, `deriveInvoiceStatusFromXero(x): { status: 'sent'|'paid'|'void'; paid_at: string|null }`, `totalsDiffer(ecr, xero): boolean`, `workNumberFromReference(ref): string | null`, `ifModifiedSinceHeader(iso): string`, `xeroLinesToInvoiceLines(items): { description, qty, unit, unit_sell, position }[]`, `xeroErrorMessage(body): string`.

- [ ] **Step 1: Write the types**

```ts
// src/lib/xero/types.ts
/** Xero Accounting API shapes — ONLY the fields spec §3 allows us to read. */

export type XeroTracking = {
  TrackingCategoryID?: string
  TrackingOptionID?: string
  Name?: string
  Option?: string
}

export type XeroLineItem = {
  Description?: string
  Quantity?: number
  UnitAmount?: number
  AccountCode?: string
  TaxType?: string
  LineAmount?: number
  Tracking?: XeroTracking[]
}

export type XeroInvoice = {
  InvoiceID: string
  InvoiceNumber?: string
  Reference?: string
  Type: 'ACCREC' | 'ACCPAY'
  Status: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'PAID' | 'VOIDED' | 'DELETED'
  /** ISO local date "2026-09-05T00:00:00" — preferred over the /Date()/ form. */
  DateString?: string
  DueDateString?: string
  Date?: string
  DueDate?: string
  LineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax'
  Total?: number
  AmountDue?: number
  AmountPaid?: number
  AmountCredited?: number
  /** /Date(ms+0000)/ */
  FullyPaidOnDate?: string
  UpdatedDateUTC?: string
  Contact?: { ContactID: string; Name?: string }
  LineItems?: XeroLineItem[]
}

export type XeroPayment = {
  PaymentID: string
  Date?: string
  Amount?: number
  Reference?: string
  Status?: 'AUTHORISED' | 'DELETED'
  PaymentType?: string
  IsReconciled?: boolean
  UpdatedDateUTC?: string
  Invoice?: { InvoiceID: string; InvoiceNumber?: string }
}

export type XeroContact = {
  ContactID: string
  Name: string
  TaxNumber?: string
  EmailAddress?: string
  ContactStatus?: 'ACTIVE' | 'ARCHIVED' | 'GDPRREQUEST'
  UpdatedDateUTC?: string
}

export type XeroAccount = {
  AccountID: string
  Code?: string
  Name: string
  Type: string
  TaxType?: string
  Status?: 'ACTIVE' | 'ARCHIVED'
}

export type XeroTaxRate = {
  Name: string
  TaxType: string
  EffectiveRate?: number
  Status?: 'ACTIVE' | 'DELETED' | 'ARCHIVED'
  CanApplyToRevenue?: boolean
}

export type XeroTrackingOption = {
  TrackingOptionID: string
  Name: string
  Status?: 'ACTIVE' | 'ARCHIVED' | 'DELETED'
}

export type XeroTrackingCategory = {
  TrackingCategoryID: string
  Name: string
  Status?: 'ACTIVE' | 'ARCHIVED'
  Options?: XeroTrackingOption[]
}

/** settings.xero_* as read by the push/pull code. */
export type XeroMapping = {
  emailMode: 'xero' | 'ecr'
  defaultAccount: string | null
  accountByKind: Record<string, string>
  claimsAccount: string | null
  gstTaxType: string
  noGstTaxType: string
  trackingCategoryId: string | null
}

/** What buildInvoicePayload needs from ECR. */
export type EcrInvoiceForPush = {
  number: string
  issue_date: string
  due_date: string | null
  gst_rate: number
  payment_terms_days: number
  job_number: string | null
  job_title: string | null
  lines: { description: string; qty: number; unit_sell: number; kind: string | null }[]
}

export type EcrClaimForPush = {
  project_number: string
  project_name: string
  claim_number: number
  certified_amount: number
  reference_date: string
  payment_terms_days: number
}

export type XeroInvoicePayload = {
  Type: 'ACCREC'
  Contact: { ContactID: string }
  Date: string
  DueDate: string
  InvoiceNumber: string
  Reference: string
  Status: 'AUTHORISED'
  LineAmountTypes: 'Exclusive' | 'Inclusive'
  LineItems: {
    Description: string
    Quantity: number
    UnitAmount: number
    AccountCode: string
    TaxType: string
    Tracking?: { TrackingCategoryID: string; TrackingOptionID: string }[]
  }[]
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/xero-map.test.ts
import { describe, expect, test } from 'vitest'
import {
  buildClaimPayload,
  buildInvoicePayload,
  claimInvoiceNumber,
  deriveInvoiceStatusFromXero,
  ifModifiedSinceHeader,
  matchContactToClient,
  normaliseAbn,
  parseXeroDate,
  parseXeroInstant,
  totalsDiffer,
  workNumberFromReference,
  xeroErrorMessage,
  xeroLinesToInvoiceLines,
} from '../src/lib/xero/map'
import type { XeroMapping } from '../src/lib/xero/types'

const mapping: XeroMapping = {
  emailMode: 'xero',
  defaultAccount: '200',
  accountByKind: { labour: '210', subbie: '220' },
  claimsAccount: '230',
  gstTaxType: 'OUTPUT',
  noGstTaxType: 'EXEMPTOUTPUT',
  trackingCategoryId: 'cat-1',
}

describe('dates', () => {
  test('parseXeroDate accepts DateString, ISO and /Date()/ forms', () => {
    expect(parseXeroDate('2026-09-05T00:00:00')).toBe('2026-09-05')
    expect(parseXeroDate('2026-09-05')).toBe('2026-09-05')
    // 1757030400000 ms = 2025-09-05T00:00:00Z
    expect(parseXeroDate('/Date(1757030400000+0000)/')).toBe('2025-09-05')
    expect(parseXeroDate(undefined)).toBeNull()
    expect(parseXeroDate('garbage')).toBeNull()
  })

  test('parseXeroInstant returns an ISO timestamp', () => {
    expect(parseXeroInstant('/Date(1757030400000+0000)/')).toBe('2025-09-05T00:00:00.000Z')
    expect(parseXeroInstant('2026-09-05T01:02:03.000Z')).toBe('2026-09-05T01:02:03.000Z')
    expect(parseXeroInstant(undefined)).toBeNull()
  })

  test('ifModifiedSinceHeader is UTC seconds precision without the Z', () => {
    expect(ifModifiedSinceHeader('2026-09-05T01:02:03.456Z')).toBe('2026-09-05T01:02:03')
  })
})

describe('contacts', () => {
  test('normaliseAbn keeps digits only, null when empty or not 11 digits', () => {
    expect(normaliseAbn('51 824 753 556')).toBe('51824753556')
    expect(normaliseAbn('ABN 51824753556')).toBe('51824753556')
    expect(normaliseAbn('')).toBeNull()
    expect(normaliseAbn(null)).toBeNull()
    expect(normaliseAbn('123')).toBeNull()
  })

  test('matchContactToClient prefers ABN, then exact case-insensitive name, else null', () => {
    const clients = [
      { id: 'a', name: 'Mermaid Beach Bowls Club', abn: '51 824 753 556' },
      { id: 'b', name: 'Damon Constructions', abn: null },
      { id: 'c', name: 'Damon Constructions Pty Ltd', abn: null },
    ]
    expect(
      matchContactToClient({ ContactID: 'x', Name: 'MBBC', TaxNumber: '51824753556' }, clients)
    ).toBe('a')
    expect(
      matchContactToClient({ ContactID: 'x', Name: '  damon constructions ' }, clients)
    ).toBe('b')
    expect(matchContactToClient({ ContactID: 'x', Name: 'Nobody' }, clients)).toBeNull()
    // Duplicate names are ambiguous → null (never guess).
    expect(
      matchContactToClient({ ContactID: 'x', Name: 'Dup' }, [
        { id: 'd1', name: 'Dup', abn: null },
        { id: 'd2', name: 'dup', abn: null },
      ])
    ).toBeNull()
  })
})

describe('invoice payload', () => {
  const inv = {
    number: 'INV-0007',
    issue_date: '2026-09-05',
    due_date: null,
    gst_rate: 10,
    payment_terms_days: 14,
    job_number: 'RJ26003',
    job_title: 'Cavity clean',
    lines: [
      { description: 'Labour', qty: 2, unit_sell: 150, kind: 'labour' },
      { description: '', qty: 1, unit_sell: 80.5, kind: null },
    ],
  }

  test('maps header, lines, accounts, tax and tracking', () => {
    const p = buildInvoicePayload(inv, mapping, 'contact-1', {
      categoryId: 'cat-1',
      optionId: 'opt-1',
    })
    expect(p.Type).toBe('ACCREC')
    expect(p.Status).toBe('AUTHORISED')
    expect(p.LineAmountTypes).toBe('Exclusive')
    expect(p.Contact).toEqual({ ContactID: 'contact-1' })
    expect(p.InvoiceNumber).toBe('INV-0007')
    expect(p.Reference).toBe('RJ26003 Cavity clean')
    expect(p.Date).toBe('2026-09-05')
    expect(p.DueDate).toBe('2026-09-19') // issue + payment terms when due_date null
    expect(p.LineItems).toEqual([
      {
        Description: 'Labour',
        Quantity: 2,
        UnitAmount: 150,
        AccountCode: '210',
        TaxType: 'OUTPUT',
        Tracking: [{ TrackingCategoryID: 'cat-1', TrackingOptionID: 'opt-1' }],
      },
      {
        Description: '(no description)',
        Quantity: 1,
        UnitAmount: 80.5,
        AccountCode: '200',
        TaxType: 'OUTPUT',
        Tracking: [{ TrackingCategoryID: 'cat-1', TrackingOptionID: 'opt-1' }],
      },
    ])
  })

  test('uses the explicit due date, the no-GST tax type at 0%, and omits tracking when absent', () => {
    const p = buildInvoicePayload(
      { ...inv, due_date: '2026-10-01', gst_rate: 0, job_number: null, job_title: null },
      mapping,
      'c',
      null
    )
    expect(p.DueDate).toBe('2026-10-01')
    expect(p.Reference).toBe('')
    expect(p.LineItems[0].TaxType).toBe('EXEMPTOUTPUT')
    expect(p.LineItems[0].Tracking).toBeUndefined()
  })

  test('truncates the reference to 255 characters', () => {
    const p = buildInvoicePayload(
      { ...inv, job_title: 'x'.repeat(300) },
      mapping,
      'c',
      null
    )
    expect(p.Reference.length).toBe(255)
  })

  test('throws when no account can be resolved', () => {
    expect(() =>
      buildInvoicePayload(inv, { ...mapping, defaultAccount: null }, 'c', null)
    ).toThrow(/income account/)
  })
})

describe('claim payload', () => {
  test('one inclusive line at the certified amount on the claims account', () => {
    const p = buildClaimPayload(
      {
        project_number: 'P-0014',
        project_name: 'Thirroul',
        claim_number: 3,
        certified_amount: 11000,
        reference_date: '2026-08-31',
        payment_terms_days: 30,
      },
      mapping,
      'contact-9',
      { categoryId: 'cat-1', optionId: 'opt-p' }
    )
    expect(p.LineAmountTypes).toBe('Inclusive')
    expect(p.InvoiceNumber).toBe('PC-P-0014-3')
    expect(p.Reference).toBe('P-0014')
    expect(p.Date).toBe('2026-08-31')
    expect(p.DueDate).toBe('2026-09-30')
    expect(p.LineItems).toHaveLength(1)
    expect(p.LineItems[0]).toMatchObject({
      Description: 'Progress claim PC-3 — P-0014 Thirroul',
      Quantity: 1,
      UnitAmount: 11000,
      AccountCode: '230',
      TaxType: 'OUTPUT',
    })
    expect(claimInvoiceNumber('P-0014', 3)).toBe('PC-P-0014-3')
  })

  test('throws when the claims account is unset', () => {
    expect(() =>
      buildClaimPayload(
        {
          project_number: 'P-1',
          project_name: 'x',
          claim_number: 1,
          certified_amount: 1,
          reference_date: '2026-01-01',
          payment_terms_days: 30,
        },
        { ...mapping, claimsAccount: null },
        'c',
        null
      )
    ).toThrow(/claims account/)
  })
})

describe('status derivation (spec §7)', () => {
  test('AUTHORISED with amount due → sent', () => {
    expect(deriveInvoiceStatusFromXero({ Status: 'AUTHORISED', AmountDue: 10 })).toEqual({
      status: 'sent',
      paid_at: null,
    })
  })
  test('AUTHORISED fully credited → paid at the updated date', () => {
    expect(
      deriveInvoiceStatusFromXero({
        Status: 'AUTHORISED',
        AmountDue: 0,
        UpdatedDateUTC: '/Date(1757030400000+0000)/',
      })
    ).toEqual({ status: 'paid', paid_at: '2025-09-05T00:00:00.000Z' })
  })
  test('PAID → paid on FullyPaidOnDate', () => {
    expect(
      deriveInvoiceStatusFromXero({
        Status: 'PAID',
        AmountDue: 0,
        FullyPaidOnDate: '/Date(1757030400000+0000)/',
      })
    ).toEqual({ status: 'paid', paid_at: '2025-09-05T00:00:00.000Z' })
  })
  test('VOIDED → void', () => {
    expect(deriveInvoiceStatusFromXero({ Status: 'VOIDED' })).toEqual({
      status: 'void',
      paid_at: null,
    })
  })
})

describe('misc', () => {
  test('totalsDiffer tolerates 2 cents', () => {
    expect(totalsDiffer(100, 100.02)).toBe(false)
    expect(totalsDiffer(100, 100.03)).toBe(true)
    expect(totalsDiffer(100, undefined)).toBe(false)
  })

  test('workNumberFromReference finds RJ / legacy J- / P- numbers', () => {
    expect(workNumberFromReference('RJ26003 Cavity clean')).toBe('RJ26003')
    expect(workNumberFromReference('re job j-0007')).toBe('J-0007')
    expect(workNumberFromReference('P-0014 claim 2')).toBe('P-0014')
    expect(workNumberFromReference('nothing here')).toBeNull()
    expect(workNumberFromReference(undefined)).toBeNull()
  })

  test('xeroLinesToInvoiceLines copies description/qty/unit price with positions', () => {
    expect(
      xeroLinesToInvoiceLines([
        { Description: 'A', Quantity: 2, UnitAmount: 5 },
        { Description: undefined, Quantity: undefined, UnitAmount: undefined },
      ])
    ).toEqual([
      { description: 'A', qty: 2, unit: 'ea', unit_sell: 5, position: 0 },
      { description: '(no description)', qty: 1, unit: 'ea', unit_sell: 0, position: 1 },
    ])
  })

  test('xeroErrorMessage digs out validation messages', () => {
    expect(
      xeroErrorMessage({
        Elements: [{ ValidationErrors: [{ Message: 'Invoice # must be unique.' }] }],
      })
    ).toBe('Invoice # must be unique.')
    expect(xeroErrorMessage({ Detail: 'TokenExpired' })).toBe('TokenExpired')
    expect(xeroErrorMessage({ Title: 'Forbidden' })).toBe('Forbidden')
    expect(xeroErrorMessage(null)).toBe('Xero request failed')
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/xero-map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/xero/map.ts
import { addDays, format, parseISO } from 'date-fns'
import type {
  EcrClaimForPush,
  EcrInvoiceForPush,
  XeroContact,
  XeroInvoice,
  XeroInvoicePayload,
  XeroLineItem,
  XeroMapping,
} from './types'

/**
 * Pure ECR ↔ Xero mapping. No I/O. Everything here is unit-tested in
 * tests/xero-map.test.ts. Rules come from spec §5.2 / §5.3 / §7.
 */

// ─── Dates ───────────────────────────────────────────────────────────────────

const DOTNET_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/

/** Xero JSON dates arrive as "/Date(ms+0000)/", or ISO in *String fields. */
export function parseXeroInstant(v: string | undefined | null): string | null {
  if (!v) return null
  const m = DOTNET_DATE.exec(v)
  if (m) return new Date(Number(m[1])).toISOString()
  const d = new Date(v.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Calendar date (YYYY-MM-DD) from any Xero date form. */
export function parseXeroDate(v: string | undefined | null): string | null {
  if (!v) return null
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v)
  if (iso) return iso[1]
  const instant = parseXeroInstant(v)
  return instant ? instant.slice(0, 10) : null
}

/** Xero wants If-Modified-Since as UTC "yyyy-MM-ddTHH:mm:ss". */
export function ifModifiedSinceHeader(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19)
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export function normaliseAbn(v: string | null | undefined): string | null {
  const digits = (v ?? '').replace(/\D/g, '')
  return digits.length === 11 ? digits : null
}

export type ClientForMatch = { id: string; name: string; abn: string | null }

/** ABN first, then exact case-insensitive name; ambiguous → null. */
export function matchContactToClient(
  contact: Pick<XeroContact, 'Name' | 'TaxNumber'>,
  clients: ClientForMatch[]
): string | null {
  const abn = normaliseAbn(contact.TaxNumber)
  if (abn) {
    const byAbn = clients.filter((c) => normaliseAbn(c.abn) === abn)
    if (byAbn.length === 1) return byAbn[0].id
    if (byAbn.length > 1) return null
  }
  const name = contact.Name.trim().toLowerCase()
  if (!name) return null
  const byName = clients.filter((c) => c.name.trim().toLowerCase() === name)
  return byName.length === 1 ? byName[0].id : null
}

// ─── Payloads ────────────────────────────────────────────────────────────────

const REFERENCE_MAX = 255
const NO_DESCRIPTION = '(no description)'

export type TrackingRef = { categoryId: string; optionId: string } | null

function trackingFor(tracking: TrackingRef) {
  return tracking
    ? [{ TrackingCategoryID: tracking.categoryId, TrackingOptionID: tracking.optionId }]
    : undefined
}

function dueDate(issue: string, explicit: string | null, terms: number): string {
  return explicit ?? format(addDays(parseISO(issue), terms), 'yyyy-MM-dd')
}

export function buildInvoicePayload(
  inv: EcrInvoiceForPush,
  mapping: XeroMapping,
  contactId: string,
  tracking: TrackingRef
): XeroInvoicePayload {
  const taxType = inv.gst_rate === 0 ? mapping.noGstTaxType : mapping.gstTaxType
  const reference = [inv.job_number, inv.job_title]
    .filter(Boolean)
    .join(' ')
    .slice(0, REFERENCE_MAX)
  const trackingList = trackingFor(tracking)

  const LineItems = inv.lines.map((l) => {
    const account =
      (l.kind && mapping.accountByKind[l.kind]) || mapping.defaultAccount || null
    if (!account) {
      throw new Error(
        'No Xero income account is mapped for this line — set a default income account in Settings → Xero.'
      )
    }
    return {
      Description: l.description.trim() || NO_DESCRIPTION,
      Quantity: l.qty,
      UnitAmount: l.unit_sell,
      AccountCode: account,
      TaxType: taxType,
      ...(trackingList ? { Tracking: trackingList } : {}),
    }
  })

  return {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    Date: inv.issue_date,
    DueDate: dueDate(inv.issue_date, inv.due_date, inv.payment_terms_days),
    InvoiceNumber: inv.number,
    Reference: reference,
    Status: 'AUTHORISED',
    LineAmountTypes: 'Exclusive',
    LineItems,
  }
}

export function claimInvoiceNumber(projectNumber: string, claimNumber: number): string {
  return `PC-${projectNumber}-${claimNumber}`
}

/** certified_amount is GST-inclusive in ECR (see markClaimPaid) → Inclusive line. */
export function buildClaimPayload(
  claim: EcrClaimForPush,
  mapping: XeroMapping,
  contactId: string,
  tracking: TrackingRef
): XeroInvoicePayload {
  if (!mapping.claimsAccount) {
    throw new Error('No Xero claims account is set — choose one in Settings → Xero.')
  }
  const trackingList = trackingFor(tracking)
  return {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    Date: claim.reference_date,
    DueDate: dueDate(claim.reference_date, null, claim.payment_terms_days),
    InvoiceNumber: claimInvoiceNumber(claim.project_number, claim.claim_number),
    Reference: claim.project_number.slice(0, REFERENCE_MAX),
    Status: 'AUTHORISED',
    LineAmountTypes: 'Inclusive',
    LineItems: [
      {
        Description: `Progress claim PC-${claim.claim_number} — ${claim.project_number} ${claim.project_name}`,
        Quantity: 1,
        UnitAmount: claim.certified_amount,
        AccountCode: mapping.claimsAccount,
        TaxType: mapping.gstTaxType,
        ...(trackingList ? { Tracking: trackingList } : {}),
      },
    ],
  }
}

// ─── Pull-side derivations ───────────────────────────────────────────────────

export type DerivedInvoiceStatus = { status: 'sent' | 'paid' | 'void'; paid_at: string | null }

/** Spec §7. */
export function deriveInvoiceStatusFromXero(
  x: Pick<XeroInvoice, 'Status' | 'AmountDue' | 'FullyPaidOnDate' | 'UpdatedDateUTC'>
): DerivedInvoiceStatus {
  if (x.Status === 'VOIDED' || x.Status === 'DELETED') return { status: 'void', paid_at: null }
  if (x.Status === 'PAID') {
    return {
      status: 'paid',
      paid_at: parseXeroInstant(x.FullyPaidOnDate) ?? parseXeroInstant(x.UpdatedDateUTC),
    }
  }
  if ((x.AmountDue ?? 1) <= 0) {
    return { status: 'paid', paid_at: parseXeroInstant(x.UpdatedDateUTC) }
  }
  return { status: 'sent', paid_at: null }
}

/** Per-line vs per-document GST rounding: tolerate 2 cents (spec §5.2 step 5). */
export function totalsDiffer(ecrTotal: number, xeroTotal: number | undefined): boolean {
  if (xeroTotal == null) return false
  return Math.abs(ecrTotal - xeroTotal) > 0.02
}

const WORK_NUMBER = /\b(RJ\d{5}|J-\d{4}|P-\d{4})\b/i

/** Job/project number inside a free-text Xero Reference, upper-cased. */
export function workNumberFromReference(ref: string | undefined | null): string | null {
  if (!ref) return null
  const m = WORK_NUMBER.exec(ref)
  return m ? m[1].toUpperCase() : null
}

export function xeroLinesToInvoiceLines(items: XeroLineItem[]) {
  return items.map((l, position) => ({
    description: l.Description?.trim() || NO_DESCRIPTION,
    qty: l.Quantity ?? 1,
    unit: 'ea',
    unit_sell: l.UnitAmount ?? 0,
    position,
  }))
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Xero's error bodies vary; pull the most specific human message we can. */
export function xeroErrorMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as {
      Elements?: { ValidationErrors?: { Message?: string }[] }[]
      Message?: string
      Detail?: string
      Title?: string
      error_description?: string
      error?: string
    }
    const validation = b.Elements?.flatMap((e) => e.ValidationErrors ?? [])
      .map((v) => v.Message)
      .filter(Boolean)
    if (validation && validation.length > 0) return validation.join(' ')
    return b.Message ?? b.Detail ?? b.Title ?? b.error_description ?? b.error ?? 'Xero request failed'
  }
  return 'Xero request failed'
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/xero-map.test.ts`
Expected: all tests pass (19).

- [ ] **Step 6: Commit**

```bash
git add src/lib/xero/types.ts src/lib/xero/map.ts tests/xero-map.test.ts
git commit -m "feat(xero): pure mappers — payloads, status derivation, contact matching, dates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 7: `register.ts`, `tokens.ts`, `client.ts` — register, token lifecycle, API client

**Files:**
- Create: `src/lib/xero/register.ts`
- Create: `src/lib/xero/tokens.ts`
- Create: `src/lib/xero/client.ts`
- Modify: `src/lib/email.ts:23-49` (add `office_xero_reconnect` template + label)
- Test: `tests/xero-client.test.ts`

**Interfaces:**
- Consumes: `xeroEnv`, `XERO_TOKEN_URL`, `XERO_CONNECTIONS_URL`, `XERO_API_BASE` (Task 3); `encryptSecret`/`decryptSecret` (Task 4); `xeroErrorMessage` (Task 6).
- Produces:
  - `register.ts`: `startRun(admin, trigger, createdBy?) → Promise<string>`, `logEvent(admin, runId, ev: XeroEvent) → Promise<void>`, `finishRun(admin, runId, patch: RunPatch) → Promise<void>`, type `XeroEvent = { direction: 'push'|'pull'; entity: 'invoice'|'claim'|'payment'|'contact'|'tracking'|'reference'|'connection'; entityId?: string|null; xeroId?: string|null; action: 'created'|'updated'|'voided'|'matched'|'unmatched'|'archived'|'skipped'|'warning'|'failed'; detail?: string|null }`.
  - `tokens.ts`: `type XeroConnection = { tenant_id, tenant_name, connection_id, status, connected_at, last_sync_at, last_sync_status, access_expires_at }`, `loadConnection(admin) → Promise<XeroConnectionRow|null>` (raw row incl. encrypted blobs — internal), `getConnectionSummary(admin) → Promise<XeroConnection|null>`, `exchangeCodeForTokens(code) → Promise<TokenSet>`, `refreshTokenSet(refreshToken) → Promise<TokenSet>`, `storeTokenSet(admin, tokens, extra?)`, `getValidAccessToken(admin) → Promise<{ accessToken; tenantId }>` (refreshes when < 5 min left), `markNeedsReconnect(admin, reason)`, `listConnections(accessToken) → Promise<XeroTenant[]>`, `deleteConnection(accessToken, connectionId)`.
  - `client.ts`: `createXeroApi(deps: XeroApiDeps): XeroApi` where `XeroApi = { get<T>(path): Promise<T>; post<T>(path, body): Promise<T>; put<T>(path, body): Promise<T>; postNoContent(path): Promise<void> }`, `xeroApiForAdmin(admin): XeroApi`, `class XeroApiError extends Error { status: number; body: unknown }`, `class XeroRateLimitError extends XeroApiError`.

- [ ] **Step 1: Write the failing client test (fakes for auth/refresh/fetch/sleep)**

```ts
// tests/xero-client.test.ts
import { describe, expect, test, vi } from 'vitest'
import { XeroApiError, XeroRateLimitError, createXeroApi } from '../src/lib/xero/client'

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function makeApi(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const refresh = vi.fn(async () => ({ accessToken: 'fresh', tenantId: 't1' }))
  const sleep = vi.fn(async () => {})
  const api = createXeroApi({
    getAuth: async () => ({ accessToken: 'stale', tenantId: 't1' }),
    refresh,
    fetch: fetchImpl as unknown as typeof fetch,
    sleep,
  })
  return { api, refresh, sleep }
}

describe('createXeroApi', () => {
  test('sends bearer + tenant + json headers and parses the body', async () => {
    const seen: RequestInit[] = []
    const { api } = makeApi(async (url, init) => {
      seen.push(init)
      expect(url).toBe('https://api.xero.com/api.xro/2.0/Organisation')
      return response(200, { Organisations: [{ Name: 'Demo' }] })
    })
    const body = await api.get<{ Organisations: { Name: string }[] }>('/Organisation')
    expect(body.Organisations[0].Name).toBe('Demo')
    const h = seen[0].headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer stale')
    expect(h['xero-tenant-id']).toBe('t1')
    expect(h.Accept).toBe('application/json')
  })

  test('401 → refresh once → retry with the new token', async () => {
    const tokens: string[] = []
    const { api, refresh } = makeApi(async (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization
      tokens.push(auth)
      return auth === 'Bearer fresh' ? response(200, { ok: true }) : response(401, { Detail: 'TokenExpired' })
    })
    await expect(api.get('/Invoices')).resolves.toEqual({ ok: true })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(tokens).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  test('a second 401 after refresh surfaces as XeroApiError(401)', async () => {
    const { api } = makeApi(async () => response(401, { Detail: 'nope' }))
    await expect(api.get('/Invoices')).rejects.toMatchObject({ status: 401, message: 'nope' })
  })

  test('429 → waits Retry-After (capped at 60s) once → retries', async () => {
    let calls = 0
    const { api, sleep } = makeApi(async () => {
      calls++
      return calls === 1
        ? response(429, null, { 'retry-after': '7' })
        : response(200, { Invoices: [] })
    })
    await expect(api.get('/Invoices')).resolves.toEqual({ Invoices: [] })
    expect(sleep).toHaveBeenCalledWith(7000)
  })

  test('two 429s in a row → XeroRateLimitError', async () => {
    const { api, sleep } = makeApi(async () => response(429, null, { 'retry-after': '500' }))
    await expect(api.get('/Invoices')).rejects.toBeInstanceOf(XeroRateLimitError)
    expect(sleep).toHaveBeenCalledWith(60000)
  })

  test('400 validation errors are readable', async () => {
    const { api } = makeApi(async () =>
      response(400, { Elements: [{ ValidationErrors: [{ Message: 'Invoice # must be unique.' }] }] })
    )
    const err = await api.post('/Invoices', { Invoices: [] }).catch((e) => e)
    expect(err).toBeInstanceOf(XeroApiError)
    expect(err.message).toBe('Invoice # must be unique.')
    expect(err.status).toBe(400)
  })

  test('postNoContent accepts 204 and posts an empty body', async () => {
    const { api } = makeApi(async (_url, init) => {
      expect(init.method).toBe('POST')
      expect(init.body).toBeUndefined()
      return new Response(null, { status: 204 })
    })
    await expect(api.postNoContent('/Invoices/abc/Email')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/xero-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the office email template**

In `src/lib/email.ts` add `'office_xero_reconnect',` to `EMAIL_TEMPLATES` (before `'test'`) and `office_xero_reconnect: 'Office alert — Xero needs reconnecting',` to `EMAIL_TEMPLATE_LABELS`.

- [ ] **Step 4: Write `register.ts`**

```ts
// src/lib/xero/register.ts
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Admin = SupabaseClient<any, 'public', any>

export type XeroEvent = {
  direction: 'push' | 'pull'
  entity: 'invoice' | 'claim' | 'payment' | 'contact' | 'tracking' | 'reference' | 'connection'
  entityId?: string | null
  xeroId?: string | null
  action:
    | 'created'
    | 'updated'
    | 'voided'
    | 'matched'
    | 'unmatched'
    | 'archived'
    | 'skipped'
    | 'warning'
    | 'failed'
  detail?: string | null
}

export type RunPatch = {
  status: 'success' | 'partial' | 'failed'
  invoices_pulled?: number
  invoices_created?: number
  payments_upserted?: number
  contacts_linked?: number
  pushed?: number
  warnings?: number
  errors?: number
  error?: string | null
}

/**
 * The sync register (xero_sync_runs / xero_sync_events). Service-role writes
 * only — no client role has an INSERT policy. Never pruned: it is the audit
 * trail Xero's security standard asks for. Event writes never throw (a
 * logging failure must not break a push).
 */
export async function startRun(
  admin: Admin,
  trigger: 'cron' | 'manual' | 'push',
  createdBy: string | null = null
): Promise<string> {
  const { data, error } = await admin
    .from('xero_sync_runs')
    .insert({ trigger, created_by: createdBy, status: 'running' })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Could not open a Xero sync run: ${error?.message}`)
  return data.id as string
}

export async function logEvent(admin: Admin, runId: string, ev: XeroEvent): Promise<void> {
  try {
    await admin.from('xero_sync_events').insert({
      run_id: runId,
      direction: ev.direction,
      entity: ev.entity,
      entity_id: ev.entityId ?? null,
      xero_id: ev.xeroId ?? null,
      action: ev.action,
      detail: ev.detail ? ev.detail.slice(0, 1000) : null,
    })
  } catch (err) {
    console.error('[xero] failed to write sync event:', err)
  }
}

export async function finishRun(admin: Admin, runId: string, patch: RunPatch): Promise<void> {
  const { error } = await admin
    .from('xero_sync_runs')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', runId)
  if (error) console.error('[xero] failed to close sync run:', error.message)
}

/** True while another run is still marked running and younger than 10 minutes. */
export async function runInProgress(admin: Admin): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('xero_sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'running')
    .gte('started_at', since)
  return (count ?? 0) > 0
}
```

- [ ] **Step 5: Write `tokens.ts`**

```ts
// src/lib/xero/tokens.ts
import { renderEmail, sendEmail } from '@/lib/email'
import { XERO_CONNECTIONS_URL, XERO_TOKEN_URL, xeroEnv, xeroRedirectUri } from './config'
import { decryptSecret, encryptSecret } from './crypto'
import type { Admin } from './register'

/**
 * Token lifecycle for the single Xero connection.
 *  - Access tokens live 30 min; refresh tokens rotate on every refresh and die
 *    after 60 days idle (the nightly sync keeps them warm).
 *  - Both are stored AES-256-GCM encrypted (crypto.ts). Nothing here ever
 *    returns a token to a caller outside src/lib/xero.
 *  - A failed refresh (invalid_grant) flips status → needs_reconnect and
 *    emails the office (spec §5.4 step 1).
 */

export type TokenSet = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}

export type XeroTenant = {
  id: string // connection id
  tenantId: string
  tenantName?: string
  tenantType?: string
}

export type XeroConnectionRow = {
  id: number
  tenant_id: string | null
  tenant_name: string | null
  connection_id: string | null
  access_token_enc: string | null
  refresh_token_enc: string | null
  access_expires_at: string | null
  scopes: string | null
  status: 'connected' | 'needs_reconnect' | 'disconnected'
  connected_by: string | null
  connected_at: string | null
  last_refresh_at: string | null
  last_sync_at: string | null
  last_sync_status: string | null
}

/** The page-safe subset: no token columns. */
export type XeroConnection = Omit<
  XeroConnectionRow,
  'access_token_enc' | 'refresh_token_enc' | 'id'
>

const REFRESH_AHEAD_MS = 5 * 60 * 1000

function basicAuth(): string {
  const env = xeroEnv()
  if (!env) throw new Error('Xero is not configured on this deployment')
  return 'Basic ' + Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64')
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await res.json().catch(() => null)) as
    | (TokenSet & { error?: string; error_description?: string })
    | null
  if (!res.ok || !body?.access_token || !body.refresh_token) {
    const reason = body?.error_description ?? body?.error ?? `HTTP ${res.status}`
    const err = new Error(`Xero token request failed: ${reason}`)
    ;(err as Error & { code?: string }).code = body?.error
    throw err
  }
  return body
}

export function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: xeroRedirectUri(),
  })
}

export function refreshTokenSet(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

export async function listConnections(accessToken: string): Promise<XeroTenant[]> {
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Could not list Xero connections (HTTP ${res.status})`)
  return (await res.json()) as XeroTenant[]
}

export async function deleteConnection(accessToken: string, connectionId: string): Promise<void> {
  const res = await fetch(`${XERO_CONNECTIONS_URL}/${connectionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Could not disconnect from Xero (HTTP ${res.status})`)
  }
}

export async function loadConnection(admin: Admin): Promise<XeroConnectionRow | null> {
  const { data, error } = await admin.from('xero_connection').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(`Could not read the Xero connection: ${error.message}`)
  return (data as XeroConnectionRow | null) ?? null
}

export async function getConnectionSummary(admin: Admin): Promise<XeroConnection | null> {
  const row = await loadConnection(admin)
  if (!row) return null
  // Strip the encrypted blobs before anything leaves this module.
  const { access_token_enc, refresh_token_enc, id, ...safe } = row
  void access_token_enc
  void refresh_token_enc
  void id
  return safe
}

export async function storeTokenSet(
  admin: Admin,
  tokens: TokenSet,
  extra: Partial<
    Pick<
      XeroConnectionRow,
      'tenant_id' | 'tenant_name' | 'connection_id' | 'connected_by' | 'connected_at' | 'status'
    >
  > = {}
): Promise<void> {
  const env = xeroEnv()
  if (!env) throw new Error('Xero is not configured on this deployment')
  const { error } = await admin
    .from('xero_connection')
    .update({
      access_token_enc: encryptSecret(tokens.access_token, env.tokenKey),
      refresh_token_enc: encryptSecret(tokens.refresh_token, env.tokenKey),
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ?? null,
      last_refresh_at: new Date().toISOString(),
      status: 'connected',
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq('id', 1)
  if (error) throw new Error(`Could not store Xero tokens: ${error.message}`)
}

export async function markNeedsReconnect(admin: Admin, reason: string): Promise<void> {
  await admin
    .from('xero_connection')
    .update({
      status: 'needs_reconnect',
      access_token_enc: null,
      refresh_token_enc: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)

  // Office alert (skip-logged until email is configured; never throws).
  const { data: settings } = await admin
    .from('settings')
    .select('company_name, email')
    .eq('id', 1)
    .single()
  await sendEmail({
    to: settings?.email ?? null,
    subject: 'Xero needs reconnecting',
    template: 'office_xero_reconnect',
    entityKind: 'xero_connection',
    html: renderEmail({
      companyName: settings?.company_name ?? 'Entice',
      heading: 'Xero needs reconnecting',
      intro: `ECR could not refresh its Xero access (${reason}). Invoices cannot be sent via Xero and the nightly sync is paused until an admin reconnects.`,
      cta: process.env.NEXT_PUBLIC_APP_URL
        ? { label: 'Open Settings → Xero', url: `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/settings?tab=xero` }
        : null,
    }),
  })
}

export async function clearConnection(admin: Admin): Promise<void> {
  const { error } = await admin
    .from('xero_connection')
    .update({
      access_token_enc: null,
      refresh_token_enc: null,
      access_expires_at: null,
      connection_id: null,
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) throw new Error(`Could not clear the Xero connection: ${error.message}`)
}

/**
 * Decrypt the current access token, refreshing first when it is within five
 * minutes of expiry. Throws when the connection is not usable; on a refresh
 * failure marks needs_reconnect before throwing.
 */
export async function getValidAccessToken(
  admin: Admin,
  opts: { forceRefresh?: boolean } = {}
): Promise<{ accessToken: string; tenantId: string }> {
  const env = xeroEnv()
  if (!env) throw new Error('Xero is not configured on this deployment')
  const row = await loadConnection(admin)
  if (!row || row.status !== 'connected' || !row.refresh_token_enc || !row.tenant_id) {
    throw new Error('Xero is not connected')
  }

  const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : 0
  const needsRefresh =
    opts.forceRefresh || !row.access_token_enc || expiresAt - Date.now() < REFRESH_AHEAD_MS

  if (!needsRefresh) {
    return { accessToken: decryptSecret(row.access_token_enc!, env.tokenKey), tenantId: row.tenant_id }
  }

  try {
    const fresh = await refreshTokenSet(decryptSecret(row.refresh_token_enc, env.tokenKey))
    await storeTokenSet(admin, fresh)
    return { accessToken: fresh.access_token, tenantId: row.tenant_id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if ((err as { code?: string }).code === 'invalid_grant' || /invalid_grant/.test(message)) {
      await markNeedsReconnect(admin, message)
    }
    throw err
  }
}
```

- [ ] **Step 6: Write `client.ts`**

```ts
// src/lib/xero/client.ts
import { XERO_API_BASE } from './config'
import { xeroErrorMessage } from './map'
import type { Admin } from './register'
import { getValidAccessToken } from './tokens'

/**
 * Minimal Xero Accounting API client. Behaviour (tests/xero-client.test.ts):
 *  - Authorization: Bearer + xero-tenant-id + Accept: application/json.
 *  - 401 → refresh ONCE via deps.refresh, retry once.
 *  - 429 → sleep Retry-After seconds (cap 60) ONCE, retry once; a second 429
 *    throws XeroRateLimitError so the caller ends the run as 'partial'.
 *  - Any other non-2xx → XeroApiError with Xero's validation message.
 * Xero's limits: 60 calls/min, 5000/day per org, 5 concurrent — we call
 * sequentially and never parallelise.
 */

export class XeroApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? xeroErrorMessage(body))
    this.name = 'XeroApiError'
    this.status = status
    this.body = body
  }
}

export class XeroRateLimitError extends XeroApiError {
  constructor(body: unknown) {
    super(429, body, 'Xero rate limit reached — the sync will resume on the next run')
    this.name = 'XeroRateLimitError'
  }
}

export type XeroAuth = { accessToken: string; tenantId: string }

export type XeroApiDeps = {
  getAuth: () => Promise<XeroAuth>
  refresh: () => Promise<XeroAuth>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type XeroApi = {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body: unknown): Promise<T>
  put<T>(path: string, body: unknown): Promise<T>
  postNoContent(path: string): Promise<void>
}

const MAX_RETRY_AFTER_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000

export function createXeroApi(deps: XeroApiDeps): XeroApi {
  const doFetch = deps.fetch ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let auth = await deps.getAuth()
    let refreshed = false
    let waited = false

    for (;;) {
      const res = await doFetch(`${XERO_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'xero-tenant-id': auth.tenantId,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.status === 401 && !refreshed) {
        refreshed = true
        auth = await deps.refresh()
        continue
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '5')
        const ms = Math.min(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000,
          MAX_RETRY_AFTER_MS
        )
        if (!waited) {
          waited = true
          await sleep(ms)
          continue
        }
        await sleep(ms)
        throw new XeroRateLimitError(await res.json().catch(() => null))
      }
      if (res.status === 204) return undefined as T
      const parsed = await res.json().catch(() => null)
      if (!res.ok) throw new XeroApiError(res.status, parsed)
      return parsed as T
    }
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    postNoContent: (path) => request<void>('POST', path),
  }
}

/** The real thing: tokens from xero_connection via the service-role client. */
export function xeroApiForAdmin(admin: Admin): XeroApi {
  return createXeroApi({
    getAuth: () => getValidAccessToken(admin),
    refresh: () => getValidAccessToken(admin, { forceRefresh: true }),
  })
}
```

- [ ] **Step 7: Run the tests + type check**

Run: `npx vitest run tests/xero-client.test.ts tests/email.test.ts --maxWorkers=1 && npx tsc --noEmit`
Expected: client tests pass (7); email tests still pass; tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/xero/register.ts src/lib/xero/tokens.ts src/lib/xero/client.ts src/lib/email.ts tests/xero-client.test.ts
git commit -m "feat(xero): register, encrypted token lifecycle with reconnect alert, API client with refresh/rate-limit handling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: OAuth routes + `status.ts`

**Files:**
- Create: `src/app/api/xero/connect/route.ts`
- Create: `src/app/api/xero/callback/route.ts`
- Create: `src/lib/xero/status.ts`

**Interfaces:**
- Consumes: `XERO_AUTHORIZE_URL`, `XERO_SCOPES`, `xeroEnv`, `xeroRedirectUri`, `xeroConfigured` (Task 3); `newOAuthState`, `hashOAuthState`, `oauthStateMatches`, `XERO_STATE_COOKIE`, `XERO_STATE_TTL_SECONDS` (Task 5); `exchangeCodeForTokens`, `listConnections`, `storeTokenSet`, `loadConnection`, `getConnectionSummary` (Task 7); `getProfile` from `@/lib/auth`; `createAdminClient`.
- Produces: `getXeroStatus(): Promise<XeroStatus>` with `XeroStatus = { available: boolean; reason: string | null; connected: boolean; status: 'connected'|'needs_reconnect'|'disconnected'|'unavailable'; tenantName: string | null; connectedAt: string | null; lastSyncAt: string | null; lastSyncStatus: string | null; pendingOrgSwitch: { tenantName: string } | null }`.

Org-switch handling (spec §5.1), using only the columns migrated in Task 1: the callback stores the new tokens + tenant with `status='connected'` when the stored `tenant_id` is null or equal to the new one. When it differs, it stores the tokens with `tenant_id`/`tenant_name` updated but `status='needs_reconnect'`, and redirects with `?xero=switched`. The Xero tab (Task 13) then shows the typed-confirmation dialog, whose `confirmXeroOrgSwitch` action clears every link column and flips the status to `connected`. `getXeroStatus` exposes the pending state as `pendingOrgSwitch` when `status='needs_reconnect'` **and** tokens exist.

- [ ] **Step 1: Write `status.ts`**

```ts
// src/lib/xero/status.ts
import { createAdminClient } from '@/lib/supabase/server'
import { xeroConfigured } from './config'
import { loadConnection } from './tokens'

export type XeroStatus = {
  /** Env + service role present — the integration can run at all. */
  available: boolean
  reason: string | null
  connected: boolean
  status: 'connected' | 'needs_reconnect' | 'disconnected' | 'unavailable'
  tenantName: string | null
  connectedAt: string | null
  lastSyncAt: string | null
  lastSyncStatus: string | null
  /** Tokens exist for a different org than before — awaiting typed confirmation. */
  pendingOrgSwitch: { tenantName: string } | null
}

const UNAVAILABLE: XeroStatus = {
  available: false,
  reason: null,
  connected: false,
  status: 'unavailable',
  tenantName: null,
  connectedAt: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  pendingOrgSwitch: null,
}

/**
 * Page-safe connection summary. Never throws, never returns token material.
 * Used by Settings, the invoice page, Money, the dashboard and the cron.
 */
export async function getXeroStatus(): Promise<XeroStatus> {
  if (!xeroConfigured()) {
    return { ...UNAVAILABLE, reason: 'XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_TOKEN_KEY must be set in the environment.' }
  }
  let admin
  try {
    admin = createAdminClient()
  } catch {
    return { ...UNAVAILABLE, reason: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment.' }
  }
  try {
    const row = await loadConnection(admin)
    if (!row) return { ...UNAVAILABLE, available: true, status: 'disconnected' }
    const hasTokens = Boolean(row.refresh_token_enc)
    return {
      available: true,
      reason: null,
      connected: row.status === 'connected' && hasTokens,
      status: row.status,
      tenantName: row.tenant_name,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      pendingOrgSwitch:
        row.status === 'needs_reconnect' && hasTokens && row.tenant_name
          ? { tenantName: row.tenant_name }
          : null,
    }
  } catch (err) {
    return { ...UNAVAILABLE, available: true, reason: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 2: Write the connect route**

```ts
// src/app/api/xero/connect/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getProfile } from '@/lib/auth'
import { XERO_AUTHORIZE_URL, XERO_SCOPES, xeroEnv, xeroRedirectUri } from '@/lib/xero/config'
import {
  XERO_STATE_COOKIE,
  XERO_STATE_TTL_SECONDS,
  hashOAuthState,
  newOAuthState,
} from '@/lib/xero/oauth-state'

export const runtime = 'nodejs'

/**
 * Settings → Xero → "Connect to Xero". Admin only. Sets an httpOnly cookie
 * holding sha256(state) and 302s to Xero's consent screen with EXACTLY the
 * five approved scopes (spec §3). The user logs in on Xero's side — no Xero
 * credentials ever touch ECR.
 */
export async function GET(request: Request) {
  const profile = await getProfile()
  if (!profile || profile.role !== 'admin') {
    return new Response('Forbidden', { status: 403 })
  }
  const env = xeroEnv()
  if (!env) {
    return NextResponse.redirect(new URL('/settings?tab=xero&xero=unconfigured', request.url))
  }

  const state = newOAuthState()
  const cookieStore = await cookies()
  cookieStore.set(XERO_STATE_COOKIE, hashOAuthState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/xero',
    maxAge: XERO_STATE_TTL_SECONDS,
  })

  const url = new URL(XERO_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', env.clientId)
  url.searchParams.set('redirect_uri', xeroRedirectUri())
  url.searchParams.set('scope', XERO_SCOPES)
  url.searchParams.set('state', state)
  return NextResponse.redirect(url)
}
```

- [ ] **Step 3: Write the callback route**

```ts
// src/app/api/xero/callback/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { XERO_STATE_COOKIE, oauthStateMatches } from '@/lib/xero/oauth-state'
import {
  exchangeCodeForTokens,
  listConnections,
  loadConnection,
  storeTokenSet,
} from '@/lib/xero/tokens'

export const runtime = 'nodejs'

/**
 * Xero redirects here after consent. Verifies state (timing-safe against the
 * hashed cookie), exchanges the code, resolves the tenant, stores encrypted
 * tokens, and ALWAYS answers with a 302 to Settings — `code`/`state` never
 * appear in a response body (Xero security standard: sensitive URL params →
 * redirect). Outcomes are passed as ?xero=… flags the Xero tab renders.
 */
function back(request: Request, flag: string) {
  return NextResponse.redirect(new URL(`/settings?tab=xero&xero=${flag}`, request.url))
}

export async function GET(request: Request) {
  const profile = await getProfile()
  if (!profile || profile.role !== 'admin') {
    return new Response('Forbidden', { status: 403 })
  }

  const url = new URL(request.url)
  const cookieStore = await cookies()
  const cookieHash = cookieStore.get(XERO_STATE_COOKIE)?.value
  cookieStore.delete(XERO_STATE_COOKIE)

  if (url.searchParams.get('error')) return back(request, 'denied')
  const code = url.searchParams.get('code')
  if (!code || !oauthStateMatches(url.searchParams.get('state'), cookieHash)) {
    return back(request, 'state')
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return back(request, 'noservicerole')
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const tenants = (await listConnections(tokens.access_token)).filter(
      (t) => t.tenantType === undefined || t.tenantType === 'ORGANISATION'
    )
    if (tenants.length === 0) return back(request, 'notenant')
    if (tenants.length > 1) return back(request, 'multitenant')
    const tenant = tenants[0]

    const existing = await loadConnection(admin)
    const switching =
      Boolean(existing?.tenant_id) && existing!.tenant_id !== tenant.tenantId

    await storeTokenSet(admin, tokens, {
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName ?? tenant.tenantId,
      connection_id: tenant.id,
      connected_by: profile.id,
      connected_at: new Date().toISOString(),
      // A different org than before needs the typed confirmation in Settings
      // (spec §5.1) before anything syncs.
      status: switching ? 'needs_reconnect' : 'connected',
    })
    return back(request, switching ? 'switched' : 'connected')
  } catch (err) {
    console.error('[xero] callback failed:', err instanceof Error ? err.message : err)
    return back(request, 'failed')
  }
}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/xero src/lib/xero/status.ts
git commit -m "feat(xero): connect/callback OAuth routes and page-safe status summary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Extract `syncJobStatus` to `src/lib/job-status.ts`

**Files:**
- Create: `src/lib/job-status.ts`
- Modify: `src/app/(office)/invoices/actions.ts:8,53-85` (delete the local helper, import the shared one)

**Interfaces:**
- Produces: `syncJobStatus(supabase: SupabaseClient, jobId: string | null): Promise<void>` — identical behaviour to the current private helper (rules in `deriveJobStatusFromInvoices`).

- [ ] **Step 1: Create the module**

```ts
// src/lib/job-status.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveJobStatusFromInvoices } from '@/lib/issue-guards'

/**
 * Reconcile a job's invoicing status against its non-void invoices, in both
 * directions (completed → invoiced → paid and back). Rules live in
 * deriveJobStatusFromInvoices. Works with either a user-session client (office
 * actions) or the service-role client (Xero push/pull).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncJobStatus(supabase: SupabaseClient<any, any, any>, jobId: string | null): Promise<void> {
  if (!jobId) return

  const [{ data: job }, { data: invoices }] = await Promise.all([
    supabase.from('jobs').select('id, status').eq('id', jobId).single(),
    supabase.from('invoices').select('status').eq('job_id', jobId),
  ])
  if (!job) return

  const next = deriveJobStatusFromInvoices(
    job.status as string,
    (invoices ?? []).map((i) => i.status as string)
  )
  if (next) {
    await supabase.from('jobs').update({ status: next }).eq('id', jobId)
  }
}
```

- [ ] **Step 2: Replace the private helper in `invoices/actions.ts`**

Delete lines 53–85 (the `syncJobStatus` function and its doc comment) and add to the imports:

```ts
import { syncJobStatus } from '@/lib/job-status'
```

Remove `deriveJobStatusFromInvoices` from the `@/lib/issue-guards` import if it is now unused (keep `issueProblem`).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/issue-guards.test.ts`
Expected: clean; tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/job-status.ts "src/app/(office)/invoices/actions.ts"
git commit -m "refactor: share syncJobStatus so the Xero push/pull can reuse it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 10: `reference.ts`, `contacts.ts`, `tracking.ts`, `mapping.ts`

**Files:**
- Create: `src/lib/xero/mapping.ts`
- Create: `src/lib/xero/reference.ts`
- Create: `src/lib/xero/contacts.ts`
- Create: `src/lib/xero/tracking.ts`

**Interfaces:**
- Consumes: `XeroApi` (Task 7), `Admin`, `logEvent` (Task 7), `matchContactToClient`, `normaliseAbn` (Task 6), types (Task 6).
- Produces:
  - `mapping.ts`: `loadMapping(admin) → Promise<XeroMapping>`.
  - `reference.ts`: `syncReferenceData(admin, api, runId) → Promise<{ accounts: number; taxRates: number; trackingCategories: number }>`.
  - `contacts.ts`: `syncContacts(admin, api, runId, since: string | null) → Promise<{ cached: number; linked: number }>`, `ensureContactForClient(admin, api, runId, clientId) → Promise<string>` (returns the Xero ContactID).
  - `tracking.ts`: `ensureTrackingOption(admin, api, runId, work: { kind: 'job'|'project'; id: string; number: string }) → Promise<TrackingRef>`, `archiveStaleTrackingOptions(admin, api, runId) → Promise<number>`.

- [ ] **Step 1: `mapping.ts`**

```ts
// src/lib/xero/mapping.ts
import type { Admin } from './register'
import type { XeroMapping } from './types'

/** settings.xero_* → XeroMapping (single source of truth for push/pull). */
export async function loadMapping(admin: Admin): Promise<XeroMapping> {
  const { data, error } = await admin
    .from('settings')
    .select(
      'xero_email_mode, xero_default_account, xero_account_by_kind, xero_claims_account, xero_gst_tax_type, xero_no_gst_tax_type, xero_tracking_category_id'
    )
    .eq('id', 1)
    .single()
  if (error || !data) throw new Error(`Could not read Xero settings: ${error?.message}`)
  return {
    emailMode: (data.xero_email_mode as 'xero' | 'ecr') ?? 'xero',
    defaultAccount: (data.xero_default_account as string | null) ?? null,
    accountByKind: ((data.xero_account_by_kind as Record<string, string> | null) ?? {}),
    claimsAccount: (data.xero_claims_account as string | null) ?? null,
    gstTaxType: (data.xero_gst_tax_type as string) ?? 'OUTPUT',
    noGstTaxType: (data.xero_no_gst_tax_type as string) ?? 'EXEMPTOUTPUT',
    trackingCategoryId: (data.xero_tracking_category_id as string | null) ?? null,
  }
}
```

- [ ] **Step 2: `reference.ts`**

```ts
// src/lib/xero/reference.ts
import type { XeroApi } from './client'
import { logEvent, type Admin } from './register'
import type { XeroAccount, XeroTaxRate, XeroTrackingCategory } from './types'

const INCOME_TYPES = ['REVENUE', 'SALES', 'OTHERINCOME']

/**
 * Cache the reference data the Settings pickers need (spec §3 "Reference
 * data"): income accounts, tax rates, tracking categories + options. Upserts
 * by natural key; rows Xero no longer returns are marked ARCHIVED, never deleted.
 */
export async function syncReferenceData(
  admin: Admin,
  api: XeroApi,
  runId: string
): Promise<{ accounts: number; taxRates: number; trackingCategories: number }> {
  const now = new Date().toISOString()

  const where = encodeURIComponent(INCOME_TYPES.map((t) => `Type=="${t}"`).join('||'))
  const { Accounts = [] } = await api.get<{ Accounts?: XeroAccount[] }>(`/Accounts?where=${where}`)
  const accountRows = Accounts.filter((a) => a.Code).map((a) => ({
    code: a.Code!,
    name: a.Name,
    type: a.Type,
    tax_type: a.TaxType ?? null,
    status: a.Status ?? 'ACTIVE',
    synced_at: now,
  }))
  if (accountRows.length > 0) {
    const { error } = await admin.from('xero_accounts').upsert(accountRows, { onConflict: 'code' })
    if (error) throw new Error(`accounts cache: ${error.message}`)
    await admin
      .from('xero_accounts')
      .update({ status: 'ARCHIVED' })
      .lt('synced_at', now)
      .neq('status', 'ARCHIVED')
  }

  const { TaxRates = [] } = await api.get<{ TaxRates?: XeroTaxRate[] }>('/TaxRates')
  const taxRows = TaxRates.filter((t) => t.CanApplyToRevenue !== false).map((t) => ({
    tax_type: t.TaxType,
    name: t.Name,
    effective_rate: t.EffectiveRate ?? null,
    status: t.Status ?? 'ACTIVE',
    synced_at: now,
  }))
  if (taxRows.length > 0) {
    const { error } = await admin.from('xero_tax_rates').upsert(taxRows, { onConflict: 'tax_type' })
    if (error) throw new Error(`tax rates cache: ${error.message}`)
  }

  const { TrackingCategories = [] } = await api.get<{ TrackingCategories?: XeroTrackingCategory[] }>(
    '/TrackingCategories?includeArchived=true'
  )
  for (const cat of TrackingCategories) {
    const { error } = await admin.from('xero_tracking_categories').upsert(
      { id: cat.TrackingCategoryID, name: cat.Name, status: cat.Status ?? 'ACTIVE', synced_at: now },
      { onConflict: 'id' }
    )
    if (error) throw new Error(`tracking cache: ${error.message}`)
    const options = (cat.Options ?? []).map((o) => ({
      id: o.TrackingOptionID,
      category_id: cat.TrackingCategoryID,
      name: o.Name,
      status: o.Status ?? 'ACTIVE',
      synced_at: now,
    }))
    if (options.length > 0) {
      const { error: optErr } = await admin.from('xero_tracking_options').upsert(options, { onConflict: 'id' })
      if (optErr) throw new Error(`tracking options cache: ${optErr.message}`)
    }
  }

  await logEvent(admin, runId, {
    direction: 'pull',
    entity: 'reference',
    action: 'updated',
    detail: `${accountRows.length} accounts, ${taxRows.length} tax rates, ${TrackingCategories.length} tracking categories`,
  })
  return { accounts: accountRows.length, taxRates: taxRows.length, trackingCategories: TrackingCategories.length }
}
```

- [ ] **Step 3: `contacts.ts`**

```ts
// src/lib/xero/contacts.ts
import type { XeroApi } from './client'
import { ifModifiedSinceHeader, matchContactToClient, normaliseAbn, type ClientForMatch } from './map'
import { logEvent, type Admin } from './register'
import type { XeroContact } from './types'

const PAGE = 100

/**
 * Contacts (spec §3 / §5.5). We cache ONLY contact_id, name, abn, has_email.
 * Auto-link: ABN, then exact name; ambiguous → left for the manual picker.
 */
export async function syncContacts(
  admin: Admin,
  api: XeroApi,
  runId: string,
  since: string | null
): Promise<{ cached: number; linked: number }> {
  const now = new Date().toISOString()
  const all: XeroContact[] = []
  for (let page = 1; ; page++) {
    const path = `/Contacts?page=${page}` + (since ? `&If-Modified-Since=${ifModifiedSinceHeader(since)}` : '')
    const { Contacts = [] } = await api.get<{ Contacts?: XeroContact[] }>(path)
    all.push(...Contacts)
    if (Contacts.length < PAGE) break
  }

  if (all.length > 0) {
    const rows = all.map((c) => ({
      contact_id: c.ContactID,
      name: c.Name,
      abn: normaliseAbn(c.TaxNumber),
      has_email: Boolean(c.EmailAddress?.trim()),
      status: c.ContactStatus ?? 'ACTIVE',
      synced_at: now,
    }))
    const { error } = await admin.from('xero_contacts').upsert(rows, { onConflict: 'contact_id' })
    if (error) throw new Error(`contacts cache: ${error.message}`)
  }

  const { data: clients } = await admin
    .from('clients')
    .select('id, name, abn')
    .is('xero_contact_id', null)
    .eq('archived', false)
  const unlinked = (clients ?? []) as ClientForMatch[]
  let linked = 0
  for (const c of all) {
    if (c.ContactStatus === 'ARCHIVED') continue
    const clientId = matchContactToClient(c, unlinked)
    if (!clientId) continue
    const { error } = await admin
      .from('clients')
      .update({ xero_contact_id: c.ContactID })
      .eq('id', clientId)
      .is('xero_contact_id', null)
    if (error) continue
    linked++
    unlinked.splice(unlinked.findIndex((u) => u.id === clientId), 1)
    await logEvent(admin, runId, {
      direction: 'pull', entity: 'contact', entityId: clientId, xeroId: c.ContactID,
      action: 'matched', detail: `Linked client to Xero contact "${c.Name}"`,
    })
  }
  return { cached: all.length, linked }
}

/**
 * Resolve (or create) the Xero contact for a client. Creation sends name, ABN
 * and the primary contact's email only (spec §3 "writes").
 */
export async function ensureContactForClient(
  admin: Admin,
  api: XeroApi,
  runId: string,
  clientId: string
): Promise<string> {
  const { data: client, error } = await admin
    .from('clients')
    .select('id, name, abn, xero_contact_id')
    .eq('id', clientId)
    .single()
  if (error || !client) throw new Error('Client not found')
  if (client.xero_contact_id) return client.xero_contact_id as string

  // Search Xero by ABN, then exact name.
  const abn = normaliseAbn(client.abn as string | null)
  const candidates: XeroContact[] = []
  if (abn) {
    const { Contacts = [] } = await api.get<{ Contacts?: XeroContact[] }>(
      `/Contacts?where=${encodeURIComponent(`TaxNumber=="${abn}"`)}`
    )
    candidates.push(...Contacts)
  }
  if (candidates.length === 0) {
    const { Contacts = [] } = await api.get<{ Contacts?: XeroContact[] }>(
      `/Contacts?where=${encodeURIComponent(`Name=="${(client.name as string).replace(/"/g, '\\"')}"`)}`
    )
    candidates.push(...Contacts)
  }
  let contactId: string
  if (candidates.length >= 1) {
    contactId = candidates[0].ContactID
    await logEvent(admin, runId, {
      direction: 'push', entity: 'contact', entityId: clientId, xeroId: contactId,
      action: 'matched', detail: `Found existing Xero contact "${candidates[0].Name}"`,
    })
  } else {
    const { data: contacts } = await admin
      .from('contacts')
      .select('email')
      .eq('client_id', clientId)
      .not('email', 'is', null)
      .order('name')
      .limit(1)
    const email = (contacts?.[0]?.email as string | undefined)?.trim() || undefined
    const created = await api.post<{ Contacts: XeroContact[] }>('/Contacts', {
      Contacts: [{ Name: client.name, ...(abn ? { TaxNumber: abn } : {}), ...(email ? { EmailAddress: email } : {}) }],
    })
    contactId = created.Contacts[0].ContactID
    await logEvent(admin, runId, {
      direction: 'push', entity: 'contact', entityId: clientId, xeroId: contactId,
      action: 'created', detail: `Created Xero contact "${client.name}"${email ? '' : ' (no email on file)'}`,
    })
  }

  await admin.from('clients').update({ xero_contact_id: contactId }).eq('id', clientId)
  await admin.from('xero_contacts').upsert(
    { contact_id: contactId, name: client.name, abn, has_email: true, status: 'ACTIVE', synced_at: new Date().toISOString() },
    { onConflict: 'contact_id' }
  )
  return contactId
}
```

- [ ] **Step 4: `tracking.ts`**

```ts
// src/lib/xero/tracking.ts
import { XeroApiError, type XeroApi } from './client'
import { loadMapping } from './mapping'
import type { TrackingRef } from './map'
import { logEvent, type Admin } from './register'
import type { XeroTrackingOption } from './types'

export type WorkRef = { kind: 'job' | 'project'; id: string; number: string }

/**
 * One tracking option per job/project number under the configured category
 * (spec §4 item 5). Returns null (and logs a warning) when no category is
 * configured or Xero refuses (e.g. the 100-option limit — VERIFY-3), so the
 * push continues without tracking.
 */
export async function ensureTrackingOption(
  admin: Admin,
  api: XeroApi,
  runId: string,
  work: WorkRef
): Promise<TrackingRef> {
  const mapping = await loadMapping(admin)
  if (!mapping.trackingCategoryId) return null
  const table = work.kind === 'job' ? 'jobs' : 'projects'

  const { data: row } = await admin.from(table).select('xero_tracking_option_id').eq('id', work.id).single()
  if (row?.xero_tracking_option_id) {
    return { categoryId: mapping.trackingCategoryId, optionId: row.xero_tracking_option_id as string }
  }

  // Reuse an option with the same name if the cache already knows it.
  const { data: cached } = await admin
    .from('xero_tracking_options')
    .select('id')
    .eq('category_id', mapping.trackingCategoryId)
    .eq('name', work.number)
    .maybeSingle()
  let optionId = cached?.id as string | undefined

  if (!optionId) {
    try {
      const res = await api.put<{ Options: XeroTrackingOption[] }>(
        `/TrackingCategories/${mapping.trackingCategoryId}/Options`,
        { Name: work.number }
      )
      optionId = res.Options[0].TrackingOptionID
      await admin.from('xero_tracking_options').upsert(
        { id: optionId, category_id: mapping.trackingCategoryId, name: work.number, status: 'ACTIVE', synced_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      await logEvent(admin, runId, {
        direction: 'push', entity: 'tracking', entityId: work.id, xeroId: optionId,
        action: 'created', detail: `Tracking option "${work.number}"`,
      })
    } catch (err) {
      const detail = err instanceof XeroApiError ? err.message : String(err)
      await logEvent(admin, runId, {
        direction: 'push', entity: 'tracking', entityId: work.id, action: 'warning',
        detail: `Could not create tracking option "${work.number}": ${detail}. Invoice pushed without tracking.`,
      })
      return null
    }
  }

  await admin.from(table).update({ xero_tracking_option_id: optionId }).eq('id', work.id)
  return { categoryId: mapping.trackingCategoryId, optionId }
}

/**
 * Archive options for jobs paid / projects closed more than 90 days ago
 * (spec §5.4 step 5). The only Xero mutation outside invoicing, and only on
 * options ECR created. Returns how many were archived.
 */
export async function archiveStaleTrackingOptions(admin: Admin, api: XeroApi, runId: string): Promise<number> {
  const mapping = await loadMapping(admin)
  if (!mapping.trackingCategoryId) return 0
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: jobs }, { data: projects }] = await Promise.all([
    admin.from('jobs').select('id, number, xero_tracking_option_id')
      .eq('status', 'paid').not('xero_tracking_option_id', 'is', null).lt('updated_at', cutoff),
    admin.from('projects').select('id, number, xero_tracking_option_id')
      .eq('status', 'closed').not('xero_tracking_option_id', 'is', null).lt('updated_at', cutoff),
  ])

  const stale = [...(jobs ?? []), ...(projects ?? [])] as { id: string; number: string; xero_tracking_option_id: string }[]
  let archived = 0
  for (const w of stale) {
    const { data: opt } = await admin.from('xero_tracking_options').select('status').eq('id', w.xero_tracking_option_id).maybeSingle()
    if (opt?.status === 'ARCHIVED') continue
    try {
      await api.post(`/TrackingCategories/${mapping.trackingCategoryId}/Options/${w.xero_tracking_option_id}`, { Status: 'ARCHIVED' })
      await admin.from('xero_tracking_options').update({ status: 'ARCHIVED' }).eq('id', w.xero_tracking_option_id)
      await logEvent(admin, runId, { direction: 'push', entity: 'tracking', entityId: w.id, xeroId: w.xero_tracking_option_id, action: 'archived', detail: w.number })
      archived++
    } catch (err) {
      await logEvent(admin, runId, { direction: 'push', entity: 'tracking', entityId: w.id, action: 'warning', detail: `Archive failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  return archived
}
```

Note: `jobs`/`projects` have no `updated_at` column in 0001. **Check** with `grep -n "updated_at" supabase/migrations/0001_schema.sql` — if absent, use `completed_at` for jobs and `practical_completion_date` for projects instead of `updated_at` in the two `.lt(...)` filters (both exist: `jobs.completed_at timestamptz`, `projects.practical_completion_date date`).

- [ ] **Step 5: Type check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/xero/mapping.ts src/lib/xero/reference.ts src/lib/xero/contacts.ts src/lib/xero/tracking.ts
git commit -m "feat(xero): reference cache, contact linking/creation, per-job tracking options

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 11: `push.ts` + wire into invoice and claim actions

**Files:**
- Create: `src/lib/xero/push.ts`
- Modify: `src/app/(office)/invoices/actions.ts` (`markInvoiceSent`, `voidInvoice`, `recordPayment`, `deletePayment`, `createInvoiceFromJob` line kinds, `updateInvoiceLine` kind; add `linkInvoiceToJob`)
- Modify: `src/app/(office)/projects/[id]/claims/actions.ts` (`certifyClaim`)
- Modify: `src/lib/zod.ts:462-467` (`kind` on `invoiceLineUpdateSchema`)

**Interfaces:**
- Consumes: `xeroApiForAdmin`, `XeroApiError` (Task 7); `startRun`/`logEvent`/`finishRun` (Task 7); `loadMapping` (Task 10); `ensureContactForClient` (Task 10); `ensureTrackingOption` (Task 10); `buildInvoicePayload`, `buildClaimPayload`, `claimInvoiceNumber`, `totalsDiffer` (Task 6); `docTotals` from `@/lib/money`; `getXeroStatus` (Task 8); `syncJobStatus` (Task 9).
- Produces: `pushInvoiceToXero(admin, invoiceId, actorId) → Promise<PushResult>`, `pushClaimToXero(admin, claimId, actorId) → Promise<PushResult>` where `PushResult = { ok: true; warnings: string[]; emailed: boolean } | { ok: false; error: string }`. Neither flips ECR status — the calling action does.

- [ ] **Step 1: `kind` in zod**

In `src/lib/zod.ts` replace `invoiceLineUpdateSchema`:

```ts
export const invoiceLineUpdateSchema = z.object({
  description: z.string(),
  qty: z.coerce.number().min(0),
  unit: z.string().min(1, 'Unit is required'),
  unit_sell: z.coerce.number().min(0),
  kind: z.enum(RATE_KINDS).nullable().optional(),
})
```

- [ ] **Step 2: Write `push.ts`**

```ts
// src/lib/xero/push.ts
import { docTotals } from '@/lib/money'
import { XeroApiError, xeroApiForAdmin } from './client'
import { ensureContactForClient } from './contacts'
import { buildClaimPayload, buildInvoicePayload, claimInvoiceNumber, totalsDiffer } from './map'
import { loadMapping } from './mapping'
import { finishRun, logEvent, startRun, type Admin } from './register'
import { ensureTrackingOption } from './tracking'
import type { XeroInvoice, XeroInvoicePayload } from './types'

export type PushResult =
  | { ok: true; warnings: string[]; emailed: boolean }
  | { ok: false; error: string }

type OnlineInvoiceResponse = { OnlineInvoices?: { OnlineInvoiceUrl?: string }[] }

/**
 * Shared push core (spec §5.2 steps 4–7). Idempotent: looks the invoice up by
 * number before creating, so a retry after a timeout adopts the existing one.
 * Email is attempted once (callers pass `alreadyEmailed`).
 */
async function pushPayload(
  admin: Admin,
  api: ReturnType<typeof xeroApiForAdmin>,
  runId: string,
  entity: 'invoice' | 'claim',
  entityId: string,
  payload: XeroInvoicePayload,
  opts: { knownXeroId: string | null; alreadyEmailed: boolean; emailMode: 'xero' | 'ecr'; ecrTotal: number }
): Promise<{ xero: XeroInvoice; onlineUrl: string | null; emailed: boolean; warnings: string[] }> {
  const warnings: string[] = []

  let xero: XeroInvoice | null = null
  if (opts.knownXeroId) {
    const { Invoices = [] } = await api.get<{ Invoices?: XeroInvoice[] }>(`/Invoices/${opts.knownXeroId}`)
    xero = Invoices[0] ?? null
  }
  if (!xero) {
    const { Invoices = [] } = await api.get<{ Invoices?: XeroInvoice[] }>(
      `/Invoices?InvoiceNumbers=${encodeURIComponent(payload.InvoiceNumber)}`
    )
    xero = Invoices.find((i) => i.Status !== 'DELETED' && i.Status !== 'VOIDED') ?? null
    if (xero) {
      await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'matched', detail: `Adopted existing Xero invoice ${payload.InvoiceNumber}` })
    }
  }
  if (!xero) {
    const created = await api.post<{ Invoices: XeroInvoice[] }>('/Invoices', { Invoices: [payload] })
    xero = created.Invoices[0]
    await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'created', detail: `${payload.InvoiceNumber} → Xero` })
  }

  if (totalsDiffer(opts.ecrTotal, xero.Total)) {
    const w = `Xero total ${xero.Total?.toFixed(2)} differs from ECR total ${opts.ecrTotal.toFixed(2)} (GST rounding).`
    warnings.push(w)
    await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'warning', detail: w })
  }

  let onlineUrl: string | null = null
  try {
    const res = await api.get<OnlineInvoiceResponse>(`/Invoices/${xero.InvoiceID}/OnlineInvoice`)
    onlineUrl = res.OnlineInvoices?.[0]?.OnlineInvoiceUrl ?? null
  } catch (err) {
    warnings.push(`Pay-now link unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }

  let emailed = opts.alreadyEmailed
  if (!emailed && opts.emailMode === 'xero') {
    try {
      await api.postNoContent(`/Invoices/${xero.InvoiceID}/Email`)
      emailed = true
    } catch (err) {
      const w = `Xero could not email the invoice: ${err instanceof XeroApiError ? err.message : String(err)}. Add an email to the contact in Xero, or send ECR's PDF.`
      warnings.push(w)
      await logEvent(admin, runId, { direction: 'push', entity, entityId, xeroId: xero.InvoiceID, action: 'warning', detail: w })
    }
  }

  return { xero, onlineUrl, emailed, warnings }
}

export async function pushInvoiceToXero(admin: Admin, invoiceId: string, actorId: string | null): Promise<PushResult> {
  const runId = await startRun(admin, 'push', actorId)
  try {
    const [{ data: inv }, { data: lines }, mapping] = await Promise.all([
      admin
        .from('invoices')
        .select('id, number, status, issue_date, due_date, gst_rate, client_id, job_id, xero_invoice_id, xero_emailed_at, clients(payment_terms_days), jobs(id, number, title)')
        .eq('id', invoiceId)
        .single(),
      admin.from('invoice_lines').select('description, qty, unit_sell, kind').eq('invoice_id', invoiceId).order('position'),
      loadMapping(admin),
    ])
    if (!inv) return { ok: false, error: 'Invoice not found' }
    const client = inv.clients as unknown as { payment_terms_days: number | null } | null
    const job = inv.jobs as unknown as { id: string; number: string; title: string } | null

    const api = xeroApiForAdmin(admin)
    const contactId = await ensureContactForClient(admin, api, runId, inv.client_id as string)
    const tracking = job ? await ensureTrackingOption(admin, api, runId, { kind: 'job', id: job.id, number: job.number }) : null

    const ecrLines = (lines ?? []).map((l) => ({
      description: l.description as string,
      qty: Number(l.qty),
      unit_sell: Number(l.unit_sell),
      kind: (l.kind as string | null) ?? null,
    }))
    const payload = buildInvoicePayload(
      {
        number: inv.number as string,
        issue_date: inv.issue_date as string,
        due_date: (inv.due_date as string | null) ?? null,
        gst_rate: Number(inv.gst_rate),
        payment_terms_days: client?.payment_terms_days ?? 30,
        job_number: job?.number ?? null,
        job_title: job?.title ?? null,
        lines: ecrLines,
      },
      mapping,
      contactId,
      tracking
    )
    const { total } = docTotals(ecrLines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })), Number(inv.gst_rate))

    const r = await pushPayload(admin, api, runId, 'invoice', invoiceId, payload, {
      knownXeroId: (inv.xero_invoice_id as string | null) ?? null,
      alreadyEmailed: Boolean(inv.xero_emailed_at),
      emailMode: mapping.emailMode,
      ecrTotal: total,
    })

    const { error } = await admin
      .from('invoices')
      .update({
        xero_invoice_id: r.xero.InvoiceID,
        xero_number: r.xero.InvoiceNumber ?? null,
        xero_status: r.xero.Status,
        xero_total: r.xero.Total ?? null,
        xero_amount_paid: r.xero.AmountPaid ?? 0,
        xero_amount_credited: r.xero.AmountCredited ?? 0,
        xero_amount_due: r.xero.AmountDue ?? r.xero.Total ?? null,
        xero_online_url: r.onlineUrl,
        xero_pushed_at: new Date().toISOString(),
        xero_emailed_at: r.emailed ? (inv.xero_emailed_at ?? new Date().toISOString()) : null,
        xero_synced_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
    if (error) throw new Error(`Xero invoice created but ECR could not record it: ${error.message}`)

    await finishRun(admin, runId, { status: r.warnings.length ? 'partial' : 'success', pushed: 1, warnings: r.warnings.length })
    return { ok: true, warnings: r.warnings, emailed: r.emailed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logEvent(admin, runId, { direction: 'push', entity: 'invoice', entityId: invoiceId, action: 'failed', detail: message })
    await finishRun(admin, runId, { status: 'failed', errors: 1, error: message })
    return { ok: false, error: message }
  }
}

export async function pushClaimToXero(admin: Admin, claimId: string, actorId: string | null): Promise<PushResult> {
  const runId = await startRun(admin, 'push', actorId)
  try {
    const [{ data: claim }, mapping] = await Promise.all([
      admin
        .from('claims')
        .select('id, number, status, reference_date, certified_amount, xero_invoice_id, projects(id, number, name, client_id, clients(payment_terms_days))')
        .eq('id', claimId)
        .single(),
      loadMapping(admin),
    ])
    if (!claim) return { ok: false, error: 'Claim not found' }
    if (claim.certified_amount == null) return { ok: false, error: 'Claim has no certified amount' }
    const project = claim.projects as unknown as {
      id: string; number: string; name: string; client_id: string
      clients: { payment_terms_days: number | null } | null
    }

    const api = xeroApiForAdmin(admin)
    const contactId = await ensureContactForClient(admin, api, runId, project.client_id)
    const tracking = await ensureTrackingOption(admin, api, runId, { kind: 'project', id: project.id, number: project.number })
    const certified = Number(claim.certified_amount)
    const payload = buildClaimPayload(
      {
        project_number: project.number,
        project_name: project.name,
        claim_number: Number(claim.number),
        certified_amount: certified,
        reference_date: claim.reference_date as string,
        payment_terms_days: project.clients?.payment_terms_days ?? 30,
      },
      mapping,
      contactId,
      tracking
    )

    const r = await pushPayload(admin, api, runId, 'claim', claimId, payload, {
      knownXeroId: (claim.xero_invoice_id as string | null) ?? null,
      alreadyEmailed: false,
      emailMode: mapping.emailMode,
      ecrTotal: certified,
    })

    const { error } = await admin
      .from('claims')
      .update({
        xero_invoice_id: r.xero.InvoiceID,
        xero_status: r.xero.Status,
        xero_amount_due: r.xero.AmountDue ?? r.xero.Total ?? null,
        xero_online_url: r.onlineUrl,
        xero_pushed_at: new Date().toISOString(),
        xero_synced_at: new Date().toISOString(),
      })
      .eq('id', claimId)
    if (error) throw new Error(`Xero invoice created but ECR could not record it: ${error.message}`)

    await finishRun(admin, runId, { status: r.warnings.length ? 'partial' : 'success', pushed: 1, warnings: r.warnings.length })
    return { ok: true, warnings: r.warnings, emailed: r.emailed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logEvent(admin, runId, { direction: 'push', entity: 'claim', entityId: claimId, action: 'failed', detail: message })
    await finishRun(admin, runId, { status: 'failed', errors: 1, error: message })
    return { ok: false, error: message }
  }
}

export { claimInvoiceNumber }
```

- [ ] **Step 3: `markInvoiceSent` pushes when connected**

In `src/app/(office)/invoices/actions.ts` add imports:

```ts
import { createAdminClient } from '@/lib/supabase/server'
import { getXeroStatus } from '@/lib/xero/status'
import { pushInvoiceToXero } from '@/lib/xero/push'
```

Change the signature and body of `markInvoiceSent` so the return type is `Promise<Result & { warnings?: string[]; viaXero?: boolean }>` and, after the `issueProblem` guard and before the status update, insert:

```ts
  // Xero connected → the invoice is created + emailed by Xero FIRST; only a
  // successful push flips ECR to 'sent' (spec §5.2). Failure leaves a draft.
  const xero = await getXeroStatus()
  let warnings: string[] = []
  let emailedByXero = false
  if (xero.connected) {
    const pushed = await pushInvoiceToXero(createAdminClient(), id, profile.id)
    if (!pushed.ok) return { error: `Xero: ${pushed.error}` }
    warnings = pushed.warnings
    emailedByXero = pushed.emailed
  }
```

`profile` comes from changing the first line to `const profile = await requireRole('admin', 'office')`. Change the existing `after(() => notifyClientInvoiceSent({ invoiceId: id }))` to run unconditionally (the portal deep-link email is still useful), and change the final `return {}` to `return { warnings, viaXero: xero.connected && emailedByXero }`.

- [ ] **Step 4: Guards on Xero-linked invoices**

In `voidInvoice`, `recordPayment` and `deletePayment`, extend the invoice `select` with `xero_invoice_id` and, straight after the `if (!invoice) return { error: 'Invoice not found' }` line, add:

```ts
  if (invoice.xero_invoice_id) {
    return { error: 'Managed in Xero — record payments, credits and voids in Xero; ECR picks them up on the next sync.' }
  }
```

(In `deletePayment` the invoice is loaded from `payment.invoice_id`; also block when `payment.source === 'xero'` by adding `source` to the payment select and returning the same message.)

- [ ] **Step 5: Carry `kind` from quote lines; allow editing it**

In `createInvoiceFromJob`: change the `lines` type to include `kind: string | null`, add `kind` to the `quote_lines` select (`'section_id, position, description, qty, unit, unit_sell, kind'`), map `kind: (l.kind as string | null) ?? null` in the quote branch and `kind: null` in the costs branch. `updateInvoiceLine` already spreads `parsed.data` into the update — verify with `grep -n "parsed.data" "src/app/(office)/invoices/actions.ts"`; if it lists columns explicitly, add `kind: parsed.data.kind ?? null`.

- [ ] **Step 6: `linkInvoiceToJob` for the Needs-matching queue**

Append to `invoices/actions.ts`:

```ts
/** Needs-matching queue (Money page): attach a Xero-raised mirror to a job. */
export async function linkInvoiceToJob(invoiceId: string, jobId: string | null): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const supabase = await createClient()
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, origin, client_id, job_id')
    .eq('id', invoiceId)
    .single()
  if (!invoice) return { error: 'Invoice not found' }
  if (invoice.origin !== 'xero') return { error: 'Only invoices raised in Xero can be re-matched' }

  if (jobId) {
    const { data: job } = await supabase.from('jobs').select('id, client_id').eq('id', jobId).single()
    if (!job) return { error: 'Job not found' }
    if (job.client_id !== invoice.client_id) return { error: 'That job belongs to a different client' }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ job_id: jobId, needs_review: false })
    .eq('id', invoiceId)
  if (error) return { error: error.message }

  await syncJobStatus(supabase, invoice.job_id as string | null)
  await syncJobStatus(supabase, jobId)

  try {
    const admin = createAdminClient()
    const { startRun, logEvent, finishRun } = await import('@/lib/xero/register')
    const runId = await startRun(admin, 'manual', profile.id)
    await logEvent(admin, runId, { direction: 'pull', entity: 'invoice', entityId: invoiceId, action: 'matched', detail: jobId ? `Linked to job by ${profile.full_name}` : `Unlinked by ${profile.full_name}` })
    await finishRun(admin, runId, { status: 'success' })
  } catch {
    // Register write is best-effort here (local dev has no service role).
  }

  revalidateInvoice(invoiceId, jobId ?? invoice.job_id)
  return {}
}
```

- [ ] **Step 7: `certifyClaim` pushes after certifying**

In `claims/actions.ts` add imports `createAdminClient` from `@/lib/supabase/server`, `getXeroStatus` from `@/lib/xero/status`, `pushClaimToXero` from `@/lib/xero/push`. Change `certifyClaim` to `const profile = await requireRole('admin', 'office')`, its return type to `Promise<Result & { warnings?: string[] }>`, and after the successful `update(...)` + before `revalidateClaim`:

```ts
  // Certification is a fact — it stands even if Xero is unreachable. The Xero
  // tab lists un-pushed certified claims with a Retry (spec §5.3).
  const xero = await getXeroStatus()
  if (xero.connected) {
    const pushed = await pushClaimToXero(createAdminClient(), claimId, profile.id)
    revalidateClaim(projectId, claimId)
    if (!pushed.ok) return { error: `Certified, but not in Xero yet: ${pushed.error}` }
    return { warnings: pushed.warnings }
  }
```

Also in `markClaimPaid`: select `xero_invoice_id` and return `{ error: 'Managed in Xero — mark the payment in Xero; ECR picks it up on the next sync.' }` when set.

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=1`
Expected: clean; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/xero/push.ts src/lib/zod.ts "src/app/(office)/invoices/actions.ts" "src/app/(office)/projects/[id]/claims/actions.ts"
git commit -m "feat(xero): send invoices and certified claims via Xero; guard Xero-managed records; link mirrors to jobs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 12: `pull.ts` — `runXeroSync` + cron hook

**Files:**
- Create: `src/lib/xero/pull.ts`
- Modify: `src/app/api/cron/notify/route.ts:55-63`

**Interfaces:**
- Consumes: `xeroApiForAdmin`, `XeroRateLimitError` (Task 7); register fns (Task 7); `loadConnection`, `getValidAccessToken` (Task 7); `syncReferenceData` (Task 10); `syncContacts` (Task 10); `archiveStaleTrackingOptions` (Task 10); mappers (Task 6); `syncJobStatus` (Task 9).
- Produces: `runXeroSync(admin, opts: { trigger: 'cron'|'manual'; createdBy?: string | null }) → Promise<SyncSummary>` with `SyncSummary = { skipped?: string; runId?: string; status?: 'success'|'partial'|'failed'; invoices_pulled: number; invoices_created: number; payments_upserted: number; contacts_linked: number; warnings: number; errors: number }`.

- [ ] **Step 1: Write `pull.ts`**

```ts
// src/lib/xero/pull.ts
import { syncJobStatus } from '@/lib/job-status'
import { XeroRateLimitError, xeroApiForAdmin, type XeroApi } from './client'
import { syncContacts } from './contacts'
import {
  deriveInvoiceStatusFromXero,
  ifModifiedSinceHeader,
  parseXeroDate,
  parseXeroInstant,
  workNumberFromReference,
  xeroLinesToInvoiceLines,
} from './map'
import { finishRun, logEvent, runInProgress, startRun, type Admin } from './register'
import { syncReferenceData } from './reference'
import { loadConnection, getValidAccessToken } from './tokens'
import { archiveStaleTrackingOptions } from './tracking'
import type { XeroInvoice, XeroPayment } from './types'

export type SyncSummary = {
  skipped?: string
  runId?: string
  status?: 'success' | 'partial' | 'failed'
  invoices_pulled: number
  invoices_created: number
  payments_upserted: number
  contacts_linked: number
  warnings: number
  errors: number
}

const PAGE = 100
const FIRST_RUN_LOOKBACK_DAYS = 365
const OVERLAP_MS = 60 * 60 * 1000

function zero(): SyncSummary {
  return { invoices_pulled: 0, invoices_created: 0, payments_upserted: 0, contacts_linked: 0, warnings: 0, errors: 0 }
}

async function* pages<T>(api: XeroApi, base: string, key: string, since: string | null): AsyncGenerator<T[]> {
  for (let page = 1; ; page++) {
    const sep = base.includes('?') ? '&' : '?'
    const path = `${base}${sep}page=${page}` + (since ? `&If-Modified-Since=${ifModifiedSinceHeader(since)}` : '')
    const body = await api.get<Record<string, T[] | undefined>>(path)
    const rows = body[key] ?? []
    yield rows
    if (rows.length < PAGE) return
  }
}

/**
 * Nightly / on-demand pull (spec §5.4). Never deletes ECR rows except payments
 * the sync itself created (source='xero') that Xero has since deleted. Only
 * touches Xero-owned columns + status on linked records.
 */
export async function runXeroSync(
  admin: Admin,
  opts: { trigger: 'cron' | 'manual'; createdBy?: string | null }
): Promise<SyncSummary> {
  const conn = await loadConnection(admin)
  if (!conn || conn.status !== 'connected' || !conn.refresh_token_enc) {
    return { ...zero(), skipped: conn?.status === 'needs_reconnect' ? 'Xero needs reconnecting' : 'Xero not connected' }
  }
  if (await runInProgress(admin)) return { ...zero(), skipped: 'A sync is already running' }

  const runId = await startRun(admin, opts.trigger, opts.createdBy ?? null)
  const s: SyncSummary = { ...zero(), runId }
  const startedAt = new Date().toISOString()
  const since = conn.last_sync_at
    ? new Date(new Date(conn.last_sync_at).getTime() - OVERLAP_MS).toISOString()
    : new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const api = xeroApiForAdmin(admin)
  let status: 'success' | 'partial' | 'failed' = 'success'
  let fatal: string | null = null

  try {
    // 1. Token warm-up — refreshing here keeps the 60-day refresh token alive.
    await getValidAccessToken(admin, { forceRefresh: opts.trigger === 'cron' })

    // 2. Reference data + contacts.
    await syncReferenceData(admin, api, runId)
    const contacts = await syncContacts(admin, api, runId, conn.last_sync_at ? since : null)
    s.contacts_linked = contacts.linked

    // 3. Sales invoices changed since last sync.
    for await (const batch of pages<XeroInvoice>(
      api,
      `/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&Statuses=AUTHORISED,PAID,VOIDED`,
      'Invoices',
      since
    )) {
      for (const x of batch) {
        s.invoices_pulled++
        try {
          const outcome = await applyInvoice(admin, runId, x)
          if (outcome === 'created') s.invoices_created++
          if (outcome === 'warning') s.warnings++
        } catch (err) {
          s.errors++
          await logEvent(admin, runId, { direction: 'pull', entity: 'invoice', xeroId: x.InvoiceID, action: 'failed', detail: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    // 4. Payments on sales invoices.
    for await (const batch of pages<XeroPayment>(
      api,
      `/Payments?where=${encodeURIComponent('PaymentType=="ACCRECPAYMENT"')}`,
      'Payments',
      since
    )) {
      for (const p of batch) {
        try {
          if (await applyPayment(admin, runId, p)) s.payments_upserted++
        } catch (err) {
          s.errors++
          await logEvent(admin, runId, { direction: 'pull', entity: 'payment', xeroId: p.PaymentID, action: 'failed', detail: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    // 5. Tracking hygiene.
    await archiveStaleTrackingOptions(admin, api, runId)
  } catch (err) {
    fatal = err instanceof Error ? err.message : String(err)
    status = err instanceof XeroRateLimitError ? 'partial' : 'failed'
    s.errors++
    await logEvent(admin, runId, { direction: 'pull', entity: 'connection', action: 'failed', detail: fatal })
  }

  if (status === 'success' && (s.errors > 0 || s.warnings > 0)) status = 'partial'
  s.status = status

  await finishRun(admin, runId, {
    status,
    invoices_pulled: s.invoices_pulled,
    invoices_created: s.invoices_created,
    payments_upserted: s.payments_upserted,
    contacts_linked: s.contacts_linked,
    warnings: s.warnings,
    errors: s.errors,
    error: fatal,
  })
  // Only advance the watermark when the run got through the invoice/payment pages.
  await admin
    .from('xero_connection')
    .update({
      last_sync_at: status === 'failed' ? conn.last_sync_at : startedAt,
      last_sync_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  return s
}

// ─── Invoices ────────────────────────────────────────────────────────────────

type InvoiceOutcome = 'updated' | 'created' | 'skipped' | 'warning'

async function applyInvoice(admin: Admin, runId: string, x: XeroInvoice): Promise<InvoiceOutcome> {
  const now = new Date().toISOString()
  const xeroCols = {
    xero_status: x.Status,
    xero_total: x.Total ?? null,
    xero_amount_paid: x.AmountPaid ?? null,
    xero_amount_credited: x.AmountCredited ?? null,
    xero_amount_due: x.AmountDue ?? null,
    xero_synced_at: now,
  }

  // Known ECR invoice (pushed, or matched earlier)?
  const { data: known } = await admin
    .from('invoices')
    .select('id, status, job_id, number')
    .or(`xero_invoice_id.eq.${x.InvoiceID},number.eq.${JSON.stringify(x.InvoiceNumber ?? '')}`)
    .limit(1)
    .maybeSingle()

  if (known) {
    const derived = deriveInvoiceStatusFromXero(x)
    const statusChanged = known.status !== 'draft' && known.status !== derived.status
    const { error } = await admin
      .from('invoices')
      .update({
        ...xeroCols,
        xero_invoice_id: x.InvoiceID,
        xero_number: x.InvoiceNumber ?? null,
        ...(known.status !== 'draft' ? { status: derived.status, paid_at: derived.paid_at } : {}),
      })
      .eq('id', known.id)
    if (error) throw error
    if (statusChanged) {
      await syncJobStatus(admin, known.job_id as string | null)
      await logEvent(admin, runId, {
        direction: 'pull', entity: 'invoice', entityId: known.id as string, xeroId: x.InvoiceID,
        action: derived.status === 'void' ? 'voided' : 'updated', detail: `${known.number}: ${known.status} → ${derived.status}`,
      })
    }
    return 'updated'
  }

  // Known progress claim?
  const { data: claim } = await admin
    .from('claims')
    .select('id, status, project_id')
    .eq('xero_invoice_id', x.InvoiceID)
    .maybeSingle()
  if (claim) {
    const derived = deriveInvoiceStatusFromXero(x)
    const patch: Record<string, unknown> = {
      xero_status: x.Status, xero_amount_due: x.AmountDue ?? null, xero_synced_at: now,
    }
    if (derived.status === 'paid' && claim.status === 'certified') {
      patch.status = 'paid'
      patch.paid_at = derived.paid_at ?? now
      const { data: c } = await admin.from('claims').select('certified_amount, total_inc_gst').eq('id', claim.id).single()
      await admin.from('payments').insert({
        claim_id: claim.id, amount: Number(c?.certified_amount ?? c?.total_inc_gst ?? 0),
        date: (derived.paid_at ?? now).slice(0, 10), method: 'xero', reference: x.InvoiceNumber ?? null, source: 'xero',
      })
    }
    const { error } = await admin.from('claims').update(patch).eq('id', claim.id)
    if (error) throw error
    if (derived.status === 'void') {
      await logEvent(admin, runId, { direction: 'pull', entity: 'claim', entityId: claim.id as string, xeroId: x.InvoiceID, action: 'warning', detail: 'Voided in Xero — claim stays certified in ECR (no void state for claims)' })
      return 'warning'
    }
    return 'updated'
  }

  // Unknown → mirror (spec §5.4 step 3). Never mirror Xero drafts/deleted.
  if (x.Status === 'DRAFT' || x.Status === 'SUBMITTED' || x.Status === 'DELETED') return 'skipped'

  const contactId = x.Contact?.ContactID ?? null
  let clientId: string | null = null
  let needsReview = false
  if (contactId) {
    const { data: c } = await admin.from('clients').select('id').eq('xero_contact_id', contactId).maybeSingle()
    clientId = (c?.id as string | undefined) ?? null
  }
  if (!clientId) {
    // Create a client from name + ABN only (spec §3) and flag for review.
    const { data: cached } = contactId
      ? await admin.from('xero_contacts').select('name, abn').eq('contact_id', contactId).maybeSingle()
      : { data: null }
    const name = cached?.name ?? x.Contact?.Name ?? 'Unknown Xero contact'
    const { data: created, error } = await admin
      .from('clients')
      .insert({ name, abn: cached?.abn ?? null, type: 'other', xero_contact_id: contactId })
      .select('id')
      .single()
    if (error || !created) throw new Error(`Could not create client for Xero contact "${name}": ${error?.message}`)
    clientId = created.id as string
    needsReview = true
    await logEvent(admin, runId, { direction: 'pull', entity: 'contact', entityId: clientId, xeroId: contactId, action: 'created', detail: `Client "${name}" created from Xero — review` })
  }

  // Job match: tracking option → reference number.
  let jobId: string | null = null
  const optionIds = (x.LineItems ?? []).flatMap((l) => l.Tracking ?? []).map((t) => t.TrackingOptionID).filter(Boolean) as string[]
  if (optionIds.length > 0) {
    const { data: j } = await admin.from('jobs').select('id').in('xero_tracking_option_id', optionIds).eq('client_id', clientId).limit(1).maybeSingle()
    jobId = (j?.id as string | undefined) ?? null
  }
  if (!jobId) {
    const num = workNumberFromReference(x.Reference)
    if (num) {
      const { data: j } = await admin.from('jobs').select('id').eq('number', num).eq('client_id', clientId).maybeSingle()
      jobId = (j?.id as string | undefined) ?? null
    }
  }
  if (!jobId) needsReview = true

  const derived = deriveInvoiceStatusFromXero(x)
  let number = x.InvoiceNumber?.trim() || `XERO-${x.InvoiceID.slice(0, 8)}`
  const { data: clash } = await admin.from('invoices').select('id').eq('number', number).maybeSingle()
  if (clash) number = `${number} (Xero)` // VERIFY-1 fallback

  const { data: inv, error: invErr } = await admin
    .from('invoices')
    .insert({
      number,
      job_id: jobId,
      client_id: clientId,
      status: derived.status,
      issue_date: parseXeroDate(x.DateString ?? x.Date) ?? now.slice(0, 10),
      due_date: parseXeroDate(x.DueDateString ?? x.DueDate),
      gst_rate: 10,
      sent_at: parseXeroInstant(x.UpdatedDateUTC) ?? now,
      paid_at: derived.paid_at,
      origin: 'xero',
      xero_invoice_id: x.InvoiceID,
      xero_number: x.InvoiceNumber ?? null,
      needs_review: needsReview,
      ...xeroCols,
    })
    .select('id')
    .single()
  if (invErr || !inv) throw new Error(`Could not mirror ${number}: ${invErr?.message}`)

  const lines = xeroLinesToInvoiceLines(x.LineItems ?? []).map((l) => ({ ...l, invoice_id: inv.id }))
  if (lines.length > 0) {
    const { error } = await admin.from('invoice_lines').insert(lines)
    if (error) throw error
  }
  await syncJobStatus(admin, jobId)
  await logEvent(admin, runId, {
    direction: 'pull', entity: 'invoice', entityId: inv.id as string, xeroId: x.InvoiceID,
    action: jobId ? 'created' : 'unmatched',
    detail: jobId ? `Mirrored ${number} from Xero` : `Mirrored ${number} from Xero — needs matching to a job`,
  })
  return 'created'
}

// ─── Payments ────────────────────────────────────────────────────────────────

async function applyPayment(admin: Admin, runId: string, p: XeroPayment): Promise<boolean> {
  const xeroInvoiceId = p.Invoice?.InvoiceID
  if (!xeroInvoiceId) return false
  const { data: inv } = await admin.from('invoices').select('id').eq('xero_invoice_id', xeroInvoiceId).maybeSingle()
  if (!inv) return false // claims settle via the invoice status path

  if (p.Status === 'DELETED') {
    // Only rows the sync itself created may be removed (spec §5.4 step 4).
    const { count } = await admin.from('payments').delete({ count: 'exact' }).eq('xero_payment_id', p.PaymentID).eq('source', 'xero')
    if ((count ?? 0) > 0) {
      await logEvent(admin, runId, { direction: 'pull', entity: 'payment', entityId: inv.id as string, xeroId: p.PaymentID, action: 'voided', detail: 'Payment deleted in Xero' })
    }
    return (count ?? 0) > 0
  }

  const { error } = await admin.from('payments').upsert(
    {
      invoice_id: inv.id,
      xero_payment_id: p.PaymentID,
      source: 'xero',
      date: parseXeroDate(p.Date) ?? new Date().toISOString().slice(0, 10),
      amount: p.Amount ?? 0,
      method: 'xero',
      reference: p.Reference ?? null,
    },
    { onConflict: 'xero_payment_id' }
  )
  if (error) throw error
  return true
}
```

- [ ] **Step 2: Hook into the cron**

In `src/app/api/cron/notify/route.ts` add `import { runXeroSync } from '@/lib/xero/pull'` and replace the `try { const result = await runDailyDigests(admin) … }` block body with:

```ts
  try {
    const result = await runDailyDigests(admin)
    // Xero nightly pull rides this cron (Vercel Hobby allows two crons; both
    // are used). runXeroSync returns { skipped } when nothing is connected.
    let xero: unknown = null
    try {
      xero = await runXeroSync(admin, { trigger: 'cron' })
    } catch (err) {
      xero = { error: err instanceof Error ? err.message : String(err) }
      console.error('[notify] xero sync failed:', xero)
    }
    return NextResponse.json({ ok: true, ...result, xero })
  } catch (err) {
```

Raise `maxDuration` from `120` to `300`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/xero/pull.ts src/app/api/cron/notify/route.ts
git commit -m "feat(xero): nightly pull — paid/void state, payments, mirrored Xero invoices, tracking hygiene

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 13: Settings → Xero tab (actions + section + wiring)

**Files:**
- Create: `src/app/(office)/settings/xero-actions.ts`
- Create: `src/app/(office)/settings/xero-section.tsx`
- Modify: `src/app/(office)/settings/settings-tabs.tsx` (type, TABS, props, TabsContent)
- Modify: `src/app/(office)/settings/page.tsx` (VALID_TABS, data loads, props)
- Modify: `src/lib/zod.ts` (add `xeroMappingSchema`)

**Interfaces:**
- Consumes: `getXeroStatus` (Task 8); `runXeroSync` (Task 12); `pushClaimToXero` (Task 11); `clearConnection`, `deleteConnection`, `getValidAccessToken`, `loadConnection`, `storeTokenSet` (Task 7); `RATE_KINDS`.
- Produces (actions): `saveXeroMapping(data: unknown)`, `linkClientToXeroContact(clientId, contactId | null)`, `syncXeroNow()`, `disconnectXero()`, `confirmXeroOrgSwitch(typedName: string)`, `retryClaimPush(claimId)`; all `Promise<{ error?: string; summary?: string }>`.
- Produces (UI): `XeroSection` props type `XeroSectionProps` (below).

- [ ] **Step 1: zod schema**

Append to `src/lib/zod.ts` after the invoice section:

```ts
// ─── Xero mapping (Settings → Xero) ───────────────────────────────────────────

export const xeroMappingSchema = z.object({
  xero_email_mode: z.enum(['xero', 'ecr']),
  xero_default_account: optionalText.nullable(),
  xero_account_by_kind: z.record(z.enum(RATE_KINDS), z.string().min(1)).default({}),
  xero_claims_account: optionalText.nullable(),
  xero_gst_tax_type: z.string().min(1),
  xero_no_gst_tax_type: z.string().min(1),
  xero_tracking_category_id: optionalText.nullable(),
})
export type XeroMappingInput = z.infer<typeof xeroMappingSchema>
```

(`optionalText` already exists in zod.ts — confirm with `grep -n "const optionalText" src/lib/zod.ts`.)

- [ ] **Step 2: Actions**

```ts
// src/app/(office)/settings/xero-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { xeroMappingSchema } from '@/lib/zod'
import { runXeroSync } from '@/lib/xero/pull'
import { pushClaimToXero } from '@/lib/xero/push'
import { finishRun, logEvent, startRun } from '@/lib/xero/register'
import {
  clearConnection,
  deleteConnection,
  getValidAccessToken,
  loadConnection,
} from '@/lib/xero/tokens'

type Result = { error?: string; summary?: string }

function revalidateXero() {
  revalidatePath('/settings')
  revalidatePath('/money')
  revalidatePath('/')
}

function admin() {
  try {
    return createAdminClient()
  } catch {
    return null
  }
}

export async function saveXeroMapping(data: unknown): Promise<Result> {
  await requireRole('admin')
  const parsed = xeroMappingSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid mapping' }
  const supabase = await createClient()
  const { error } = await supabase.from('settings').update(parsed.data).eq('id', 1)
  if (error) return { error: error.message }
  revalidateXero()
  return {}
}

export async function linkClientToXeroContact(clientId: string, contactId: string | null): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const supabase = await createClient()
  const { error } = await supabase.from('clients').update({ xero_contact_id: contactId }).eq('id', clientId)
  if (error) return { error: error.message.includes('unique') ? 'That Xero contact is already linked to another client' : error.message }
  const a = admin()
  if (a) {
    const runId = await startRun(a, 'manual', profile.id)
    await logEvent(a, runId, { direction: 'pull', entity: 'contact', entityId: clientId, xeroId: contactId, action: contactId ? 'matched' : 'unmatched', detail: `Linked by ${profile.full_name}` })
    await finishRun(a, runId, { status: 'success' })
  }
  revalidateXero()
  return {}
}

export async function syncXeroNow(): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const s = await runXeroSync(a, { trigger: 'manual', createdBy: profile.id })
  revalidateXero()
  if (s.skipped) return { error: s.skipped }
  return {
    summary: `${s.status}: ${s.invoices_pulled} invoices checked, ${s.invoices_created} new from Xero, ${s.payments_upserted} payments, ${s.contacts_linked} contacts linked${s.errors ? `, ${s.errors} errors` : ''}`,
  }
}

export async function disconnectXero(): Promise<Result> {
  const profile = await requireRole('admin')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const conn = await loadConnection(a)
  try {
    if (conn?.connection_id && conn.refresh_token_enc) {
      const { accessToken } = await getValidAccessToken(a).catch(() => ({ accessToken: null }))
      if (accessToken) await deleteConnection(accessToken, conn.connection_id)
    }
  } catch (err) {
    console.error('[xero] remote disconnect failed:', err)
  }
  await clearConnection(a)
  const runId = await startRun(a, 'manual', profile.id)
  await logEvent(a, runId, { direction: 'push', entity: 'connection', action: 'updated', detail: `Disconnected by ${profile.full_name}` })
  await finishRun(a, runId, { status: 'success' })
  revalidateXero()
  return {}
}

/**
 * The callback stored tokens for a DIFFERENT org than before and left status
 * needs_reconnect. Typing the org name confirms: clear every link column that
 * pointed at the old org, empty the caches, then go live (spec §5.1).
 */
export async function confirmXeroOrgSwitch(typedName: string): Promise<Result> {
  const profile = await requireRole('admin')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const conn = await loadConnection(a)
  if (!conn || conn.status !== 'needs_reconnect' || !conn.refresh_token_enc || !conn.tenant_name) {
    return { error: 'No organisation switch is pending' }
  }
  if (typedName.trim().toLowerCase() !== conn.tenant_name.trim().toLowerCase()) {
    return { error: 'Organisation name does not match' }
  }

  const nulls = { xero_invoice_id: null, xero_number: null, xero_status: null, xero_total: null, xero_amount_paid: null, xero_amount_credited: null, xero_amount_due: null, xero_online_url: null, xero_pushed_at: null, xero_emailed_at: null, xero_synced_at: null }
  const steps = [
    a.from('invoices').update(nulls).not('xero_invoice_id', 'is', null),
    a.from('claims').update({ xero_invoice_id: null, xero_status: null, xero_amount_due: null, xero_online_url: null, xero_pushed_at: null, xero_synced_at: null }).not('xero_invoice_id', 'is', null),
    a.from('payments').update({ xero_payment_id: null }).not('xero_payment_id', 'is', null),
    a.from('clients').update({ xero_contact_id: null }).not('xero_contact_id', 'is', null),
    a.from('jobs').update({ xero_tracking_option_id: null }).not('xero_tracking_option_id', 'is', null),
    a.from('projects').update({ xero_tracking_option_id: null }).not('xero_tracking_option_id', 'is', null),
    a.from('xero_tracking_options').delete().neq('id', ''),
    a.from('xero_tracking_categories').delete().neq('id', ''),
    a.from('xero_accounts').delete().neq('code', ''),
    a.from('xero_tax_rates').delete().neq('tax_type', ''),
    a.from('xero_contacts').delete().neq('contact_id', ''),
    a.from('settings').update({ xero_default_account: null, xero_account_by_kind: {}, xero_claims_account: null, xero_tracking_category_id: null }).eq('id', 1),
  ]
  for (const step of steps) {
    const { error } = await step
    if (error) return { error: `Switch aborted: ${error.message}` }
  }
  await a.from('xero_connection').update({ status: 'connected', last_sync_at: null, last_sync_status: null, updated_at: new Date().toISOString() }).eq('id', 1)
  const runId = await startRun(a, 'manual', profile.id)
  await logEvent(a, runId, { direction: 'push', entity: 'connection', action: 'updated', detail: `Switched to organisation "${conn.tenant_name}" — all Xero links cleared by ${profile.full_name}` })
  await finishRun(a, runId, { status: 'success' })
  revalidateXero()
  return {}
}

export async function retryClaimPush(claimId: string): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const a = admin()
  if (!a) return { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment' }
  const r = await pushClaimToXero(a, claimId, profile.id)
  revalidateXero()
  return r.ok ? { summary: r.warnings.join(' ') || 'Claim is now in Xero' } : { error: r.error }
}
```

- [ ] **Step 3: Section UI**

```tsx
// src/app/(office)/settings/xero-section.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2Icon, Link2Icon, RefreshCwIcon, TriangleAlertIcon, UnplugIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RATE_KINDS, type RateKind } from '@/lib/zod'
import type { XeroStatus } from '@/lib/xero/status'
import { cn } from '@/lib/utils'
import {
  confirmXeroOrgSwitch,
  disconnectXero,
  linkClientToXeroContact,
  retryClaimPush,
  saveXeroMapping,
  syncXeroNow,
} from './xero-actions'

export interface XeroAccountRow { code: string; name: string; type: string; status: string | null }
export interface XeroTaxRateRow { tax_type: string; name: string; effective_rate: number | null }
export interface XeroTrackingCategoryRow { id: string; name: string; status: string | null }
export interface XeroContactRow { contact_id: string; name: string; abn: string | null; has_email: boolean }
export interface UnlinkedClientRow { id: string; name: string; abn: string | null }
export interface PendingClaimRow { id: string; project_id: string; project_number: string; number: number; certified_amount: number | null }
export interface XeroRunRow {
  id: string; started_at: string; finished_at: string | null; status: string; trigger: string
  invoices_pulled: number; invoices_created: number; payments_upserted: number; contacts_linked: number
  pushed: number; warnings: number; errors: number; error: string | null
}
export interface XeroEventRow {
  id: string; created_at: string; direction: string; entity: string; action: string; detail: string | null; xero_id: string | null
}
export interface XeroMappingRow {
  xero_email_mode: 'xero' | 'ecr'
  xero_default_account: string | null
  xero_account_by_kind: Record<string, string>
  xero_claims_account: string | null
  xero_gst_tax_type: string
  xero_no_gst_tax_type: string
  xero_tracking_category_id: string | null
}

export interface XeroSectionProps {
  status: XeroStatus
  flag: string | null
  mapping: XeroMappingRow
  accounts: XeroAccountRow[]
  taxRates: XeroTaxRateRow[]
  trackingCategories: XeroTrackingCategoryRow[]
  contacts: XeroContactRow[]
  unlinkedClients: UnlinkedClientRow[]
  pendingClaims: PendingClaimRow[]
  runs: XeroRunRow[]
  events: XeroEventRow[]
  isAdmin: boolean
}

const KIND_LABELS: Record<RateKind, string> = {
  labour: 'Labour', plant: 'Plant', material: 'Materials', subbie: 'Subcontract', other: 'Other',
}
const NONE = '__none__'

const FLAG_COPY: Record<string, { tone: 'ok' | 'warn'; text: string }> = {
  connected: { tone: 'ok', text: 'Connected to Xero. Run a sync to load accounts, tax rates and contacts.' },
  switched: { tone: 'warn', text: 'This is a different Xero organisation than before. Confirm below to clear the old links.' },
  denied: { tone: 'warn', text: 'Xero access was declined.' },
  state: { tone: 'warn', text: 'The connection attempt could not be verified (state mismatch or expired). Try again.' },
  failed: { tone: 'warn', text: 'Xero did not complete the connection. Check the Client id / secret in Vercel and try again.' },
  multitenant: { tone: 'warn', text: 'You approved more than one organisation. Disconnect the extras in Xero (Settings → Connected apps) and connect again with just one.' },
  notenant: { tone: 'warn', text: 'No organisation was authorised.' },
  unconfigured: { tone: 'warn', text: 'XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_TOKEN_KEY are missing from the environment.' },
  noservicerole: { tone: 'warn', text: 'SUPABASE_SERVICE_ROLE_KEY is missing — the connection cannot be stored.' },
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'short', timeStyle: 'short' })
}

export function XeroSection(p: XeroSectionProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const flag = p.flag ? FLAG_COPY[p.flag] : null

  function run(fn: () => Promise<{ error?: string; summary?: string }>, ok: string) {
    start(async () => {
      const r = await fn()
      if (r.error) toast.error(r.error)
      else toast.success(r.summary ?? ok)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {flag && (
        <div className={cn('flex items-start gap-3 rounded-xl border p-4 text-sm', flag.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
          {flag.tone === 'ok' ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> : <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />}
          <p>{flag.text}</p>
        </div>
      )}

      <ConnectionCard status={p.status} isAdmin={p.isAdmin} pending={pending} onSync={() => run(syncXeroNow, 'Sync complete')} onDisconnect={() => { if (confirm('Disconnect ECR from Xero? Existing links are kept; nothing syncs until you reconnect.')) run(disconnectXero, 'Disconnected from Xero') }} onConfirmSwitch={(name) => run(() => confirmXeroOrgSwitch(name), 'Switched organisation — all old Xero links cleared')} />

      {p.status.connected && (
        <>
          <MappingForm mapping={p.mapping} accounts={p.accounts} taxRates={p.taxRates} categories={p.trackingCategories} disabled={!p.isAdmin || pending} onSave={(data) => run(() => saveXeroMapping(data), 'Xero mapping saved')} />
          <UnlinkedClients clients={p.unlinkedClients} contacts={p.contacts} pending={pending} onLink={(c, x) => run(() => linkClientToXeroContact(c, x), 'Client linked')} />
          {p.pendingClaims.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">Certified claims not yet in Xero</h2>
              <div className="rounded-xl border">
                <Table>
                  <TableHeader><TableRow><TableHead>Claim</TableHead><TableHead className="text-right">Certified</TableHead><TableHead className="w-28" /></TableRow></TableHeader>
                  <TableBody>
                    {p.pendingClaims.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{`${c.project_number} · PC-${c.number}`}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.certified_amount != null ? c.certified_amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }) : '—'}</TableCell>
                        <TableCell className="text-right"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryClaimPush(c.id), 'Claim pushed to Xero')}>Retry</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </>
      )}

      <Register runs={p.runs} events={p.events} />
    </div>
  )
}

function ConnectionCard({ status, isAdmin, pending, onSync, onDisconnect, onConfirmSwitch }: {
  status: XeroStatus; isAdmin: boolean; pending: boolean
  onSync: () => void; onDisconnect: () => void; onConfirmSwitch: (name: string) => void
}) {
  const [typed, setTyped] = useState('')
  const tone = status.connected ? 'ok' : status.status === 'needs_reconnect' ? 'bad' : 'muted'
  return (
    <section className={cn('flex flex-col gap-3 rounded-xl border p-4', tone === 'bad' && 'border-red-300 bg-red-50/50')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Xero connection</h2>
          {!status.available ? (
            <p className="text-sm text-amber-700">{status.reason}</p>
          ) : status.connected ? (
            <p className="text-sm text-muted-foreground">{`Connected to ${status.tenantName ?? 'Xero'} since ${fmtWhen(status.connectedAt)} · last sync ${fmtWhen(status.lastSyncAt)}${status.lastSyncStatus ? ` (${status.lastSyncStatus})` : ''}`}</p>
          ) : status.pendingOrgSwitch ? (
            <p className="text-sm text-red-700">{`Tokens received for "${status.pendingOrgSwitch.tenantName}", which is a different organisation than before.`}</p>
          ) : status.status === 'needs_reconnect' ? (
            <p className="text-sm text-red-700">Xero access expired or was revoked. Reconnect to resume sending and syncing.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Not connected. Connecting opens Xero&apos;s own login — no Xero password is stored in ECR.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status.available && status.connected && (
            <Button variant="outline" disabled={pending} onClick={onSync}><RefreshCwIcon className={cn(pending && 'animate-spin')} />Sync now</Button>
          )}
          {status.available && isAdmin && !status.pendingOrgSwitch && (
            status.connected ? (
              <Button variant="outline" className="text-destructive border-destructive/50" disabled={pending} onClick={onDisconnect}><UnplugIcon />Disconnect</Button>
            ) : (
              <a href="/api/xero/connect" className={cn(buttonVariants())}><Link2Icon />{status.status === 'needs_reconnect' ? 'Reconnect to Xero' : 'Connect to Xero'}</a>
            )
          )}
        </div>
      </div>
      {status.pendingOrgSwitch && isAdmin && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-white p-3 text-sm">
          <p>Confirming will <strong>clear every Xero link</strong> on invoices, claims, payments, clients, jobs and projects (they belonged to the previous organisation) and empty the cached accounts and contacts. The sync register is kept. Type the organisation name to confirm.</p>
          <div className="flex flex-wrap gap-2">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={status.pendingOrgSwitch.tenantName} className="max-w-xs" />
            <Button variant="destructive" disabled={pending || typed.trim().length === 0} onClick={() => onConfirmSwitch(typed)}>Switch organisation</Button>
          </div>
        </div>
      )}
    </section>
  )
}

function MappingForm({ mapping, accounts, taxRates, categories, disabled, onSave }: {
  mapping: XeroMappingRow; accounts: XeroAccountRow[]; taxRates: XeroTaxRateRow[]; categories: XeroTrackingCategoryRow[]
  disabled: boolean; onSave: (data: XeroMappingRow) => void
}) {
  const [m, setM] = useState<XeroMappingRow>(mapping)
  const active = accounts.filter((a) => a.status !== 'ARCHIVED')
  const cats = categories.filter((c) => c.status !== 'ARCHIVED')
  const set = <K extends keyof XeroMappingRow>(k: K, v: XeroMappingRow[K]) => setM((prev) => ({ ...prev, [k]: v }))

  const AccountSelect = ({ id, value, onChange, allowNone }: { id: string; value: string | null; onChange: (v: string | null) => void; allowNone: boolean }) => (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE || v == null ? null : String(v))}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>Use default</SelectItem>}
        {!allowNone && <SelectItem value={NONE}>— choose —</SelectItem>}
        {active.map((a) => <SelectItem key={a.code} value={a.code}>{`${a.code} · ${a.name}`}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-base font-semibold">Account &amp; tax mapping</h2>
      {active.length === 0 && <p className="text-sm text-amber-700">No accounts cached yet — run a sync first.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5"><Label htmlFor="x-default">Default income account</Label><AccountSelect id="x-default" value={m.xero_default_account} onChange={(v) => set('xero_default_account', v)} allowNone={false} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="x-claims">Progress claims account</Label><AccountSelect id="x-claims" value={m.xero_claims_account} onChange={(v) => set('xero_claims_account', v)} allowNone={false} /></div>
        {RATE_KINDS.map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <Label htmlFor={`x-kind-${k}`}>{`${KIND_LABELS[k]} lines`}</Label>
            <AccountSelect id={`x-kind-${k}`} value={m.xero_account_by_kind[k] ?? null} allowNone onChange={(v) => { const next = { ...m.xero_account_by_kind }; if (v) next[k] = v; else delete next[k]; set('xero_account_by_kind', next) }} />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-gst">GST tax rate</Label>
          <Select value={m.xero_gst_tax_type} onValueChange={(v) => set('xero_gst_tax_type', String(v ?? 'OUTPUT'))}>
            <SelectTrigger id="x-gst" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{taxRates.map((t) => <SelectItem key={t.tax_type} value={t.tax_type}>{`${t.name}${t.effective_rate != null ? ` (${t.effective_rate}%)` : ''}`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-nogst">No-GST tax rate (0% invoices)</Label>
          <Select value={m.xero_no_gst_tax_type} onValueChange={(v) => set('xero_no_gst_tax_type', String(v ?? 'EXEMPTOUTPUT'))}>
            <SelectTrigger id="x-nogst" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{taxRates.map((t) => <SelectItem key={t.tax_type} value={t.tax_type}>{`${t.name}${t.effective_rate != null ? ` (${t.effective_rate}%)` : ''}`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-tracking">Tracking category used for the job number</Label>
          <Select value={m.xero_tracking_category_id ?? NONE} onValueChange={(v) => set('xero_tracking_category_id', v === NONE || v == null ? null : String(v))}>
            <SelectTrigger id="x-tracking" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No tracking</SelectItem>
              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Xero allows two active categories with 100 options each. ECR archives options for jobs paid more than 90 days ago.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-email">Who emails the client</Label>
          <Select value={m.xero_email_mode} onValueChange={(v) => set('xero_email_mode', (v as 'xero' | 'ecr') ?? 'xero')}>
            <SelectTrigger id="x-email" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="xero">Xero emails the invoice (Xero template, pay-now link)</SelectItem>
              <SelectItem value="ecr">I send ECR&apos;s PDF myself (Xero still records the invoice)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div><Button disabled={disabled} onClick={() => onSave(m)}>Save mapping</Button></div>
    </section>
  )
}

function UnlinkedClients({ clients, contacts, pending, onLink }: {
  clients: UnlinkedClientRow[]; contacts: XeroContactRow[]; pending: boolean
  onLink: (clientId: string, contactId: string | null) => void
}) {
  const [choice, setChoice] = useState<Record<string, string>>({})
  if (clients.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Clients without a Xero contact</h2>
      <p className="text-sm text-muted-foreground">Matched automatically by ABN, then exact name. Pick the contact for the rest, or leave them — a contact is created on their first invoice.</p>
      <div className="rounded-xl border">
        <Table>
          <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>ABN</TableHead><TableHead>Xero contact</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{c.abn ?? '—'}</TableCell>
                <TableCell>
                  <select aria-label={`Xero contact for ${c.name}`} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-sm" value={choice[c.id] ?? ''} onChange={(e) => setChoice((prev) => ({ ...prev, [c.id]: e.target.value }))}>
                    <option value="">— choose —</option>
                    {contacts.map((x) => <option key={x.contact_id} value={x.contact_id}>{`${x.name}${x.abn ? ` · ${x.abn}` : ''}`}</option>)}
                  </select>
                </TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" disabled={pending || !choice[c.id]} onClick={() => onLink(c.id, choice[c.id])}>Link</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

const RUN_BADGE: Record<string, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
}

function Register({ runs, events }: { runs: XeroRunRow[]; events: XeroEventRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Sync register</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No syncs or pushes yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Checked</TableHead><TableHead className="text-right">New</TableHead><TableHead className="text-right">Payments</TableHead><TableHead className="text-right">Pushed</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{fmtWhen(r.started_at)}</TableCell>
                  <TableCell>{r.trigger}</TableCell>
                  <TableCell><Badge variant="outline" className={RUN_BADGE[r.status] ?? ''}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoices_pulled}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoices_created}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.payments_upserted}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.pushed}</TableCell>
                  <TableCell className="max-w-80 truncate text-xs text-muted-foreground">{r.error ?? (r.warnings ? `${r.warnings} warning(s)` : '—')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {events.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Dir</TableHead><TableHead>Entity</TableHead><TableHead>Action</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{fmtWhen(e.created_at)}</TableCell>
                  <TableCell>{e.direction}</TableCell>
                  <TableCell>{e.entity}</TableCell>
                  <TableCell><Badge variant="outline" className={e.action === 'failed' ? RUN_BADGE.failed : e.action === 'warning' || e.action === 'unmatched' ? RUN_BADGE.partial : ''}>{e.action}</Badge></TableCell>
                  <TableCell className="max-w-96 truncate text-xs text-muted-foreground">{e.detail ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Register the tab**

In `settings-tabs.tsx`: add `| 'xero'` to `SettingsTab`; add `{ value: 'xero', label: 'Xero' }` after the `email` entry in `TABS`; import `{ XeroSection, type XeroSectionProps } from './xero-section'`; add `xero: XeroSectionProps` to `SettingsTabsProps` and destructuring; add:

```tsx
      <TabsContent value="xero" className="pt-4">
        <XeroSection {...xero} />
      </TabsContent>
```

In `page.tsx`: add `'xero'` to `VALID_TABS`; widen `searchParams` to `Promise<{ tab?: string; xero?: string }>` and read `const { tab, xero: xeroFlag } = await searchParams`; import `getXeroStatus` from `@/lib/xero/status`; add these loads to the big `Promise.all` (they read through the admin's RLS session, which the 0063 policies allow):

```ts
    supabase.from('xero_accounts').select('code, name, type, status').order('code'),
    supabase.from('xero_tax_rates').select('tax_type, name, effective_rate').order('name'),
    supabase.from('xero_tracking_categories').select('id, name, status').order('name'),
    supabase.from('xero_contacts').select('contact_id, name, abn, has_email').neq('status', 'ARCHIVED').order('name'),
    supabase.from('clients').select('id, name, abn').is('xero_contact_id', null).eq('archived', false).order('name'),
    supabase.from('claims').select('id, project_id, number, certified_amount, projects(number)').in('status', ['certified', 'paid']).is('xero_invoice_id', null).order('certified_at', { ascending: false }),
    supabase.from('xero_sync_runs').select('*').order('started_at', { ascending: false }).limit(20),
    supabase.from('xero_sync_events').select('id, created_at, direction, entity, action, detail, xero_id').order('created_at', { ascending: false }).limit(50),
```

destructure them as `{ data: xeroAccounts }, { data: xeroTaxRates }, { data: xeroCategories }, { data: xeroContacts }, { data: xeroUnlinked }, { data: xeroPendingClaims }, { data: xeroRuns }, { data: xeroEvents }`, call `const xeroStatus = await getXeroStatus()` after the `Promise.all`, and pass:

```tsx
        xero={{
          status: xeroStatus,
          flag: xeroFlag ?? null,
          mapping: {
            xero_email_mode: (settings?.xero_email_mode as 'xero' | 'ecr') ?? 'xero',
            xero_default_account: settings?.xero_default_account ?? null,
            xero_account_by_kind: (settings?.xero_account_by_kind as Record<string, string>) ?? {},
            xero_claims_account: settings?.xero_claims_account ?? null,
            xero_gst_tax_type: settings?.xero_gst_tax_type ?? 'OUTPUT',
            xero_no_gst_tax_type: settings?.xero_no_gst_tax_type ?? 'EXEMPTOUTPUT',
            xero_tracking_category_id: settings?.xero_tracking_category_id ?? null,
          },
          accounts: xeroAccounts ?? [],
          taxRates: (xeroTaxRates ?? []).map((t) => ({ ...t, effective_rate: t.effective_rate != null ? Number(t.effective_rate) : null })),
          trackingCategories: xeroCategories ?? [],
          contacts: xeroContacts ?? [],
          unlinkedClients: xeroUnlinked ?? [],
          pendingClaims: (xeroPendingClaims ?? []).map((c) => ({
            id: c.id as string, project_id: c.project_id as string, number: Number(c.number),
            certified_amount: c.certified_amount != null ? Number(c.certified_amount) : null,
            project_number: (c.projects as unknown as { number: string } | null)?.number ?? '—',
          })),
          runs: (xeroRuns ?? []) as XeroRunRow[],
          events: xeroEvents ?? [],
          isAdmin: caller.role === 'admin',
        }}
```

(import `type XeroRunRow` from `./xero-section`). `SettingsRow` in `company-form.tsx` is what `settings` is typed as via `select('*')` — add the seven `xero_*` fields to that interface as optional (`xero_email_mode?: 'xero' | 'ecr'` etc.) so the mapping above type-checks.

- [ ] **Step 5: Verify (needs migration applied locally or the tab shows empty pickers)**

Run: `npx tsc --noEmit && npm run lint`, then start the dev server and load `http://localhost:3000/settings?tab=xero` as admin. Expected: tab renders; connection card shows "Not connected" (or the env/service-role reason); no console errors. Click the tab list to confirm `Xero` appears after `Email`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zod.ts "src/app/(office)/settings/xero-actions.ts" "src/app/(office)/settings/xero-section.tsx" "src/app/(office)/settings/settings-tabs.tsx" "src/app/(office)/settings/page.tsx" "src/app/(office)/settings/company-form.tsx"
git commit -m "feat(xero): Settings → Xero tab — connect, mapping, contact linking, claim retries, sync register

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 14: Invoice page + editor, claim editor

**Files:**
- Modify: `src/app/(office)/invoices/[id]/page.tsx`
- Modify: `src/app/(office)/invoices/[id]/invoice-editor.tsx`
- Modify: `src/app/(office)/projects/[id]/claims/[claimId]/page.tsx:25-40,118-135`
- Modify: `src/app/(office)/projects/[id]/claims/[claimId]/claim-editor.tsx:60-80,425-445`

**Interfaces:**
- Consumes: `getXeroStatus` (Task 8); `markInvoiceSent` now returns `{ error?, warnings?, viaXero? }` (Task 11); `RATE_KINDS`.

- [ ] **Step 1: Load Xero fields on the invoice page**

In `page.tsx`: import `getXeroStatus`; select `kind` on `invoice_lines` (`'id, position, description, qty, unit, unit_sell, kind'`) and `source` on payments; after the `Promise.all` add `const xero = await getXeroStatus()`. Extend `invoiceData` with:

```ts
    origin: (invoice.origin as 'ecr' | 'xero') ?? 'ecr',
    needs_review: Boolean(invoice.needs_review),
    xero: invoice.xero_invoice_id
      ? {
          invoice_id: invoice.xero_invoice_id as string,
          number: (invoice.xero_number as string | null) ?? null,
          status: (invoice.xero_status as string | null) ?? null,
          total: invoice.xero_total != null ? Number(invoice.xero_total) : null,
          amount_paid: invoice.xero_amount_paid != null ? Number(invoice.xero_amount_paid) : null,
          amount_credited: invoice.xero_amount_credited != null ? Number(invoice.xero_amount_credited) : null,
          amount_due: invoice.xero_amount_due != null ? Number(invoice.xero_amount_due) : null,
          online_url: (invoice.xero_online_url as string | null) ?? null,
          pushed_at: (invoice.xero_pushed_at as string | null) ?? null,
          emailed_at: (invoice.xero_emailed_at as string | null) ?? null,
          synced_at: (invoice.xero_synced_at as string | null) ?? null,
        }
      : null,
```

map `kind: (l.kind as string | null) ?? null` onto `lineData`, `source: (p.source as 'ecr' | 'xero') ?? 'ecr'` onto `paymentData`, and pass `xeroConnected={xero.connected}` to `InvoiceEditor`.

- [ ] **Step 2: Editor types and header actions**

In `invoice-editor.tsx`:

Add to `InvoiceData`:

```ts
  origin: 'ecr' | 'xero'
  needs_review: boolean
  xero: {
    invoice_id: string
    number: string | null
    status: string | null
    total: number | null
    amount_paid: number | null
    amount_credited: number | null
    amount_due: number | null
    online_url: string | null
    pushed_at: string | null
    emailed_at: string | null
    synced_at: string | null
  } | null
```

Add `kind: string | null` to `InvoiceLineData`, `source: 'ecr' | 'xero'` to `PaymentData`, and `xeroConnected: boolean` to the `InvoiceEditor` props (pass it down to `HeaderCard` and `PaymentsCard`). Add `ExternalLinkIcon` to the lucide import and `RATE_KINDS, type RateKind` to the zod import.

Derive in `InvoiceEditor`: `const managedInXero = invoice.xero !== null` and `const editable = invoice.status === 'draft' && invoice.origin === 'ecr'`.

In `HeaderCard` replace the "Mark sent" button block and `handleMarkSent`:

```tsx
  function handleMarkSent() {
    const ok = confirm(
      xeroConnected
        ? `Send ${invoice.number} via Xero?\n\nXero will record the invoice and email it to the client. Lines lock once sent.`
        : `Mark ${invoice.number} as sent?\n\nLines will be locked once the invoice is sent.`
    )
    if (!ok) return
    startTransition(async () => {
      const result = await markInvoiceSent(invoice.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      for (const w of result.warnings ?? []) toast.warning(w)
      toast.success(result.viaXero ? 'Sent via Xero' : 'Invoice marked as sent')
      router.refresh()
    })
  }
```

```tsx
            {invoice.status === 'draft' && invoice.origin === 'ecr' && (
              <Button onClick={handleMarkSent} disabled={pending}>
                <SendIcon />
                {xeroConnected ? 'Send via Xero' : 'Mark sent'}
              </Button>
            )}
            {invoice.status === 'sent' && !managedInXero && (
              <Button onClick={() => setPayOpen(true)} disabled={pending}>
                <BanknoteIcon />
                Record payment
              </Button>
            )}
            {(invoice.status === 'draft' || invoice.status === 'sent') && !managedInXero && (
              <Button variant="outline" className="text-destructive border-destructive/50 hover:bg-destructive/10" onClick={handleVoid} disabled={pending}>
                <BanIcon />
                Void
              </Button>
            )}
            {invoice.xero?.online_url && invoice.status === 'sent' && (
              <a href={invoice.xero.online_url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: 'outline' }))}>
                <ExternalLinkIcon />
                Pay-now link
              </a>
            )}
```

(`HeaderCard` receives `managedInXero` and `xeroConnected` as new props.)

- [ ] **Step 3: Xero panel**

Add a component and render it in `InvoiceEditor` between `HeaderCard` and `LinesCard` when `invoice.xero || invoice.origin === 'xero'`:

```tsx
function XeroPanel({ invoice }: { invoice: InvoiceData }) {
  const x = invoice.xero
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Xero</h3>
          <span className="text-xs text-muted-foreground">
            {invoice.origin === 'xero' ? 'Raised in Xero — read-only mirror' : 'Managed in Xero since sending'}
          </span>
        </div>
        {invoice.needs_review && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
            Needs matching — this invoice arrived from Xero without a job. Link it from the Money page.
          </p>
        )}
        {x ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><dt className="text-muted-foreground">Xero number</dt><dd className="font-mono text-xs">{x.number ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Xero status</dt><dd className="font-medium">{x.status ?? '—'}</dd></div>
            <div><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">{x.amount_paid != null ? aud(x.amount_paid) : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Credited</dt><dd className="tabular-nums">{x.amount_credited != null ? aud(x.amount_credited) : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Due</dt><dd className="font-medium tabular-nums">{x.amount_due != null ? aud(x.amount_due) : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Last synced</dt><dd>{x.synced_at ? fmtDate(x.synced_at) : '—'}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Not linked to a Xero invoice.</p>
        )}
        {x && (
          <p className="text-xs text-muted-foreground">
            {x.emailed_at ? `Emailed by Xero ${fmtDate(x.emailed_at)}. ` : ''}
            Payments, credits and voids are recorded in Xero and picked up on the next sync.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Payments card — hide remove on Xero rows**

In `PaymentsCard`, change `canRemove` to `const canRemove = isAdmin && !managedInXero && invoice.status !== 'paid' && invoice.status !== 'void'` (accept `managedInXero` as a prop) and show `p.method === 'xero' ? 'Xero' : …` in the Method cell (`METHOD_LABELS[...] ?? p.method` already falls through — add `xero: 'Xero'` handling by rendering `p.method === 'xero' ? 'Xero' : (METHOD_LABELS[p.method as PaymentMethod] ?? p.method)`).

- [ ] **Step 5: Line `kind` select (editable rows only)**

In `InvoiceLineRow`, add state `const [kind, setKind] = useState<string>(line.kind ?? '')`, include `kind: (kind || null) as RateKind | null` in `LinePayload` (widen the interface with `kind: RateKind | null`) and `save()`, and render beneath the description input (the grid stays 6 columns; this sits inside the description cell):

```tsx
      <div className="flex flex-col gap-1">
        <Input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => { if (description !== line.description) save({ description }) }} placeholder="Line description…" />
        <select aria-label="Line kind (Xero account)" className="h-7 w-fit rounded-md border border-input bg-transparent px-1.5 text-base text-muted-foreground md:text-xs" value={kind} onChange={(e) => { setKind(e.target.value); save({ kind: (e.target.value || null) as RateKind | null }) }}>
          <option value="">Default account</option>
          {RATE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
```

Change the `GRID_EDITABLE` class to `'grid-cols-[minmax(10rem,1fr)_4.5rem_4rem_7.5rem_7rem_5.5rem] items-start'` is **not** needed — keep `items-center`; the taller description cell is fine.

- [ ] **Step 6: Claim editor Xero line**

In `claims/[claimId]/page.tsx` add `xero_invoice_id, xero_status, xero_amount_due, xero_online_url, xero_pushed_at` to the claim select and pass `xero_status: claim.xero_status ?? null, xero_amount_due: claim.xero_amount_due != null ? Number(claim.xero_amount_due) : null, xero_online_url: claim.xero_online_url ?? null, xero_pushed_at: claim.xero_pushed_at ?? null, in_xero: Boolean(claim.xero_invoice_id)` into the `claim` prop. Add those five fields to `ClaimHeader` in `claim-editor.tsx` and, after the "Certified:" span (line ~438), add:

```tsx
            {claim.in_xero && (
              <span>
                Xero:{' '}
                <span className="font-medium text-foreground">
                  {`${claim.xero_status ?? 'AUTHORISED'}${claim.xero_amount_due != null ? ` · ${aud(claim.xero_amount_due)} due` : ''}`}
                </span>
              </span>
            )}
            {!claim.in_xero && claim.certified_at && (
              <span className="text-amber-700">Not in Xero yet — retry from Settings → Xero</span>
            )}
```

Also, in the `certifyClaim` success handler, surface `result.warnings` with `toast.warning` and, when `result.error` starts with `Certified, but`, treat it as a soft failure: `toast.warning(result.error)` and still update local state to certified.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run lint`, then load an invoice page and a claim page in the dev server. Expected: draft ECR invoice shows "Mark sent" (Xero not connected locally); lines show the kind select; no Xero panel on a plain ECR draft; claim page renders.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(office)/invoices/[id]" "src/app/(office)/projects/[id]/claims/[claimId]"
git commit -m "feat(xero): invoice Xero panel, Send via Xero, managed-in-Xero guards, line kinds; claim Xero status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 15: Money page, job page tag, dashboard, portal pay link

**Files:**
- Modify: `src/app/(office)/money/page.tsx`
- Modify: `src/app/(office)/money/xero-export-button.tsx`
- Create: `src/app/(office)/money/match-job-dialog.tsx`
- Modify: `src/app/(office)/jobs/[id]/page.tsx:164-197`, `src/app/(office)/jobs/[id]/invoice-section.tsx`
- Modify: `src/app/(office)/dashboard-cards.tsx:1246-1330`, `src/app/(office)/page.tsx:1118-1165`
- Modify: `src/app/portal/[token]/portal-ui.tsx:118-126`, `src/app/portal/[token]/sites/[siteId]/page.tsx:914-960`

**Interfaces:**
- Consumes: `getXeroStatus` (Task 8); `syncXeroNow` (Task 13); `linkInvoiceToJob` (Task 11).

- [ ] **Step 1: Money page — Xero column, Needs-matching filter, Sync now, CSV hidden when connected**

In `money/page.tsx`:
- Add `{ value: 'needs-matching', label: 'Needs matching' }` to `FILTER_TABS`.
- Extend the invoice select with `origin, needs_review, xero_status, xero_amount_due, xero_online_url`, and add `if (filter === 'needs-matching') query = query.eq('needs_review', true)`.
- Load `const xero = await getXeroStatus()` alongside the queries, and for the Needs-matching dialog load the client's open jobs lazily inside the dialog (Step 3) — no extra query here.
- Add to each `InvoiceRow`: `origin: (inv.origin as 'ecr' | 'xero') ?? 'ecr', needs_review: Boolean(inv.needs_review), client_id: inv.client_id, xero_status: inv.xero_status ?? null, xero_amount_due: inv.xero_amount_due != null ? Number(inv.xero_amount_due) : null, xero_online_url: inv.xero_online_url ?? null` (add `client_id` to the select).
- Pass `xeroConnected={xero.connected}` to `InvoiceTableWithExport`.
- Change the empty message for the new filter: `filter === 'needs-matching' ? 'Nothing to match — every Xero invoice is linked to a job.' : …`.

In `xero-export-button.tsx`: add the six fields to `InvoiceRow`; add `xeroConnected: boolean` prop; import `useRouter`, `useTransition`, `toast`, `syncXeroNow` from `'../settings/xero-actions'`, `MatchJobDialog` from `'./match-job-dialog'`, `RefreshCwIcon`, `Link2Icon`; render:

```tsx
      <div className="flex flex-wrap items-center justify-end gap-2">
        {xeroConnected ? (
          <Button variant="outline" disabled={syncing} onClick={() => startSync(async () => {
            const r = await syncXeroNow()
            if (r.error) toast.error(r.error)
            else toast.success(r.summary ?? 'Sync complete')
            router.refresh()
          })}>
            <RefreshCwIcon className={cn(syncing && 'animate-spin')} />
            Sync with Xero
          </Button>
        ) : (
          <Button variant="outline" disabled={!someSelected} onClick={handleExport} title={someSelected ? 'Export selected to Xero CSV' : 'Select invoices to export'}>
            <FileDownIcon />
            Export to Xero CSV
            {someSelected && <span className="ml-1 text-xs text-muted-foreground">{`(${exportable.filter((r) => selectedIds.has(r.id)).length})`}</span>}
          </Button>
        )}
      </div>
```

(`const [syncing, startSync] = useTransition(); const router = useRouter()`.) Hide the checkbox column when `xeroConnected` (the CSV path is the only consumer). Add table columns after Status:

```tsx
              <TableHead>Xero</TableHead>
```

```tsx
                  <TableCell>
                    {r.xero_status ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{r.xero_status}</span>
                        {r.xero_amount_due != null && r.status === 'sent' && <span className="tabular-nums">{`${aud(r.xero_amount_due)} due`}</span>}
                        {r.xero_online_url && r.status === 'sent' && <a href={r.xero_online_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Pay link</a>}
                        {r.origin === 'xero' && <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">from Xero</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {r.needs_review && (
                      <button type="button" className="mt-1 flex items-center gap-1 text-xs text-amber-700 underline underline-offset-2" onClick={() => setMatching(r)}>
                        <Link2Icon className="size-3" />Match to a job
                      </button>
                    )}
                  </TableCell>
```

with `const [matching, setMatching] = useState<InvoiceRow | null>(null)` and `<MatchJobDialog invoice={matching} onClose={() => setMatching(null)} />` rendered at the end.

- [ ] **Step 2: Match-job dialog**

```tsx
// src/app/(office)/money/match-job-dialog.tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { linkInvoiceToJob } from '../invoices/actions'
import type { InvoiceRow } from './xero-export-button'

type JobOption = { id: string; number: string; title: string; status: string }

/** Needs-matching queue: attach a Xero-raised invoice to one of the client's jobs. */
export function MatchJobDialog({ invoice, onClose }: { invoice: InvoiceRow | null; onClose: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [jobId, setJobId] = useState('')

  useEffect(() => {
    if (!invoice) return
    setJobId('')
    const supabase = createClient()
    supabase
      .from('jobs')
      .select('id, number, title, status')
      .eq('client_id', invoice.client_id)
      .eq('archived', false)
      .not('status', 'in', '("quote","lost")')
      .order('created_at', { ascending: false })
      .then(({ data }) => setJobs((data ?? []) as JobOption[]))
  }, [invoice])

  function submit() {
    if (!invoice || !jobId) return
    start(async () => {
      const r = await linkInvoiceToJob(invoice.id, jobId)
      if (r.error) { toast.error(r.error); return }
      toast.success(`${invoice.number} linked`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={invoice !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{invoice ? `Match ${invoice.number} to a job` : 'Match invoice'}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{invoice ? `Raised in Xero for ${invoice.client_name}. Pick the job it belongs to so it shows on the job card and in reports.` : ''}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="match-job">Job</Label>
          <select id="match-job" className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-sm" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">— choose a job —</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{`${j.number} — ${j.title} (${j.status})`}</option>)}
          </select>
          {jobs.length === 0 && <p className="text-xs text-muted-foreground">This client has no open jobs. Leave the invoice unmatched or create the job first.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !jobId}>{pending ? 'Linking…' : 'Link'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

(`@/lib/supabase/client` is the existing browser client used by other client components — confirm with `ls src/lib/supabase/`.)

- [ ] **Step 3: Job page "from Xero" tag**

In `jobs/[id]/page.tsx` add `origin` to the invoices select and `origin: (inv.origin as 'ecr' | 'xero') ?? 'ecr'` to each row; add `origin: 'ecr' | 'xero'` to `JobInvoiceRow` in `invoice-section.tsx` and render after the number link:

```tsx
                    {inv.origin === 'xero' && (
                      <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">from Xero</span>
                    )}
```

- [ ] **Step 4: Dashboard system health**

In `dashboard-cards.tsx` add to `SystemHealthData`:

```ts
  /** Xero connection needing attention (null when connected/healthy or not configured). */
  xero: { label: string; detail: string } | null
```

include `data.xero === null` in `allClear`, and render before the backup row:

```tsx
          {data.xero && (
            <div className="flex items-start justify-between gap-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <Link href="/settings?tab=xero" className="truncate hover:underline">{data.xero.label}</Link>
                <span className="text-xs text-muted-foreground">{data.xero.detail}</span>
              </div>
              <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400">Xero</span>
            </div>
          )}
```

In `page.tsx` `loadSystemHealth`: import `getXeroStatus`, call `const xs = await getXeroStatus()` and set

```ts
    xero:
      xs.status === 'needs_reconnect'
        ? { label: 'Xero needs reconnecting', detail: xs.pendingOrgSwitch ? 'Confirm the organisation switch in Settings → Xero' : 'Sending via Xero and the nightly sync are paused' }
        : xs.connected && (xs.lastSyncStatus === 'failed' || xs.lastSyncStatus === 'partial')
          ? { label: `Last Xero sync ${xs.lastSyncStatus}`, detail: 'Open the sync register for details' }
          : null,
```

- [ ] **Step 5: Portal pay-now**

In `portal-ui.tsx` add `pay_url?: string | null` to `PortalBillingRow`. In `sites/[siteId]/page.tsx` billing map, after the download `<a>` add:

```tsx
                  {b.kind === 'invoice' && b.pay_url && b.status === 'sent' && (
                    <a
                      href={b.pay_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-[#162040] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1e2c56]"
                    >
                      Pay now
                    </a>
                  )}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=1`. Load `/money`, `/money?filter=needs-matching`, a job page, the dashboard. Expected: all 200, no console errors; "Export to Xero CSV" shows while disconnected.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(office)/money" "src/app/(office)/jobs/[id]" "src/app/(office)/dashboard-cards.tsx" "src/app/(office)/page.tsx" "src/app/portal/[token]/portal-ui.tsx" "src/app/portal/[token]/sites/[siteId]/page.tsx"
git commit -m "feat(xero): Money Xero column + needs-matching queue + Sync, job 'from Xero' tag, dashboard health row, portal Pay now

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 16: RLS probes, env docs, verification gate

**Files:**
- Modify: `supabase/seed/rls-check.mjs` (insert before the `await supabase.auth.signOut()` that precedes the audit-log block, ~line 227)
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-09-05-xero-integration-design.md` §6 (`invoice_lines.kind` values, `xero_emailed_at`, `xero_contacts` cache, audit-trigger sentence)

- [ ] **Step 1: RLS probes (run only after the owner applies 0063)**

```js
  // ─── Xero (0063) ──────────────────────────────────────────────────────────
  // xero_connection holds encrypted tokens: NO role may read it. Caches and the
  // register are admin/office only.
  {
    const { data: connRows, error: connErr } = await supabase.from('xero_connection').select('id').limit(1)
    if (connErr) check('xero_connection SELECT blocked for field', true, `error: ${connErr.message}`)
    else check('xero_connection SELECT blocked for field', (connRows ?? []).length === 0, `field can see ${(connRows ?? []).length} row(s)`)

    for (const table of ['xero_sync_runs', 'xero_sync_events', 'xero_accounts', 'xero_contacts']) {
      const { data, error } = await supabase.from(table).select('*').limit(1)
      if (error) check(`${table} SELECT blocked for field`, true, `error: ${error.message}`)
      else check(`${table} SELECT blocked for field`, (data ?? []).length === 0, `field can see ${(data ?? []).length} row(s)`)
    }

    const { error: runInsertErr, data: runInserted } = await supabase
      .from('xero_sync_runs')
      .insert({ trigger: 'manual', status: 'running' })
      .select('id')
    if (runInsertErr) check('insert xero_sync_runs rejected (field)', true, runInsertErr.message)
    else check('insert xero_sync_runs rejected (field)', false, `insert SUCCEEDED: ${JSON.stringify(runInserted)}`)
  }
```

And inside the supervisor (`adminClient`) block, after the `email_log` supervisor check:

```js
    const { data: superConn, error: superConnErr } = await adminClient.from('xero_connection').select('id').limit(1)
    if (superConnErr) check('xero_connection SELECT blocked for supervisor', true, `error: ${superConnErr.message}`)
    else check('xero_connection SELECT blocked for supervisor', (superConn ?? []).length === 0, `supervisor can see ${(superConn ?? []).length} row(s)`)
```

Run: `node supabase/seed/rls-check.mjs` (needs `.env.local`; on this machine `NODE_EXTRA_CA_CERTS` per memory). Expected: every new line `PASS`; overall "All RLS checks passed".

- [ ] **Step 2: `.env.example`**

Append:

```
# Xero (Settings → Xero). Register the app at developer.xero.com with redirect
# URI ${NEXT_PUBLIC_APP_URL}/api/xero/callback. XERO_TOKEN_KEY is 32 random
# bytes, base64 — mint one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
XERO_TOKEN_KEY=
```

- [ ] **Step 3: Spec check (the §6 alignment was already applied when this plan was written)**

Confirm the spec's §6 matches the migration: `invoice_lines.kind` CHECK is `('labour','plant','material','subbie','other')`, `xero_emailed_at` is listed on invoices, the `xero_contacts` cache is listed, and the audit sentence names `xero_sync_runs` / `xero_sync_events` as the trail. Run `grep -n "subbie\|xero_emailed_at\|xero_contacts\|xero_sync_events" docs/superpowers/specs/2026-09-05-xero-integration-design.md` — expect at least one hit for each. If the build deviated from the spec anywhere else (e.g. VERIFY fallbacks taken), record it in §12 now.

- [ ] **Step 4: Full verification gate**

Run, in order:

```bash
npx tsc --noEmit
npm run lint
npx vitest run --maxWorkers=1
```

Expected: tsc clean; lint 0 errors; all tests green (existing count + the five new Xero test files).

Then the HTTP pass with the dev server (`$env:NODE_EXTRA_CA_CERTS` set): `/settings?tab=xero`, `/money`, `/money?filter=needs-matching`, one invoice page, one claim page, `/`. Expected: all 200, no server errors in the terminal, no console errors. Click-level: open the Xero tab, expand nothing (no connection), confirm "Connect to Xero" points at `/api/xero/connect`; on an ECR draft invoice confirm the line kind select saves (network 200, value persists after refresh).

- [ ] **Step 5: Commit**

```bash
git add supabase/seed/rls-check.mjs .env.example docs/superpowers/specs/2026-09-05-xero-integration-design.md
git commit -m "test(xero): RLS probes for the connection, caches and register; env docs; spec aligned to build

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the code: owner-driven steps (not agent tasks)

These are in the spec §13 and need the owner's hands. List them in the final handover message, do not attempt them autonomously.

1. **Apply migration 0063** — paste `supabase/migrations/0063_xero.sql` plus `insert into supabase_migrations.schema_migrations (version, name) values ('20260905090000', '0063_xero');` into the Supabase SQL editor. Then run `node supabase/seed/rls-check.mjs`.
2. **Mint and add `XERO_TOKEN_KEY`** — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`; add to Vercel Production alongside the already-saved `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`; add all three to `.env.local` for local Demo Company testing (plus the service-role key). Add `http://localhost:3000/api/xero/callback` as a second redirect URI on the Xero app.
3. **Merge + deploy**, then **Demo Company live run** (spec §11): connect → Sync now → set mapping (income account, claims account, tracking category "Job" — create it in the Demo Company first under Settings → Tracking categories) → create a `zz` client + job + invoice in ECR → Send via Xero → confirm the Xero email + pay link → pay it in Xero → Sync now → ECR shows paid with a Xero payment row → void one in Xero → sync → void in ECR → raise an invoice directly in Xero with `RJ…` in Reference → sync → mirrored + matched → raise one without → Needs matching → link by hand → certify a `zz` claim → Xero invoice → Disconnect → Reconnect. Record VERIFY-1..5 outcomes in the spec §12 table. Delete every `zz` record (invoices/claims via app where possible; mirrors and sync rows via the agent API delete tool).
4. **MFA follow-on build** (separate spec) before step 5.
5. **Real org**: owner gets Standard/Adviser access to the business's Xero, re-registers the app under that login, updates the Vercel env, connects → typed org-switch confirmation clears demo links → Sync now → brief the bookkeeper.

## Plan self-review (done at authoring time)

- **Spec coverage:** §3 boundary → Task 3 (scope pin) + Tasks 10/12 (field lists); §5.1 → Tasks 5, 8, 13 (switch confirm); §5.2 → Tasks 6, 11; §5.3 → Tasks 6, 11, 14; §5.4 → Task 12; §5.5 → Task 10; §6 → Task 1 (+ Task 16 spec alignment); §7 → Task 6 (tests) + Task 12; §8 → Tasks 13, 14, 15; §9 → Tasks 4, 5, 7, 8 (302-only callback), 1 (RLS), 16 (probes); §10 → file map; §11 → Tasks 3–7 unit tests, Task 16 RLS + live gate; §12 VERIFY → live run checklist above; §13 rollout → owner steps.
- **Type consistency:** `TrackingRef` (map.ts) is consumed by tracking.ts/push.ts; `Admin` type is exported from register.ts and imported everywhere; `PushResult` shape used identically in invoice and claim actions; `XeroStatus.connected` gates every push; `InvoiceRow.client_id` (Task 15) is the field the match dialog queries on.
- **Known judgement calls surfaced to the implementer:** `updated_at` may not exist on jobs/projects (Task 10 Step 4 note); `optionalText` and `@/lib/supabase/client` existence checks are spelled out as greps.
