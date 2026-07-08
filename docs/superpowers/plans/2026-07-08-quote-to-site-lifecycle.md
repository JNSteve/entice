# Quote → Site Lifecycle Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the quote→job/project handover gap (mobilisation checklist, scope + attachments carry-over), build the daily pre-start loop (My Day nudge + office dashboard card), and add an amend flow for immutable form submissions.

**Architecture:** Three independently shippable phases. Phase 1 extends the existing job-checklist machinery to projects, auto-seeds a mobilisation template at conversion, and copies quote scope/attachments across. Phase 2 is read-only queries + UI over existing tables (assignments × form_submissions). Phase 3 adds a nullable `amends` self-reference on `form_submissions` — records stay immutable; corrections are new linked rows.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres + RLS + Storage), zod, vitest. Brisbane time is fixed UTC+10 (no DST) — `todayAU()` from `src/lib/tz.ts` gives the AU calendar day.

**Conventions that bind every task:**
- Server actions: `requireRole(...)` first, `safeParse` zod, return `{ error?: string }`.
- Migrations are applied to the LIVE Supabase project (`zspauxavbhtutanhekuu`) via `npx supabase db push` (needs `NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'`). The DB holds real ECR data — no test writes without `zz` prefix + cleanup.
- Run tests with `npx vitest run --maxWorkers=1` (parallel @react-pdf tests flake on this machine).
- After each task: `npx tsc --noEmit` must pass.

---

## Phase 1 — Conversion carries the full picture

### Task 1: Migration — project checklists + auto-apply templates

**Files:**
- Create: `supabase/migrations/0039_project_mobilisation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Project checklists (mirror of job_checklist_items) + a flag that lets a
-- checklist template auto-apply when a quote converts. Seeds ECR's
-- mobilisation checklist for asbestos/civil works.

create table project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  text text not null,
  position int not null default 0,
  done boolean not null default false,
  done_by uuid references profiles(id),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index project_checklist_items_project_idx
  on project_checklist_items (project_id, position);

alter table project_checklist_items enable row level security;

create policy project_checklist_items_read on project_checklist_items
  for select to authenticated using (auth.uid() is not null);

-- Unlike job checklists (field can tick), mobilisation items are compliance
-- records (notification lodged, ARCP issued) — staff-only writes.
create policy project_checklist_items_insert_staff on project_checklist_items
  for insert to authenticated
  with check (current_app_role() in ('admin','office','supervisor'));

create policy project_checklist_items_update_staff on project_checklist_items
  for update to authenticated
  using (current_app_role() in ('admin','office','supervisor'))
  with check (current_app_role() in ('admin','office','supervisor'));

create policy project_checklist_items_delete_staff on project_checklist_items
  for delete to authenticated
  using (current_app_role() in ('admin','office','supervisor'));

-- Templates flagged auto_apply_on_convert seed the checklist at conversion.
alter table checklist_templates
  add column auto_apply_on_convert boolean not null default false;

insert into checklist_templates (title, items, auto_apply_on_convert) values (
  'Mobilisation — before work starts',
  array[
    'WorkSafe QLD asbestos removal notification lodged (5 business days before Class A/B work)',
    'Asbestos Removal Control Plan (ARCP) issued to site',
    'SWMS attached to this work and signed by crew',
    'Crew licences, tickets and inductions verified',
    'Air monitoring arranged (licensed asbestos assessor)',
    'Waste transport and disposal facility booked',
    'Client and site access confirmed'
  ],
  true
);
```

- [ ] **Step 2: Apply to the live DB**

Run: `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'; npx supabase db push`
Expected: `0039_project_mobilisation.sql` applied without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0039_project_mobilisation.sql
git commit -m "feat: project checklist table + auto-apply mobilisation template"
```

### Task 2: Project checklist server actions

**Files:**
- Modify: `src/lib/zod.ts` (near `checklistItemSchema` — grep for it)
- Modify: `src/app/(office)/projects/actions.ts` (append a Checklist section)

- [ ] **Step 1: Add the zod schema** (next to the existing `checklistItemSchema`)

```ts
export const projectChecklistItemSchema = z.object({
  project_id: z.uuid(),
  text: z.string().min(1, 'Item text is required'),
})

