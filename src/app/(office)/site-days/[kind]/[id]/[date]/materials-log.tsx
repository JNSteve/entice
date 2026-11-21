'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'
import { buildSignoff } from '@/lib/signoff-actions'
import { describeUsage, materialsEditable, type DayRef, type UsageLine } from '@/lib/site-days'
import {
  addUsageLine,
  deleteUsageLine,
  saveWorkSummary,
  updateUsageLine,
} from '@/app/(office)/site-days/actions'

type Result = { error?: string }
type Kind = UsageLine['kind']

const KIND_LABELS: Record<Kind, string> = {
  material: 'Material',
  plant: 'Plant',
  subbie: 'Subbie',
}

type Draft = {
  kind: Kind
  description: string
  qty: string
  unit: string
  company: string
  headcount: string
  hours: string
}

const EMPTY: Draft = {
  kind: 'material',
  description: '',
  qty: '',
  unit: '',
  company: '',
  headcount: '',
  hours: '',
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))
const text = (n: number | null): string => (n === null ? '' : String(n))

function toInput(d: Draft) {
  return {
    kind: d.kind,
    description: d.description,
    qty: num(d.qty),
    unit: d.unit.trim() || null,
    company: d.company.trim() || null,
    headcount: num(d.headcount),
    hours: num(d.hours),
  }
}

function fromLine(l: UsageLine): Draft {
  return {
    kind: l.kind,
    description: l.description,
    qty: text(l.qty),
    unit: l.unit ?? '',
    company: l.company ?? '',
    headcount: text(l.headcount),
    hours: text(l.hours),
  }
}

/** The fields for one line; the type is fixed when editing. */
function LineFields({
  draft,
  onChange,
  lockKind,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  lockKind: boolean
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium">
        Type
        <select
          aria-label="Line type"
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={draft.kind}
          disabled={lockKind}
          onChange={(e) => set({ kind: e.target.value as Kind })}
        >
          <option value="material">Material</option>
          <option value="plant">Plant</option>
          <option value="subbie">Subbie</option>
        </select>
      </label>
      {draft.kind === 'subbie' ? (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Company
            <Input
              aria-label="Company"
              className="w-52"
              value={draft.company}
              onChange={(e) => set({ company: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            People
            <Input
              type="number"
              min={1}
              step={1}
              aria-label="People"
              className="w-20"
              value={draft.headcount}
              onChange={(e) => set({ headcount: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Hours
            <Input
              type="number"
              min={0}
              step="0.25"
              aria-label="Hours"
              className="w-20"
              value={draft.hours}
              onChange={(e) => set({ hours: e.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Item
            <Input
              aria-label="Item"
              className="w-64"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {draft.kind === 'plant' ? 'Hours' : 'Qty'}
            <Input
              type="number"
              min={0}
              step="any"
              aria-label="Quantity"
              className="w-24"
              value={draft.qty}
              onChange={(e) => set({ qty: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Unit
            <Input
              aria-label="Unit"
              className="w-20"
              placeholder={draft.kind === 'plant' ? 'hrs' : ''}
              value={draft.unit}
              onChange={(e) => set({ unit: e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  )
}

export function MaterialsLog({
  dayRef,
  lines,
  summary,
  signoff,
  canBuild,
}: {
  dayRef: DayRef
  lines: UsageLine[]
  summary: string
  signoff: { id: string; status: string } | null
  /** Admin and office only — the existing sign-off rule. */
  canBuild: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY)
  const [summaryText, setSummaryText] = useState(summary)

  const editable = materialsEditable(signoff)

  function run(action: () => Promise<Result>, done?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        toast.error(result.error)
        return
      }
      done?.()
    })
  }

  function build() {
    startTransition(async () => {
      const result = await buildSignoff(dayRef.kind, dayRef.workId, dayRef.date)
      if (result.error || !result.id) {
        toast.error(result.error ?? 'Could not build the sign-off')
        return
      }
      router.push(`/signoffs/${result.id}`)
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Materials, plant and subbies</h2>
        <div className="flex flex-wrap items-center gap-2">
          {signoff ? (
            <>
              <SignoffStatusBadge status={signoff.status} />
              <Button variant="outline" size="sm" render={<Link href={`/signoffs/${signoff.id}`} />}>
                Open sign-off
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding((v) => !v)}
                disabled={pending}
              >
                <PlusIcon />
                Add line
              </Button>
              {canBuild && (
                <Button variant="outline" size="sm" onClick={build} disabled={pending}>
                  Build sign-off
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {!editable && (
        <p className="text-sm text-muted-foreground">
          {canBuild
            ? 'This day has a sign-off, so the log is read-only here. Change the figures in the sign-off.'
            : 'This day has a sign-off, so the log is read-only here. Ask the office to change the figures in the sign-off.'}
        </p>
      )}

      {editable && adding && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <LineFields draft={newDraft} onChange={setNewDraft} lockKind={false} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => addUsageLine(dayRef, toInput(newDraft)),
                  () => {
                    setAdding(false)
                    setNewDraft(EMPTY)
                  }
                )
              }
            >
              Add
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing was logged on this day.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Logged by</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const shown = describeUsage(line)
                if (editable && editingId === line.id) {
                  return (
                    <TableRow key={line.id}>
                      <TableCell colSpan={5}>
                        <div className="flex flex-col gap-2">
                          <LineFields draft={draft} onChange={setDraft} lockKind />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => updateUsageLine(dayRef, line.id, toInput(draft)),
                                  () => setEditingId(null)
                                )
                              }
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                }
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Badge variant="outline">{KIND_LABELS[line.kind]}</Badge>
                    </TableCell>
                    <TableCell>
                      {shown.item}
                      {line.notes && (
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{line.notes}</p>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{shown.qty}</TableCell>
                    <TableCell className="text-muted-foreground">{line.loggedBy ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {editable && (
                        <span className="inline-flex gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={`Edit ${shown.item}`}
                            onClick={() => {
                              setDraft(fromLine(line))
                              setEditingId(line.id)
                            }}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={`Delete ${shown.item}`}
                            onClick={() => {
                              if (!confirm(`Delete ${shown.item}?`)) return
                              run(() => deleteUsageLine(dayRef, line.id))
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Work summary</h3>
        {editable ? (
          <>
            <Textarea
              aria-label="Work summary"
              rows={3}
              maxLength={4000}
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
            />
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || summaryText.trim() === summary}
                onClick={() =>
                  run(
                    () => saveWorkSummary(dayRef, summaryText),
                    () => toast.success('Summary saved')
                  )
                }
              >
                Save summary
              </Button>
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {summary || 'No summary was written.'}
          </p>
        )}
      </div>
    </section>
  )
}
