'use client'

import React, { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { DownloadIcon, LeafIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/EmptyState'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { significanceScore, isSignificant } from '@/lib/env'
import { createEnvAspect, updateEnvAspect, deleteEnvAspect } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AspectRow {
  id: string
  activity: string
  aspect: string
  impact: string
  likelihood: number
  severity: number
  significance: number
  significant: boolean
  existing_controls: string | null
  objective_id: string | null
  objective_label: string | null
}

export interface ObjectiveOption {
  id: string
  label: string
}

// ─── Significance badge ───────────────────────────────────────────────────────

export function SignificanceBadge({
  score,
  significant,
}: {
  score: number
  significant: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        significant
          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300'
          : 'border-green-200 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300'
      )}
    >
      {score}
      {significant ? ' — Significant' : ''}
    </span>
  )
}

// ─── Add/edit dialog (edit-in-place — the audit trigger carries the history) ──

function AspectDialog({
  open,
  onOpenChange,
  objectives,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  objectives: ObjectiveOption[]
  existing?: AspectRow
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState(() => ({
    activity: existing?.activity ?? '',
    aspect: existing?.aspect ?? '',
    impact: existing?.impact ?? '',
    likelihood: String(existing?.likelihood ?? 3),
    severity: String(existing?.severity ?? 3),
    existing_controls: existing?.existing_controls ?? '',
    objective_id: existing?.objective_id ?? '',
  }))

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const previewScore = significanceScore(
    Number(form.likelihood),
    Number(form.severity)
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      activity: form.activity,
      aspect: form.aspect,
      impact: form.impact,
      likelihood: form.likelihood,
      severity: form.severity,
      existing_controls: form.existing_controls || null,
      objective_id: form.objective_id || null,
    }
    startTransition(async () => {
      const result = existing
        ? await updateEnvAspect(existing.id, payload)
        : await createEnvAspect(payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(existing ? 'Aspect updated' : 'Aspect added')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit aspect' : 'Add aspect'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Activity</Label>
            <Input
              value={form.activity}
              onChange={(e) => field('activity', e.target.value)}
              placeholder="e.g. Bulk earthworks"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Environmental aspect</Label>
            <Input
              value={form.aspect}
              onChange={(e) => field('aspect', e.target.value)}
              placeholder="How the activity interacts with the environment"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Impact</Label>
            <Textarea
              value={form.impact}
              onChange={(e) => field('impact', e.target.value)}
              placeholder="What could happen"
              rows={2}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Likelihood (1–5)</Label>
              <Select
                value={form.likelihood}
                onValueChange={(v) => v && field('likelihood', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Severity (1–5)</Label>
              <Select
                value={form.severity}
                onValueChange={(v) => v && field('severity', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Significance:</span>
            <SignificanceBadge
              score={previewScore}
              significant={isSignificant(previewScore)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Existing controls</Label>
            <Textarea
              value={form.existing_controls}
              onChange={(e) => field('existing_controls', e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Related objective</Label>
            <Select
              value={form.objective_id || '__none'}
              onValueChange={(v) =>
                field('objective_id', !v || v === '__none' ? '' : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {objectives.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : existing ? 'Save' : 'Add aspect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function AspectsSection({
  aspects,
  objectives,
  canManage,
  isAdmin,
}: {
  aspects: AspectRow[]
  objectives: ObjectiveOption[]
  /** admin/office — supervisors read only. */
  canManage: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [significantOnly, setSignificantOnly] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AspectRow | null>(null)

  const filtered = useMemo(
    () => (significantOnly ? aspects.filter((a) => a.significant) : aspects),
    [aspects, significantOnly]
  )

  function handleDelete(aspect: AspectRow) {
    if (!confirm(`Delete the aspect "${aspect.aspect}"?`)) return
    startTransition(async () => {
      const result = await deleteEnvAspect(aspect.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Aspect deleted')
      router.refresh()
    })
  }

  function exportCsv() {
    downloadCsv(
      'environmental-aspects.csv',
      filtered.map((a) => ({
        activity: a.activity,
        aspect: a.aspect,
        impact: a.impact,
        likelihood: a.likelihood,
        severity: a.severity,
        significance: a.significance,
        significant: a.significant ? 'Yes' : 'No',
        existing_controls: a.existing_controls ?? '',
        objective: a.objective_label ?? '',
      }))
    )
  }

  const significantCount = aspects.filter((a) => a.significant).length

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Aspects &amp; impacts register</h2>
          <span className="text-xs text-muted-foreground">
            {aspects.length} aspects · {significantCount} significant
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSignificantOnly((v) => !v)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              significantOnly
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            Significant only
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <PlusIcon className="size-4" />
              Add aspect
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<LeafIcon className="size-8" />}
          title="No aspects"
          description="The company-wide environmental aspects and impacts library (ISO 14001 6.1.2)."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Activity</TableHead>
                <TableHead>Aspect / impact</TableHead>
                <TableHead className="text-center">L</TableHead>
                <TableHead className="text-center">S</TableHead>
                <TableHead>Significance</TableHead>
                <TableHead>Existing controls</TableHead>
                <TableHead>Objective</TableHead>
                {canManage && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-[160px] text-sm font-medium">
                    {a.activity}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="flex flex-col">
                      <span className="text-sm">{a.aspect}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {a.impact}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-sm tabular-nums">
                    {a.likelihood}
                  </TableCell>
                  <TableCell className="text-center text-sm tabular-nums">
                    {a.severity}
                  </TableCell>
                  <TableCell>
                    <SignificanceBadge
                      score={a.significance}
                      significant={a.significant}
                    />
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {a.existing_controls ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                    {a.objective_label ?? '—'}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(a)
                            setDialogOpen(true)
                          }}
                          aria-label={`Edit ${a.aspect}`}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleDelete(a)}
                            aria-label={`Delete ${a.aspect}`}
                          >
                            <Trash2Icon className="size-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogOpen && (
        <AspectDialog
          key={editing?.id ?? 'new'}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          objectives={objectives}
          existing={editing ?? undefined}
        />
      )}
    </section>
  )
}