export type ProjectChecklistItemInput = z.infer<typeof projectChecklistItemSchema>
```

- [ ] **Step 2: Add actions to `projects/actions.ts`** (import `projectChecklistItemSchema` from `@/lib/zod`; mirror the job checklist actions at `src/app/(office)/jobs/actions.ts:185-294`)

```ts
// ─── Mobilisation checklist ───────────────────────────────────────────────────

export async function addProjectChecklistItem(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = projectChecklistItemSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  const { data: last } = await supabase
    .from('project_checklist_items')
    .select('position')
    .eq('project_id', parsed.data.project_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('project_checklist_items').insert({
    project_id: parsed.data.project_id,
    text: parsed.data.text,
    position: (last?.position ?? -1) + 1,
    done: false,
  })
  if (error) return { error: error.message }

  revalidateProject(parsed.data.project_id)
  return {}
}

export async function toggleProjectChecklistItem(
  itemId: string,
  projectId: string,
  done: boolean
): Promise<Result> {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const supabase = await createClient()

  const update = done
    ? { done: true, done_by: profile.id, done_at: new Date().toISOString() }
    : { done: false, done_by: null, done_at: null }

  const { error } = await supabase
    .from('project_checklist_items')
    .update(update)
    .eq('id', itemId)
    .eq('project_id', projectId)
  if (error) return { error: error.message }

  revalidateProject(projectId)
  return {}
}

export async function deleteProjectChecklistItem(
  itemId: string,
  projectId: string
): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const { error } = await supabase
    .from('project_checklist_items')
    .delete()
    .eq('id', itemId)
    .eq('project_id', projectId)
  if (error) return { error: error.message }

  revalidateProject(projectId)
  return {}
}
```

Note: `requireRole('admin', 'office', 'supervisor')` — supervisors run mobilisation. `revalidateProject` already exists at the top of the file.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/zod.ts "src/app/(office)/projects/actions.ts"
git commit -m "feat: project mobilisation checklist actions"
```

### Task 3: Scope summary carried into job/project description (TDD)

**Files:**
- Modify: `src/lib/convert.ts`
- Test: `tests/convert.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/convert.test.ts`)

```ts
import { scopeSummaryFromQuote } from '../src/lib/convert'

describe('scopeSummaryFromQuote', () => {
  test('groups line descriptions under section titles, price-free', () => {
    const summary = scopeSummaryFromQuote(SECTIONS, LINES)
    expect(summary).toContain('Scope of works (from quote):')
    expect(summary).toContain('Preparation')
    expect(summary).toContain('- Site setup')
    expect(summary).toContain('- Membrane')
    // Never leaks money
    expect(summary).not.toMatch(/\$|unit_cost|unit_sell|\d+\.\d{2}/)
  })

  test('unsectioned lines land under Other works', () => {
    const lines = [...LINES, { section_id: null, description: 'Disposal', qty: 1, unit_cost: 0, unit_sell: 10 }]
    const summary = scopeSummaryFromQuote(SECTIONS, lines)
    expect(summary).toContain('Other works')
    expect(summary).toContain('- Disposal')
  })

  test('no lines → null', () => {
    expect(scopeSummaryFromQuote(SECTIONS, [])).toBeNull()
  })
})

describe('description carry-over', () => {
  test('project description = quote description + scope summary', () => {
    const { project } = projectPayloadFromQuote(QUOTE, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    expect(project.description).toContain('Full roof restoration scope')
    expect(project.description).toContain('Scope of works (from quote):')
  })

  test('job description gets the scope summary too', () => {
    const payload = jobPayloadFromQuote(QUOTE, 'J-0001', SECTIONS, LINES)
    expect(payload.description).toContain('Scope of works (from quote):')
  })

  test('null quote description still produces the scope block alone', () => {
    const q = { ...QUOTE, description: null }
    const { project } = projectPayloadFromQuote(q, SECTIONS, LINES, OTHER_CODE_ID, TODAY)
    expect(project.description).toContain('Scope of works (from quote):')
  })
})
```

