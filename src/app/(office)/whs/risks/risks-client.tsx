'use client'

import React, { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  ShieldAlertIcon,
  DownloadIcon,
  FileTextIcon,
  TrendingUpIcon,
} from 'lucide-react'
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
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { fmtDate } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import {
  riskRating,
  LIKELIHOOD_LABELS,
  CONSEQUENCE_LABELS,
  type RiskRating,
} from '@/lib/risk'
import {
  RISK_KINDS,
  RISK_KIND_LABELS,
  RISK_SOURCES,
  RISK_SOURCE_LABELS,
  RISK_DOMAINS,
  RISK_DOMAIN_LABELS,
  RISK_STATUSES,
  RISK_STATUS_LABELS,
  RISK_CATEGORIES,
  type RiskKind,
  type RiskSource,
  type RiskDomain,
  type RiskStatus,
} from '@/lib/zod'
import { createRiskItem } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskRow {
  id: string
  number: string
  kind: RiskKind
  title: string
  source: RiskSource
  iso_domain: RiskDomain
  category: string | null
  project_id: string | null
  project_label: string | null
  likelihood: number
  consequence: number
  inherent_score: number
  inherent_rating: RiskRating
  residual_likelihood: number | null
  residual_consequence: number | null
  residual_score: number | null
  residual_rating: RiskRating | null
  owner_name: string | null
  review_date: string | null
  status: RiskStatus
  open_treatment_count: number
}

export interface ProjectOption {
  id: string
  number: string
  name: string
}

export interface ProfileOption {
  id: string
  full_name: string
}

// ─── Rating badge (risks banded green→red; opportunities teal accent) ─────────

const RATING_CLASSES: Record<RiskRating, string> = {
  Low: 'border-green-200 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300',
  Medium:
    'border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300',
  High: 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300',
  Extreme:
    'border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-300',
}

const OPPORTUNITY_CLASS =
  'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-300'

export function RatingBadge({
  rating,
  score,
  kind,
}: {
  rating: RiskRating | null
  score: number | null
  kind: RiskKind
}) {
  if (!rating || score == null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        kind === 'opportunity' ? OPPORTUNITY_CLASS : RATING_CLASSES[rating]
      )}
    >
      {kind === 'opportunity' && <TrendingUpIcon className="size-3" />}
      {rating} {score}
    </span>
  )
}

// ─── 5×5 heat map ─────────────────────────────────────────────────────────────

// Cell colouring follows the fixed matrix bands of the CELL score (l×c).
const CELL_BAND_CLASSES: Record<RiskRating, string> = {
  Low: 'bg-green-100 dark:bg-green-950/60 text-green-900 dark:text-green-200',
  Medium:
    'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-900 dark:text-yellow-200',
  High: 'bg-orange-200 dark:bg-orange-950/70 text-orange-900 dark:text-orange-200',
  Extreme: 'bg-red-300 dark:bg-red-950/80 text-red-900 dark:text-red-200',
}

type HeatView = 'residual' | 'inherent'

