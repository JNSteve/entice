'use client'

import React, { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  TargetIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshCwIcon,
  Clock3Icon,
} from 'lucide-react'
import { LineChart, Line, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import {
  AUTO_METRIC_KEYS,
  AUTO_METRIC_LABELS,
  OBJECTIVE_TRAFFIC_LABELS,
  periodKeyLabel,
  type ObjectiveTrafficStatus,
} from '@/lib/objectives'
import {
  OBJECTIVE_DIRECTIONS,
  OBJECTIVE_DIRECTION_LABELS,
  OBJECTIVE_PERIODS,
  OBJECTIVE_PERIOD_LABELS,
  OBJECTIVE_SOURCES,
  OBJECTIVE_SOURCE_LABELS,
  RISK_DOMAINS,
  RISK_DOMAIN_LABELS,
  type ObjectiveDirection,
  type ObjectivePeriod,
  type ObjectiveSource,
  type ObjectiveStatus,
  type RiskDomain,
} from '@/lib/zod'
import { createObjective, refreshKpis, upsertCompanyHours } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  period: string
  value: number
}

export interface ObjectiveCardRow {
  id: string
  number: string
  title: string
  iso_domain: RiskDomain
  metric_name: string
  unit: string
  target_value: number
  direction: ObjectiveDirection
  period: ObjectivePeriod
  source: ObjectiveSource
  status: ObjectiveStatus
  owner_name: string | null
  latest_period: string | null
  latest_value: number | null
  traffic: ObjectiveTrafficStatus
  trend: TrendPoint[]
  open_action_count: number
  /** True when the latest value is the still-running period (period to date). */
  is_current_period: boolean
}

export interface HoursRow {
  period_key: string
  hours: number
}

export interface ProfileOption {
  id: string
  full_name: string
}

// ─── Traffic light (shares the ComplianceLight visual language) ───────────────

const TRAFFIC_DOT: Record<ObjectiveTrafficStatus, string> = {
  on_track: 'bg-green-500',
  at_risk: 'bg-amber-400',
  off_track: 'bg-red-500',
  no_data: 'bg-gray-300 dark:bg-gray-600',
}

const TRAFFIC_TEXT: Record<ObjectiveTrafficStatus, string> = {
  on_track: 'text-green-700 dark:text-green-400',
  at_risk: 'text-amber-600 dark:text-amber-400',
  off_track: 'text-red-600 dark:text-red-400',
  no_data: 'text-muted-foreground',
}