Note: `jobPayloadFromQuote` gains two OPTIONAL trailing params `(quote, number, sections = [], lines = [])` so the three existing jobPayload tests keep passing unchanged (they pass no sections/lines → no scope block; the existing `'null description is preserved'` test still sees `null`).

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/convert.test.ts --maxWorkers=1` → FAIL (`scopeSummaryFromQuote` not exported).

- [ ] **Step 3: Implement in `src/lib/convert.ts`**

```ts
/**
 * Price-free scope-of-works text for the converted job/project description —
 * the site crew and supervisor can read WHAT was quoted without any money
 * fields (field/supervisor roles cannot see quotes).
 */
export function scopeSummaryFromQuote(
  sections: ConvertSection[],
  lines: ConvertLine[]
): string | null {
  if (lines.length === 0) return null

  const bySection = new Map<string | null, ConvertLine[]>()
  for (const line of lines) {
    const key = line.section_id
    const list = bySection.get(key) ?? []
    list.push(line)
    bySection.set(key, list)
  }

  const parts: string[] = ['Scope of works (from quote):']
  const ordered = [...sections].sort((a, b) => a.position - b.position)
  for (const section of ordered) {
    const sectionLines = bySection.get(section.id)
    if (!sectionLines?.length) continue
    parts.push(`\n${section.title}`)
    for (const l of sectionLines) parts.push(`- ${l.description}`)
  }
  const orphans = lines.filter(
    (l) => l.section_id === null || !sections.some((s) => s.id === l.section_id)
  )
  if (orphans.length > 0) {
    parts.push('\nOther works')
    for (const l of orphans) parts.push(`- ${l.description}`)
  }
  return parts.join('\n')
}

/** Quote description + scope block, either may be absent. */
function describeWithScope(
  description: string | null,
  sections: ConvertSection[],
  lines: ConvertLine[]
): string | null {
  const scope = scopeSummaryFromQuote(sections, lines)
  const combined = [description, scope].filter(Boolean).join('\n\n')
  return combined || null
}
```

Then in `jobPayloadFromQuote` — change the signature and description line:

```ts
export function jobPayloadFromQuote(
  quote: ConvertQuote,
  number: string,
  sections: ConvertSection[] = [],
  lines: ConvertLine[] = []
): JobPayload {
  return {
    // ...unchanged fields...
    description: describeWithScope(quote.description, sections, lines),
    // ...
  }
}
```

And in `projectPayloadFromQuote`, the project payload's description becomes:

```ts
    description: describeWithScope(quote.description, sections, lines),
```

- [ ] **Step 4: Pass the real sections/lines at the call sites** in `src/app/(office)/quotes/actions.ts`: `convertQuoteToJob` currently calls `jobPayloadFromQuote(quoteShape, number)` — it must now ALSO fetch sections+lines (copy the two queries from `convertQuoteToProject` at `actions.ts:634-646`, including the `.order('id')` tiebreaks) and pass them through. `convertQuoteToProject` already has them in scope.

- [ ] **Step 5: Run the full suite** — `npx vitest run --maxWorkers=1` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/convert.ts tests/convert.test.ts "src/app/(office)/quotes/actions.ts"
git commit -m "feat: conversion carries a price-free scope of works into the description"
```

### Task 4: Conversion seeds the mobilisation checklist + copies quote attachments

**Files:**
- Create: `src/lib/convert-side-effects.ts`
- Modify: `src/app/(office)/quotes/actions.ts` (both convert actions)

- [ ] **Step 1: Write the helper module** (plain server-side utils, called only from the `'use server'` actions file)

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Post-conversion side effects. Both are BEST-EFFORT: a failed copy or seed
 * logs and returns rather than failing the conversion — the job/project row
 * is already committed and redirect must proceed.
 */

/** Seed checklist items from every template flagged auto_apply_on_convert. */
export async function seedConvertChecklist(
  supabase: SupabaseClient,
  target: { table: 'job_checklist_items'; fk: 'job_id' } | { table: 'project_checklist_items'; fk: 'project_id' },
  parentId: string
): Promise<void> {
  const { data: templates } = await supabase
    .from('checklist_templates')
    .select('items')
    .eq('auto_apply_on_convert', true)
    .order('title')

  const texts = (templates ?? []).flatMap((t) => (t.items as string[]) ?? [])
  if (texts.length === 0) return

  const { error } = await supabase.from(target.table).insert(
    texts.map((text, i) => ({ [target.fk]: parentId, text, position: i, done: false }))
  )
  if (error) console.error('convert: checklist seed failed —', error.message)
}