function HeatMap({
  rows,
  view,
  onViewChange,
  selectedCell,
  onCellSelect,
}: {
  rows: RiskRow[]
  view: HeatView
  onViewChange: (v: HeatView) => void
  selectedCell: { l: number; c: number } | null
  onCellSelect: (cell: { l: number; c: number } | null) => void
}) {
  const counts = new Map<string, number>()
  let unscored = 0
  for (const r of rows) {
    const l = view === 'residual' ? r.residual_likelihood : r.likelihood
    const c = view === 'residual' ? r.residual_consequence : r.consequence
    if (l == null || c == null) {
      unscored++
      continue
    }
    const key = `${l}:${c}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Heat map — {view === 'residual' ? 'residual' : 'inherent'} risk
        </h2>
        <div className="flex gap-1">
          {(['residual', 'inherent'] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors',
                view === v
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {v === 'residual' ? 'Residual' : 'Inherent'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        {/* Y axis label */}
        <div className="flex items-center">
          <span
            className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Likelihood →
          </span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-6 gap-1">
            {/* Rows: likelihood 5 (top) → 1 (bottom); columns: consequence 1 → 5 */}
            {[5, 4, 3, 2, 1].map((l) => (
              <React.Fragment key={l}>
                <div
                  className="flex items-center justify-center text-xs text-muted-foreground tabular-nums"
                  title={LIKELIHOOD_LABELS[l]}
                >
                  {l}
                </div>
                {[1, 2, 3, 4, 5].map((c) => {
                  const score = l * c
                  const band = riskRating(score) as RiskRating
                  const count = counts.get(`${l}:${c}`) ?? 0
                  const selected = selectedCell?.l === l && selectedCell?.c === c
                  return (
                    <button
                      key={c}
                      onClick={() =>
                        onCellSelect(selected ? null : { l, c })
                      }
                      title={`L${l} (${LIKELIHOOD_LABELS[l]}) × C${c} (${CONSEQUENCE_LABELS[c]}) = ${score} ${band}`}
                      className={cn(
                        'flex h-10 items-center justify-center rounded-sm text-sm font-semibold tabular-nums transition-all',
                        CELL_BAND_CLASSES[band],
                        count === 0 && 'opacity-40',
                        selected && 'ring-2 ring-foreground ring-offset-1',
                        'hover:opacity-100'
                      )}
                    >
                      {count > 0 ? count : ''}
                    </button>
                  )
                })}
              </React.Fragment>
            ))}
            {/* X axis numbers */}
            <div />
            {[1, 2, 3, 4, 5].map((c) => (
              <div
                key={c}
                className="flex items-center justify-center text-xs text-muted-foreground tabular-nums"
                title={CONSEQUENCE_LABELS[c]}
              >
                {c}
              </div>
            ))}
          </div>
          <div className="mt-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Consequence →
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {view === 'residual' && unscored > 0
          ? `${unscored} item${unscored === 1 ? '' : 's'} without residual scores not shown. `
          : ''}
        Click a cell to filter the register.
      </p>
    </div>
  )
}

// ─── Add risk dialog ──────────────────────────────────────────────────────────

function AddRiskDialog({
  open,
  onOpenChange,
  projects,
  profiles,
  lockedProject,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: ProjectOption[]
  profiles: ProfileOption[]
  /** When set (project tab) the new item is scoped to this project. */
  lockedProject?: ProjectOption
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    kind: 'risk' as RiskKind,
    title: '',
    context: '',
    source: 'process' as RiskSource,
    iso_domain: 'quality' as RiskDomain,
    project_id: lockedProject?.id ?? '',
    category: '',
    existing_controls: '',
    likelihood: '3',
    consequence: '3',
    owner_id: '',
    review_date: '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const previewScore = Number(form.likelihood) * Number(form.consequence)
  const previewRating = riskRating(previewScore)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createRiskItem({
        kind: form.kind,
        title: form.title,
        context: form.context || null,
        source: form.source,
        iso_domain: form.iso_domain,
        project_id: (lockedProject?.id ?? form.project_id) || null,
        category: form.category || null,
        existing_controls: form.existing_controls || null,
        likelihood: form.likelihood,
        consequence: form.consequence,
        residual_likelihood: null,
        residual_consequence: null,
        owner_id: form.owner_id || null,
        review_date: form.review_date || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        form.kind === 'opportunity' ? 'Opportunity raised' : 'Risk raised'
      )
      onOpenChange(false)
      if (result.id) router.push(`/whs/risks/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Raise risk / opportunity
            {lockedProject ? ` — ${lockedProject.number}` : ''}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <Select value={form.kind} onValueChange={(v) => v && field('kind', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {RISK_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ISO domain</Label>
              <Select
                value={form.iso_domain}
                onValueChange={(v) => v && field('iso_domain', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_DOMAINS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {RISK_DOMAIN_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => field('title', e.target.value)}
              placeholder="Short summary of the risk or opportunity"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Context / description</Label>
            <Textarea
              value={form.context}
              onChange={(e) => field('context', e.target.value)}
              placeholder="What could happen, and what would the effect be?"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Source</Label>
              <Select
                value={form.source}
                onValueChange={(v) => v && field('source', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {RISK_SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => field('category', !v || v === '__none' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {RISK_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!lockedProject && (
            <div className="flex flex-col gap-1.5">
              <Label>Scope</Label>
              <Select
                value={form.project_id || '__company'}
                onValueChange={(v) =>
                  field('project_id', !v || v === '__company' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__company">Company-wide</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.number} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Existing controls</Label>
            <Textarea
              value={form.existing_controls}
              onChange={(e) => field('existing_controls', e.target.value)}
              placeholder="Controls already in place today"
              rows={2}
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
                      {n} — {LIKELIHOOD_LABELS[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                {form.kind === 'opportunity' ? 'Benefit (1–5)' : 'Consequence (1–5)'}
              </Label>
              <Select
                value={form.consequence}
                onValueChange={(v) => v && field('consequence', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} — {CONSEQUENCE_LABELS[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Inherent rating:</span>
            <RatingBadge
              rating={previewRating}
              score={previewScore}
              kind={form.kind}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Owner</Label>
              <Select
                value={form.owner_id}
                onValueChange={(v) => field('owner_id', !v || v === '__none' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Review date</Label>
              <Input
                type="date"
                value={form.review_date}
                onChange={(e) => field('review_date', e.target.value)}
              />
            </div>
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
              {pending ? 'Raising…' : 'Raise'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Register + heat map ──────────────────────────────────────────────────────

export function RisksClient({
  items,
  projects,
  profiles,
  lockedProject,
}: {
  items: RiskRow[]
  projects: ProjectOption[]
  profiles: ProfileOption[]
  /** Set on the project Risk tab: register is pre-filtered to this project. */
  lockedProject?: ProjectOption
}) {
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [scopeFilter, setScopeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [ratingFilter, setRatingFilter] = useState<string>('all')
  const [heatView, setHeatView] = useState<HeatView>('residual')
  const [heatCell, setHeatCell] = useState<{ l: number; c: number } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Effective rating = residual when scored, else inherent — the operational
  // "where is this risk today" view the rating filter works on.
  const filtered = useMemo(
    () =>
      items.filter((r) => {
        if (kindFilter !== 'all' && r.kind !== kindFilter) return false
        if (domainFilter !== 'all' && r.iso_domain !== domainFilter) return false
        if (scopeFilter === 'company' && r.project_id !== null) return false
        if (
          scopeFilter !== 'all' &&
          scopeFilter !== 'company' &&
          r.project_id !== scopeFilter
        )
          return false
        if (statusFilter !== 'all' && r.status !== statusFilter) return false
        if (ratingFilter !== 'all') {
          const effective = r.residual_rating ?? r.inherent_rating
          if (effective !== ratingFilter) return false
        }
        if (heatCell) {
          const l =
            heatView === 'residual' ? r.residual_likelihood : r.likelihood
          const c =
            heatView === 'residual' ? r.residual_consequence : r.consequence
          if (l !== heatCell.l || c !== heatCell.c) return false
        }
        return true
      }),
    [
      items,
      kindFilter,
      domainFilter,
      scopeFilter,
      statusFilter,
      ratingFilter,
      heatCell,
      heatView,
    ]
  )

  // Heat map reflects the dropdown filters but not its own cell selection.
  const heatRows = useMemo(
    () =>
      items.filter((r) => {
        if (kindFilter !== 'all' && r.kind !== kindFilter) return false
        if (domainFilter !== 'all' && r.iso_domain !== domainFilter) return false
        if (scopeFilter === 'company' && r.project_id !== null) return false
        if (
          scopeFilter !== 'all' &&
          scopeFilter !== 'company' &&
          r.project_id !== scopeFilter
        )
          return false
        if (statusFilter !== 'all' && r.status !== statusFilter) return false
        return true
      }),
    [items, kindFilter, domainFilter, scopeFilter, statusFilter]
  )

  function exportCsv() {
    downloadCsv(
      lockedProject
        ? `risk-register-${lockedProject.number}.csv`
        : 'risk-register.csv',
      filtered.map((r) => ({
        number: r.number,
        kind: RISK_KIND_LABELS[r.kind],
        title: r.title,
        domain: RISK_DOMAIN_LABELS[r.iso_domain],
        source: RISK_SOURCE_LABELS[r.source],
        category: r.category ?? '',
        scope: r.project_label ?? 'Company-wide',
        likelihood: r.likelihood,
        consequence: r.consequence,
        inherent_score: r.inherent_score,
        inherent_rating: r.inherent_rating,
        residual_likelihood: r.residual_likelihood ?? '',
        residual_consequence: r.residual_consequence ?? '',
        residual_score: r.residual_score ?? '',
        residual_rating: r.residual_rating ?? '',
        status: RISK_STATUS_LABELS[r.status],
        owner: r.owner_name ?? '',
        review_date: r.review_date ?? '',
        open_treatments: r.open_treatment_count,
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...RISK_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                statusFilter === s
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {s === 'all' ? 'All' : RISK_STATUS_LABELS[s as RiskStatus]}{' '}
              <span className="text-xs opacity-70">
                {s === 'all'
                  ? items.length
                  : items.filter((r) => r.status === s).length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v ?? 'all')}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All kinds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Risks + opps</SelectItem>
              {RISK_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {RISK_KIND_LABELS[k]}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={domainFilter}
            onValueChange={(v) => setDomainFilter(v ?? 'all')}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All domains</SelectItem>
              {RISK_DOMAINS.map((d) => (
                <SelectItem key={d} value={d}>
                  {RISK_DOMAIN_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!lockedProject && (
            <Select
              value={scopeFilter}
              onValueChange={(v) => setScopeFilter(v ?? 'all')}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All scopes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                <SelectItem value="company">Company-wide</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={ratingFilter}
            onValueChange={(v) => setRatingFilter(v ?? 'all')}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All ratings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ratings</SelectItem>
              {(['Low', 'Medium', 'High', 'Extreme'] as const).map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>

          {!lockedProject && (
            <Button
              size="sm"
              variant="outline"
              render={
                <a
                  href="/api/pdf/risk-register/list"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <FileTextIcon className="size-4" />
              PDF
            </Button>
          )}

          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add risk
          </Button>
        </div>
      </div>

      {/* Heat map */}
      <HeatMap
        rows={heatRows}
        view={heatView}
        onViewChange={(v) => {
          setHeatView(v)
          setHeatCell(null)
        }}
        selectedCell={heatCell}
        onCellSelect={setHeatCell}
      />

      {/* Register */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ShieldAlertIcon className="size-8" />}
          title="No items"
          description="No risks or opportunities match the current filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Domain</TableHead>
                {!lockedProject && <TableHead>Scope</TableHead>}
                <TableHead>Inherent</TableHead>
                <TableHead>Residual</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Treatments</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/whs/risks/${row.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {row.number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="flex flex-col">
                      <Link
                        href={`/whs/risks/${row.id}`}
                        className="truncate text-sm hover:underline"
                      >
                        {row.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {RISK_KIND_LABELS[row.kind]}
                        {row.category ? ` · ${row.category}` : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {RISK_DOMAIN_LABELS[row.iso_domain]}
                  </TableCell>
                  {!lockedProject && (
                    <TableCell className="max-w-[140px] truncate text-sm text-muted-foreground">
                      {row.project_label ?? 'Company-wide'}
                    </TableCell>
                  )}
                  <TableCell>
                    <RatingBadge
                      rating={row.inherent_rating}
                      score={row.inherent_score}
                      kind={row.kind}
                    />
                  </TableCell>
                  <TableCell>
                    <RatingBadge
                      rating={row.residual_rating}
                      score={row.residual_score}
                      kind={row.kind}
                    />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.open_treatment_count > 0 ? (
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        {row.open_treatment_count} open
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {row.review_date ? fmtDate(row.review_date) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddRiskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={projects}
        profiles={profiles}
        lockedProject={lockedProject}
      />
    </div>
  )
}