export function ObjectiveTrafficLight({
  status,
  withLabel,
}: {
  status: ObjectiveTrafficStatus
  withLabel?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block size-3 rounded-full ${TRAFFIC_DOT[status]}`}
        title={OBJECTIVE_TRAFFIC_LABELS[status]}
        aria-label={OBJECTIVE_TRAFFIC_LABELS[status]}
      />
      {withLabel && (
        <span className={cn('text-xs font-medium', TRAFFIC_TEXT[status])}>
          {OBJECTIVE_TRAFFIC_LABELS[status]}
        </span>
      )}
    </span>
  )
}

export function fmtKpiValue(value: number | null, unit: string): string {
  if (value == null) return '—'
  const n = parseFloat(value.toFixed(2))
  return unit === '%' ? `${n}%` : String(n)
}

export function targetLabel(direction: ObjectiveDirection, target: number, unit: string): string {
  return `${direction === 'at_most' ? '≤' : '≥'} ${fmtKpiValue(target, unit)}`
}

const TRAFFIC_STROKE: Record<ObjectiveTrafficStatus, string> = {
  on_track: '#16a34a',
  at_risk: '#d97706',
  off_track: '#dc2626',
  no_data: '#94a3b8',
}

function Sparkline({
  trend,
  target,
  traffic,
}: {
  trend: TrendPoint[]
  target: number
  traffic: ObjectiveTrafficStatus
}) {
  if (trend.length < 2) {
    return (
      <div className="flex h-12 items-center text-xs text-muted-foreground">
        {trend.length === 1 ? 'One period recorded' : 'No trend yet'}
      </div>
    )
  }
  return (
    <div className="h-12">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trend} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['auto', 'auto']} />
          <ReferenceLine y={target} stroke="#94a3b8" strokeDasharray="4 3" />
          <Line
            type="monotone"
            dataKey="value"
            stroke={TRAFFIC_STROKE[traffic]}
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── New objective dialog ─────────────────────────────────────────────────────

function AddObjectiveDialog({
  open,
  onOpenChange,
  profiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: ProfileOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    title: '',
    description: '',
    iso_domain: 'quality' as RiskDomain,
    metric_name: '',
    unit: '%',
    target_value: '',
    direction: 'at_least' as ObjectiveDirection,
    period: 'monthly' as ObjectivePeriod,
    source: 'manual' as ObjectiveSource,
    auto_metric_key: '',
    owner_id: '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createObjective({
        title: form.title,
        description: form.description || null,
        iso_domain: form.iso_domain,
        metric_name: form.metric_name,
        unit: form.unit,
        target_value: form.target_value,
        direction: form.direction,
        period: form.period,
        source: form.source,
        auto_metric_key:
          form.source === 'auto' ? form.auto_metric_key || null : null,
        owner_id: form.owner_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Objective created')
      onOpenChange(false)
      if (result.id) router.push(`/whs/objectives/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New objective</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => field('title', e.target.value)}
              placeholder="What the business is aiming for"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
              placeholder="How the KPI is measured and why the target matters"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
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
            <div className="flex flex-col gap-1.5">
              <Label>Period</Label>
              <Select
                value={form.period}
                onValueChange={(v) => v && field('period', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBJECTIVE_PERIODS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {OBJECTIVE_PERIOD_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>KPI / metric name</Label>
              <Input
                value={form.metric_name}
                onChange={(e) => field('metric_name', e.target.value)}
                placeholder="e.g. Rework rate"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unit</Label>
              <Input
                value={form.unit}
                onChange={(e) => field('unit', e.target.value)}
                placeholder="%, count, rate, score…"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Target</Label>
              <Input
                type="number"
                step="any"
                value={form.target_value}
                onChange={(e) => field('target_value', e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Direction</Label>
              <Select
                value={form.direction}
                onValueChange={(v) => v && field('direction', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBJECTIVE_DIRECTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {OBJECTIVE_DIRECTION_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                  {OBJECTIVE_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {OBJECTIVE_SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.source === 'auto' && (
              <div className="flex flex-col gap-1.5">
                <Label>Auto metric</Label>
                <Select
                  value={form.auto_metric_key}
                  onValueChange={(v) => v && field('auto_metric_key', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTO_METRIC_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {AUTO_METRIC_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

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

          <p className="text-xs text-muted-foreground">
            One source per objective: an auto objective is computed by the
            metrics engine only; a manual objective is entered period-by-period.
            The source cannot be changed later — retire and re-raise instead.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Enter hours dialog (LTIFR denominator) ───────────────────────────────────

function EnterHoursDialog({
  open,
  onOpenChange,
  hours,
  currentMonth,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hours: HoursRow[]
  currentMonth: string
}) {
  const [pending, startTransition] = useTransition()
  const [month, setMonth] = useState(currentMonth)
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertCompanyHours({ period_key: month, hours: value })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Hours recorded for ${periodKeyLabel(month)}`)
      setValue('')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Company hours worked</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Total hours worked across the company for the month (payroll
            figure) — the LTIFR denominator. Entering a month again replaces
            its value; every change is audit-logged.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Month</Label>
              <Input
                type="month"
                value={month}
                max={currentMonth}
                onChange={(e) => setMonth(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Hours worked</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 4000"
                required
              />
            </div>
          </div>

          {hours.length > 0 && (
            <div className="rounded-md border p-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent months
              </p>
              <div className="flex flex-col gap-1">
                {hours.slice(0, 6).map((h) => (
                  <div key={h.period_key} className="flex justify-between text-sm">
                    <span>{periodKeyLabel(h.period_key)}</span>
                    <span className="tabular-nums">{h.hours.toLocaleString()} h</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save hours'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function ObjectivesClient({
  items,
  hours,
  profiles,
  canManage,
  currentMonth,
}: {
  items: ObjectiveCardRow[]
  hours: HoursRow[]
  profiles: ProfileOption[]
  canManage: boolean
  currentMonth: string
}) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')
  const [addOpen, setAddOpen] = useState(false)
  const [hoursOpen, setHoursOpen] = useState(false)
  const [refreshing, startRefresh] = useTransition()

  const filtered = useMemo(
    () =>
      statusFilter === 'all' ? items : items.filter((o) => o.status === 'active'),
    [items, statusFilter]
  )

  function handleRefresh() {
    startRefresh(async () => {
      const { error, result } = await refreshKpis()
      if (error) {
        toast.error(error)
        return
      }
      if (result) {
        const n = result.refreshed.length
        toast.success(
          `Metrics refreshed — ${n} value${n === 1 ? '' : 's'} computed` +
            (result.skippedNoData > 0
              ? `, ${result.skippedNoData} period${result.skippedNoData === 1 ? '' : 's'} without data`
              : '')
        )
        if (result.errors.length > 0) {
          toast.error(result.errors[0])
        }
        router.refresh()
      }
    })
  }

  function exportCsv() {
    downloadCsv(
      'objectives.csv',
      filtered.map((o) => ({
        number: o.number,
        title: o.title,
        domain: RISK_DOMAIN_LABELS[o.iso_domain],
        metric: o.metric_name,
        unit: o.unit,
        target: `${o.direction === 'at_most' ? '<=' : '>='} ${o.target_value}`,
        period: OBJECTIVE_PERIOD_LABELS[o.period],
        source: OBJECTIVE_SOURCE_LABELS[o.source],
        latest_period: o.latest_period ?? '',
        latest_value: o.latest_value ?? '',
        traffic: OBJECTIVE_TRAFFIC_LABELS[o.traffic],
        owner: o.owner_name ?? '',
        open_actions: o.open_action_count,
        status: o.status,
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {(['active', 'all'] as const).map((s) => (
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
              {s === 'active' ? 'Active' : 'All'}{' '}
              <span className="text-xs opacity-70">
                {s === 'active'
                  ? items.filter((o) => o.status === 'active').length
                  : items.length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            render={
              <a
                href="/api/pdf/objectives/list"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <FileTextIcon className="size-4" />
            PDF
          </Button>
          {canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setHoursOpen(true)}>
                <Clock3Icon className="size-4" />
                Enter hours
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCwIcon className={cn('size-4', refreshing && 'animate-spin')} />
                {refreshing ? 'Refreshing…' : 'Refresh metrics'}
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <PlusIcon className="size-4" />
                New objective
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<TargetIcon className="size-8" />}
          title="No objectives"
          description="No objectives match the current filter."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((o) => (
            <Link key={o.id} href={`/whs/objectives/${o.id}`} className="group">
              <Card
                size="sm"
                className="h-full transition-colors group-hover:border-muted-foreground/40"
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm leading-snug group-hover:underline">
                      {o.title}
                    </CardTitle>
                    <ObjectiveTrafficLight status={o.traffic} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {o.number} · {RISK_DOMAIN_LABELS[o.iso_domain]} ·{' '}
                    {OBJECTIVE_PERIOD_LABELS[o.period]} ·{' '}
                    {OBJECTIVE_SOURCE_LABELS[o.source]}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'text-2xl font-semibold tabular-nums',
                          TRAFFIC_TEXT[o.traffic]
                        )}
                      >
                        {fmtKpiValue(o.latest_value, o.unit)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        target {targetLabel(o.direction, o.target_value, o.unit)}
                      </span>
                    </div>
                    {o.status !== 'active' && <StatusBadge status={o.status} />}
                  </div>
                  <Sparkline
                    trend={o.trend}
                    target={o.target_value}
                    traffic={o.traffic}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {o.latest_period
                        ? `${periodKeyLabel(o.latest_period)}${o.is_current_period ? ' (to date)' : ''}`
                        : 'No periods recorded yet'}
                    </span>
                    {o.open_action_count > 0 && (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {o.open_action_count} open action
                        {o.open_action_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <AddObjectiveDialog open={addOpen} onOpenChange={setAddOpen} profiles={profiles} />
      <EnterHoursDialog
        open={hoursOpen}
        onOpenChange={setHoursOpen}
        hours={hours}
        currentMonth={currentMonth}
      />
    </div>
  )
}