/**
 * Copy the quote's attachments (scope docs, survey PDFs) onto the converted
 * job/project. Each blob is COPIED to a new storage path — attachment rows
 * must never share a path, because deleteAttachment removes the blob.
 */
export async function copyQuoteAttachments(
  supabase: SupabaseClient,
  quoteId: string,
  parentType: 'job' | 'project',
  parentId: string,
  userId: string
): Promise<void> {
  const { data: rows } = await supabase
    .from('attachments')
    .select('bucket, path, filename, content_type, size, kind, caption, meta')
    .eq('parent_type', 'quote')
    .eq('parent_id', quoteId)

  for (const row of rows ?? []) {
    const bucket = row.bucket ?? 'attachments'
    const destPath = `${parentType}/${parentId}/${crypto.randomUUID()}`
    const { error: copyErr } = await supabase.storage.from(bucket).copy(row.path, destPath)
    if (copyErr) {
      console.error('convert: attachment blob copy failed —', row.path, copyErr.message)
      continue
    }
    const { error: insErr } = await supabase.from('attachments').insert({
      parent_type: parentType,
      parent_id: parentId,
      bucket,
      path: destPath,
      filename: row.filename,
      content_type: row.content_type,
      size: row.size,
      kind: row.kind,
      caption: row.caption ?? 'Carried over from quote',
      meta: { ...((row.meta as Record<string, unknown>) ?? {}), copied_from_quote: quoteId },
      created_by: userId,
    })
    if (insErr) console.error('convert: attachment row insert failed —', insErr.message)
  }
}
```

- [ ] **Step 2: Wire into both convert actions** in `src/app/(office)/quotes/actions.ts`. Both actions already have `profile` available? Check — they call `requireRole('admin','office')` which RETURNS the profile; capture it (`const profile = await requireRole('admin', 'office')`). After the job/project insert succeeds and BEFORE the `converted_to` quote update:

```ts
  // Carry the working context across — checklist + scope documents.
  await seedConvertChecklist(supabase, { table: 'project_checklist_items', fk: 'project_id' }, project.id)
  await copyQuoteAttachments(supabase, quoteId, 'project', project.id, profile.id)
```

(and the `job_checklist_items` / `'job'` equivalents in `convertQuoteToJob`).

- [ ] **Step 3: Typecheck + tests** — `npx tsc --noEmit` and `npx vitest run --maxWorkers=1` → green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/convert-side-effects.ts "src/app/(office)/quotes/actions.ts"
git commit -m "feat: conversion seeds mobilisation checklist and copies quote attachments"
```

### Task 5: Mobilisation card on the project overview

**Files:**
- Create: `src/app/(office)/projects/[id]/mobilisation-card.tsx`
- Modify: `src/app/(office)/projects/[id]/page.tsx` (add query + render)

- [ ] **Step 1: Write the client component**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CheckIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import {
  addProjectChecklistItem,
  deleteProjectChecklistItem,
  toggleProjectChecklistItem,
} from '../../actions'

export interface MobilisationItem {
  id: string
  text: string
  done: boolean
}

export function MobilisationCard({
  projectId,
  items,
}: {
  projectId: string
  items: MobilisationItem[]
}) {
  const [pending, startTransition] = useTransition()
  const [newText, setNewText] = useState('')

  const doneCount = items.filter((i) => i.done).length
  const allDone = items.length > 0 && doneCount === items.length

  function handleToggle(item: MobilisationItem) {
    startTransition(async () => {
      const result = await toggleProjectChecklistItem(item.id, projectId, !item.done)
      if (result.error) toast.error(result.error)
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newText.trim()) return
    startTransition(async () => {
      const result = await addProjectChecklistItem({ project_id: projectId, text: newText.trim() })
      if (result.error) { toast.error(result.error); return }
      setNewText('')
    })
  }

  function handleDelete(item: MobilisationItem) {
    startTransition(async () => {
      const result = await deleteProjectChecklistItem(item.id, projectId)
      if (result.error) toast.error(result.error)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Mobilisation</span>
          <span
            className={cn(
              'text-sm font-medium tabular-nums',
              allDone
                ? 'text-green-700 dark:text-green-400'
                : 'text-amber-700 dark:text-amber-400'
            )}
          >
            {doneCount}/{items.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No mobilisation items. Add what must be in place before work starts.
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleToggle(item)}
              disabled={pending}
              aria-pressed={item.done}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded border-2',
                item.done
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-muted-foreground/40'
              )}
            >
              {item.done && <CheckIcon className="size-3.5" />}
            </button>
            <span
              className={cn(
                'flex-1 text-sm',
                item.done && 'text-muted-foreground line-through'
              )}
            >
              {item.text}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
              onClick={() => handleDelete(item)}
              disabled={pending}
            >
              <Trash2Icon className="size-3.5" />
              <span className="sr-only">Delete item</span>
            </Button>
          </div>
        ))}
        <form onSubmit={handleAdd} className="mt-1 flex items-center gap-2">
          <Input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add item…"
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending || !newText.trim()}>
            <PlusIcon className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Wire into the overview page** — in `src/app/(office)/projects/[id]/page.tsx` add to the `Promise.all`:

```ts
    supabase
      .from('project_checklist_items')
      .select('id, text, done')
      .eq('project_id', id)
      .order('position'),
```

and render `<MobilisationCard projectId={id} items={checklistItems ?? []} />` in the card grid (place it first — before the retention card — so an incomplete mobilisation is the first thing seen on a fresh project). Import at top.

- [ ] **Step 3: Verify in preview** — `preview_start` `entice-dev`, log in (admin@entice.local / EnticeAdmin!1), open P-0013 overview → card renders (0 items for pre-existing projects → empty-state text). Add a `zz test item`, tick it, delete it (cleanup — live DB).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(office)/projects/[id]/mobilisation-card.tsx" "src/app/(office)/projects/[id]/page.tsx"
git commit -m "feat: mobilisation checklist card on project overview"
```

---

## Phase 2 — Daily pre-start loop

### Task 6: My Day pre-start nudge (field PWA)

**Files:**
- Modify: `src/app/field/page.tsx`

- [ ] **Step 1: Add the queries** after the existing assignment fetch (`page.tsx:27-52`). Brisbane is fixed +10, so the AU day starts at `T00:00:00+10:00`:

```ts
  // ─── Pre-start meeting status for today's targets ─────────────────────────
  // One prestart_meeting per project/job per AU day is the expectation; nudge
  // when today's assigned target doesn't have one yet.

  const dayStartIso = new Date(`${todayStr}T00:00:00+10:00`).toISOString()

  const [{ data: prestartTemplate }, { data: todaysMeetings }] = await Promise.all([
    supabase
      .from('form_templates')
      .select('id')
      .eq('kind', 'prestart_meeting')
      .eq('active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('form_submissions')
      .select('id, project_id, job_id')
      .eq('kind', 'prestart_meeting')
      .gte('submitted_at', dayStartIso),
  ])
```

- [ ] **Step 2: Shape nudge items** (after the `assignments` shaping block):

```ts
  // Distinct assigned targets → done (link to submission) or todo (link to form).
  type PrestartNudge = {
    key: string
    label: string
    href: string
    done: boolean
  }
  const prestartNudges: PrestartNudge[] = []
  if (prestartTemplate) {
    const seen = new Set<string>()
    for (const a of assignments) {
      const key = a.project_id ?? a.job_id
      if (!key || seen.has(key)) continue
      seen.add(key)
      const meeting = (todaysMeetings ?? []).find((m) =>
        a.project_id ? m.project_id === a.project_id : m.job_id === a.job_id
      )
      const targetParam = a.project_id ? `project=${a.project_id}` : `job=${a.job_id}`
      prestartNudges.push({
        key,
        label: `${a.number} — ${a.title}`,
        href: meeting
          ? `/field/safety/submission/${meeting.id}`
          : `/field/safety/new/${prestartTemplate.id}?${targetParam}`,
        done: Boolean(meeting),
      })
    }
  }
```

- [ ] **Step 3: Render** between the greeting block and `<MyDayClient …>` (server-side, plain Links — no client state needed). Add `import Link from 'next/link'` and `import { ShieldCheckIcon, CheckCircle2Icon } from 'lucide-react'`:

```tsx
      {prestartNudges.length > 0 && (
        <div className="flex flex-col gap-2">
          {prestartNudges.map((n) =>
            n.done ? (
              <Link
                key={n.key}
                href={n.href}
                className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3"
              >
                <CheckCircle2Icon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Pre-start meeting done</p>
                  <p className="truncate text-xs text-muted-foreground">{n.label}</p>
                </div>
              </Link>
            ) : (
              <Link
                key={n.key}
                href={n.href}
                className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 transition-colors active:bg-amber-100 dark:border-amber-700 dark:bg-amber-950"
              >
                <ShieldCheckIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Start today&apos;s Pre-Start Meeting</p>
                  <p className="truncate text-xs text-muted-foreground">{n.label}</p>
                </div>
              </Link>
            )
          )}
        </div>
      )}
```

- [ ] **Step 4: Verify in preview** — log in as a field user (field1@entice.local / Entice!234). If no assignment exists today the section is hidden (correct); confirm no crash. Full nudge visual check needs a real assignment — if one of the user's projects has crew assigned today, use that; do NOT create test assignments without zz-cleanup.

- [ ] **Step 5: Commit**

```bash
git add src/app/field/page.tsx
git commit -m "feat: My Day pre-start meeting nudge for today's assigned sites"
```

### Task 7: Office dashboard "Pre-starts today" card

**Files:**
- Modify: `src/app/(office)/page.tsx` (loader + wiring — find the parallel loader block and card grid by grepping `ComplianceCard`)
- Modify: `src/app/(office)/dashboard-cards.tsx` (new card, follow the `ComplianceCard` pattern at `dashboard-cards.tsx:428-470`)

- [ ] **Step 1: Add the loader** in `src/app/(office)/page.tsx` (near the other `load*` helpers; `Db` is the file's existing supabase type alias):

```ts
// ─── Pre-starts today ─────────────────────────────────────────────────────────
// PrestartTodayRow is defined in dashboard-cards.tsx (matching ComplianceRow's
// pattern) — import it: `import { PrestartTodayCard, type PrestartTodayRow } from './dashboard-cards'`

async function loadPrestartsToday(
  supabase: Db,
  todayStr: string
): Promise<PrestartTodayRow[]> {
  const dayStartIso = new Date(`${todayStr}T00:00:00+10:00`).toISOString()
  const [{ data: assignments }, { data: meetings }] = await Promise.all([
    supabase
      .from('assignments')
      .select('project_id, job_id, projects(number, name), jobs(number, title)')
      .eq('date', todayStr),
    supabase
      .from('form_submissions')
      .select('id, project_id, job_id')
      .eq('kind', 'prestart_meeting')
      .gte('submitted_at', dayStartIso),
  ])

  const byTarget = new Map<string, PrestartTodayRow>()
  for (const a of assignments ?? []) {
    const key = (a.project_id ?? a.job_id) as string | null
    if (!key) continue
    const existing = byTarget.get(key)
    if (existing) {
      existing.crew += 1
      continue
    }
    const project = a.projects as unknown as { number: string; name: string } | null
    const job = a.jobs as unknown as { number: string; title: string } | null
    const meeting = (meetings ?? []).find((m) =>
      a.project_id ? m.project_id === a.project_id : m.job_id === a.job_id
    )
    byTarget.set(key, {
      key,
      label: project
        ? `${project.number} — ${project.name}`
        : job
          ? `${job.number} — ${job.title}`
          : 'Unknown',
      crew: 1,
      done: Boolean(meeting),
      href: meeting
        ? `/field/safety/submission/${meeting.id}`
        : '/whs/forms',
    })
  }
  // Missing pre-starts first, then by label.
  return [...byTarget.values()].sort(
    (a, b) => Number(a.done) - Number(b.done) || a.label.localeCompare(b.label)
  )
}
```

Wire it into the page's parallel loader block (same `Promise.all`/`Promise.allSettled` the other loaders use — pass `todayStr` the same way `loadRetentionDue` receives its date) and pass the result to the new card in the grid, next to the safety/compliance cards.

- [ ] **Step 2: Add the card** in `src/app/(office)/dashboard-cards.tsx` (reuse the file's `DashboardCard`, `LoadError`, `Muted`, `MoreNote` internals — copy the `ComplianceCard` structure):

```tsx
export interface PrestartTodayRow {
  key: string
  label: string
  crew: number
  done: boolean
  href: string
}

export function PrestartTodayCard({ data }: { data: PrestartTodayRow[] | null }) {
  return (
    <DashboardCard title="Pre-starts today" href="/whs/forms">
      {data === null ? (
        <LoadError />
      ) : data.length === 0 ? (
        <Muted>No crew assigned today.</Muted>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.slice(0, 5).map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{row.label}</span>
              <span
                className={cn(
                  'shrink-0 text-xs font-medium',
                  row.done
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                )}
              >
                {row.done ? 'Done' : `${row.crew} on site — none`}
              </span>
            </div>
          ))}
          <MoreNote total={data.length} />
        </div>
      )}
    </DashboardCard>
  )
}
```

Import the `PrestartTodayRow` type from wherever the sibling cards' row types live (this file defines them locally — keep it local and have page.tsx import it from `dashboard-cards.tsx`, matching `ComplianceRow`).

- [ ] **Step 3: Verify in preview** — office dashboard renders the card ("No crew assigned today" when the roster is empty). Typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(office)/page.tsx" "src/app/(office)/dashboard-cards.tsx"
git commit -m "feat: dashboard card — crews on site today vs pre-start meetings done"
```

---

## Phase 3 — Amendments for immutable form submissions

### Task 8: Migration — `amends` self-reference

**Files:**
- Create: `supabase/migrations/0040_form_amendments.sql`

- [ ] **Step 1: Write + apply**

```sql
-- Corrections without mutation: a submission may declare it AMENDS an earlier
-- one. Both rows stay immutable (no UPDATE policy exists on form_submissions);
-- the chain is the audit trail.
alter table form_submissions
  add column amends uuid references form_submissions(id);
create index form_submissions_amends_idx
  on form_submissions (amends) where amends is not null;
```

Run: `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'; npx supabase db push` → applied.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0040_form_amendments.sql
git commit -m "feat: form submissions can amend an earlier submission"
```

### Task 9: Amend flow — action, prefilled form, banners

**Files:**
- Modify: `src/lib/zod.ts` (`formSubmissionSchema` — grep for it; add `amends`)
- Modify: `src/app/field/safety/new/[templateId]/actions.ts` (`submitForm`)
- Modify: `src/app/field/safety/new/[templateId]/page.tsx` (read `?amends=`, fetch original)
- Modify: `src/app/field/safety/new/[templateId]/form-renderer.tsx` (initial values + amends passthrough + banner)
- Modify: `src/app/field/safety/submission/[id]/page.tsx` (Amend button + chain banners)

- [ ] **Step 1: zod** — add to `formSubmissionSchema`:

```ts
  amends: z.uuid().nullish().transform((v) => v ?? null),
```

- [ ] **Step 2: `submitForm`** — after the template checks, validate the amend target and include it in the insert:

```ts
  // Amendments: the original must exist, be the same kind, and be the
  // caller's own unless they're staff. Both rows stay immutable — the new
  // row supersedes the old one by reference.
  if (parsed.data.amends) {
    const { data: original } = await supabase
      .from('form_submissions')
      .select('id, kind, submitted_by')
      .eq('id', parsed.data.amends)
      .maybeSingle()
    if (!original) return { error: 'The submission being amended no longer exists' }
    if (original.kind !== template.kind) {
      return { error: 'An amendment must use the same form kind as the original' }
    }
    const isStaff = ['admin', 'office', 'supervisor'].includes(profile.role)
    if (!isStaff && original.submitted_by !== profile.id) {
      return { error: 'You can only amend your own submissions' }
    }
  }
```

and in the `.insert({...})` payload: `amends: parsed.data.amends,`

- [ ] **Step 3: `new/[templateId]/page.tsx`** — extend `searchParams` type with `amends?: string`; after the template fetch:

```ts
  // Amend mode: prefill from the original submission (?amends=<id>).
  let amendsId: string | null = null
  let initialValues: Record<string, unknown> | null = null
  let amendProjectId: string | null = null
  let amendJobId: string | null = null
  if (sp.amends) {
    const { data: original } = await supabase
      .from('form_submissions')
      .select('id, kind, data, project_id, job_id')
      .eq('id', sp.amends)
      .maybeSingle()
    if (original && original.kind === template.kind) {
      amendsId = original.id as string
      initialValues = (original.data ?? {}) as Record<string, unknown>
      amendProjectId = original.project_id as string | null
      amendJobId = original.job_id as string | null
    }
  }
```

Fold the amend target into the preselect logic (amend target wins over `?project=`/`?job=`):

```ts
  const requestedProject = amendProjectId ?? sp.project
  const requestedJob = amendJobId ?? sp.job
  const defaultProjectId =
    requestedProject && projects.some((p) => p.id === requestedProject)
      ? requestedProject
      : null
  const defaultJobId =
    !defaultProjectId && requestedJob && jobs.some((j) => j.id === requestedJob)
      ? requestedJob
      : null
```

Pass `amendsId={amendsId}` and `initialValues={initialValues}` to `<FormRenderer …>`.

- [ ] **Step 4: `form-renderer.tsx`** — add props `amendsId?: string | null` and `initialValues?: Record<string, unknown> | null`; seed state `useState<Record<string, unknown>>(initialValues ?? {})`; include `amends: amendsId ?? null` in the `submitForm` payload; render an info banner above the form when `amendsId` is set:

```tsx
      {amendsId && (
        <div className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm dark:border-blue-800 dark:bg-blue-950">
          Amending an earlier submission — this creates a new record and keeps
          the original for the audit trail.
        </div>
      )}
```

- [ ] **Step 5: `submission/[id]/page.tsx`** — add `amends` to the submission select; fetch the forward link:

```ts
  const { data: amendedBy } = await supabase
    .from('form_submissions')
    .select('id, submitted_at')
    .eq('amends', id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
```

Render banners under the "Submitted by" line: if `amendedBy` — amber "This submission has been amended — view the current version" linking to `/field/safety/submission/${amendedBy.id}`; if `submission.amends` — muted "Amends an earlier submission" linking to `/field/safety/submission/${submission.amends}`. Add an "Amend" button (next to the existing ShareLinkDialog controls) when `(isMine || isStaff) && !amendedBy && submission.template_id`:

```tsx
          <Button asChild variant="outline" size="sm">
            <Link href={`/field/safety/new/${submission.template_id}?amends=${submission.id}`}>
              Amend
            </Link>
          </Button>
```

- [ ] **Step 6: Verify** — typecheck + full test suite green; in preview, open an existing form submission as admin → Amend button renders, amend page shows prefilled values + banner. Do NOT submit an amendment against real data (live DB) — submit-path correctness is covered by the server checks and typecheck; if a live check is essential, amend a `zz`-prefixed test submission and delete both rows as admin afterwards.

- [ ] **Step 7: Commit**

```bash
git add src/lib/zod.ts src/app/field/safety/new/[templateId]/actions.ts "src/app/field/safety/new/[templateId]/page.tsx" src/app/field/safety/new/[templateId]/form-renderer.tsx "src/app/field/safety/submission/[id]/page.tsx"
git commit -m "feat: amend flow for form submissions — immutable chain, prefilled resubmit"
```

---

## Final verification (after all phases)

- [ ] `npx vitest run --maxWorkers=1` → all green
- [ ] `npx tsc --noEmit` → clean
- [ ] `npm run lint` → no errors
- [ ] Preview click-through: project overview mobilisation card, My Day (field login), dashboard card, submission Amend button
- [ ] Push to `main` → Vercel auto-deploy → confirm Ready

## Explicitly out of scope (deliberate)

- Tightening `job_checklist_items` UPDATE RLS — field ticking job checklist items is a documented deliberate decision (`0003_rls.sql:180-181`); the new project checklist is staff-only instead.
- Assignment-scoped RLS on jobs/projects — deferred until non-employees get logins.
- Quote un-accept, competency hard-blocks — noted as future follow-ups.
- Cost-code mapping at conversion (quote section → cost code) — needs an owner decision on where codes come from (section titles have no code semantics today).
