'use client'

import React, { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  DownloadIcon,
  RefreshCwIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  UndoIcon,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { AuditHistory } from '@/components/AuditHistory'
import type { AuditRow } from '@/lib/audit-queries'
import { fmtDate } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import {
  AUTO_METRIC_LABELS,
  deriveObjectiveStatus,
  periodKeyLabel,
  type AutoMetricKey,
} from '@/lib/objectives'
import {
  OBJECTIVE_DIRECTION_LABELS,
  OBJECTIVE_PERIOD_LABELS,
  OBJECTIVE_SOURCE_LABELS,
  OBJECTIVE_STATUSES,
  OBJECTIVE_STATUS_LABELS,
  RISK_DOMAINS,
  RISK_DOMAIN_LABELS,
  type ObjectiveDirection,
  type ObjectivePeriod,
  type ObjectiveSource,
  type ObjectiveStatus,
  type RiskDomain,
} from '@/lib/zod'
import {
  ObjectiveTrafficLight,
  fmtKpiValue,
  targetLabel,
  type ProfileOption,
} from '../objectives-client'
import {
  createObjectiveAction,
  deleteObjective,
  deleteObjectiveAction,
  enterManualKpiValue,
  refreshKpis,
  setObjectiveActionDone,
  setObjectiveStatus,
  updateObjective,
  updateObjectiveAction,
} from '../actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObjectiveDetailData {
  id: string
  number: string
  title: string
  description: string | null
  iso_domain: RiskDomain
  metric_name: string
  unit: string
  target_value: number
  direction: ObjectiveDirection
  period: ObjectivePeriod
  source: ObjectiveSource
  auto_metric_key: string | null
  status: ObjectiveStatus
  owner_id: string | null
  owner_name: string | null
  created_by_name: string | null
  created_at: string
}

export interface KpiValueRow {
  id: string
  period_key: string
  value: number
  note: string | null
  entered_by_name: string | null
  computed_at: string
}

export interface ActionRow {
  id: string
  description: string
  assigned_to: string | null
  assigned_to_name: string | null
  due_date: string | null
  status: 'open' | 'done'
  completed_at: string | null
}

type Role = 'admin' | 'office' | 'supervisor'

// ─── Manual value dialog ──────────────────────────────────────────────────────

function ManualValueDialog({
  open,
  onOpenChange,
  objective,
  currentPeriod,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  objective: ObjectiveDetailData
  currentPeriod: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [periodKey, setPeriodKey] = useState(currentPeriod)
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await enterManualKpiValue({
        objective_id: objective.id,
        period_key: periodKey.trim(),
        value,
        note: note || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Value recorded')
      setValue('')
      setNote('')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record {objective.metric_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Period</Label>
              {objective.period === 'monthly' ? (
                <Input
                  type="month"
                  value={periodKey}
                  max={currentPeriod}
                  onChange={(e) => setPeriodKey(e.target.value)}
                  required
                />
              ) : (
                <Input
                  value={periodKey}
                  onChange={(e) => setPeriodKey(e.target.value)}
                  placeholder="e.g. 2026-Q3"
                  pattern="\d{4}-Q[1-4]"
                  required
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Value ({objective.unit})</Label>
              <Input
                type="number"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Where the number came from (optional)"
              rows={2}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Recording a period again replaces its value — the audit log keeps
            the change history. Future periods cannot be recorded.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save value'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit objective dialog ────────────────────────────────────────────────────

function EditObjectiveDialog({
  open,
  onOpenChange,
  objective,
  profiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  objective: ObjectiveDetailData
  profiles: ProfileOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    title: objective.title,
    description: objective.description ?? '',
    iso_domain: objective.iso_domain,
    metric_name: objective.metric_name,
    unit: objective.unit,
    target_value: String(objective.target_value),
    direction: objective.direction,
    owner_id: objective.owner_id ?? '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateObjective(objective.id, {
        title: form.title,
        description: form.description || null,
        iso_domain: form.iso_domain,
        metric_name: form.metric_name,
        unit: form.unit,
        target_value: form.target_value,
        direction: form.direction,
        owner_id: form.owner_id || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Objective updated')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {objective.number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => field('title', e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
              rows={3}
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
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Metric name</Label>
              <Input
                value={form.metric_name}
                onChange={(e) => field('metric_name', e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unit</Label>
              <Input
                value={form.unit}
                onChange={(e) => field('unit', e.target.value)}
                required
              />
            </div>
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
                {(['at_most', 'at_least'] as const).map((d) => (
                  <SelectItem key={d} value={d}>
                    {OBJECTIVE_DIRECTION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Source, metric derivation and period are fixed — changing how a KPI
            is measured mid-history would reinterpret every stored value.
            Retire this objective and raise a new one instead.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Improvement action dialog (add/edit) ─────────────────────────────────────

function ActionDialog({
  open,
  onOpenChange,
  objectiveId,
  profiles,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  objectiveId: string
  profiles: ProfileOption[]
  editing: ActionRow | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [description, setDescription] = useState(editing?.description ?? '')
  const [assignedTo, setAssignedTo] = useState(editing?.assigned_to ?? '')
  const [dueDate, setDueDate] = useState(editing?.due_date ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        description,
        assigned_to: assignedTo || null,
        due_date: dueDate || null,
      }
      const result = editing
        ? await updateObjectiveAction(editing.id, objectiveId, payload)
        : await createObjectiveAction({ objective_id: objectiveId, ...payload })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(editing ? 'Action updated' : 'Improvement action added')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Edit improvement action' : 'Add improvement action'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What will bring this objective back on track?"
              rows={3}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Assigned to</Label>
              <Select
                value={assignedTo}
                onValueChange={(v) => setAssignedTo(!v || v === '__none' ? '' : v)}
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
              <Label>Due date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save' : 'Add action'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function ObjectiveDetailClient({
  objective,
  values,
  actions,
  role,
  profiles,
  auditHistory,
  currentPeriod,
}: {
  objective: ObjectiveDetailData
  values: KpiValueRow[]
  actions: ActionRow[]
  role: Role
  profiles: ProfileOption[]
  auditHistory: AuditRow[]
  currentPeriod: string
}) {
  const router = useRouter()
  const canManage = role === 'admin' || role === 'office'
  const [valueOpen, setValueOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [actionOpen, setActionOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<ActionRow | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [mutating, startMutation] = useTransition()

  // Oldest → newest for the chart; the table shows newest first.
  const chartData = useMemo(
    () =>
      [...values]
        .sort((a, b) => a.period_key.localeCompare(b.period_key))
        .map((v) => ({ period: periodKeyLabel(v.period_key), value: v.value })),
    [values]
  )

  const latest = values.length > 0 ? values[0] : null
  const traffic = deriveObjectiveStatus(
    objective.direction,
    objective.target_value,
    latest?.value ?? null
  )

  function handleRefresh() {
    startRefresh(async () => {
      const { error, result } = await refreshKpis([objective.id])
      if (error) {
        toast.error(error)
        return
      }
      const n = result?.refreshed.length ?? 0
      toast.success(`Refreshed — ${n} value${n === 1 ? '' : 's'} computed`)
      if (result && result.errors.length > 0) toast.error(result.errors[0])
      router.refresh()
    })
  }

  function handleStatus(status: string) {
    startMutation(async () => {
      const result = await setObjectiveStatus(objective.id, { status })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Marked ${OBJECTIVE_STATUS_LABELS[status as ObjectiveStatus]}`)
      router.refresh()
    })
  }

  function handleDelete() {
    if (!window.confirm(`Delete ${objective.number}? This removes its KPI history.`)) {
      return
    }
    startMutation(async () => {
      const result = await deleteObjective(objective.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Objective deleted')
      router.push('/whs/objectives')
    })
  }

  function handleActionDone(action: ActionRow, done: boolean) {
    startMutation(async () => {
      const result = await setObjectiveActionDone(action.id, objective.id, done)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleActionDelete(action: ActionRow) {
    if (!window.confirm('Delete this improvement action?')) return
    startMutation(async () => {
      const result = await deleteObjectiveAction(action.id, objective.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function exportCsv() {
    downloadCsv(
      `${objective.number.toLowerCase()}-kpi-values.csv`,
      values.map((v) => ({
        objective: objective.number,
        metric: objective.metric_name,
        period: v.period_key,
        value: v.value,
        unit: objective.unit,
        target: `${objective.direction === 'at_most' ? '<=' : '>='} ${objective.target_value}`,
        status:
          deriveObjectiveStatus(objective.direction, objective.target_value, v.value) ??
          '',
        note: v.note ?? '',
        entered_by: v.entered_by_name ?? 'auto',
        computed_at: v.computed_at,
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              <span className="font-mono text-muted-foreground">{objective.number}</span>{' '}
              {objective.title}
            </h2>
            <StatusBadge status={objective.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {RISK_DOMAIN_LABELS[objective.iso_domain]} ·{' '}
            {OBJECTIVE_PERIOD_LABELS[objective.period]} ·{' '}
            {OBJECTIVE_SOURCE_LABELS[objective.source]}
            {objective.source === 'auto' && objective.auto_metric_key
              ? ` — ${AUTO_METRIC_LABELS[objective.auto_metric_key as AutoMetricKey] ?? objective.auto_metric_key}`
              : ''}
            {objective.owner_name ? ` · Owner: ${objective.owner_name}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={values.length === 0}>
            <DownloadIcon className="size-4" />
            CSV
          </Button>
          {canManage && objective.source === 'auto' && (
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCwIcon className={cn('size-4', refreshing && 'animate-spin')} />
              {refreshing ? 'Refreshing…' : 'Refresh metrics'}
            </Button>
          )}
          {canManage && objective.source === 'manual' && objective.status === 'active' && (
            <Button size="sm" onClick={() => setValueOpen(true)}>
              <PlusIcon className="size-4" />
              Record value
            </Button>
          )}
          {canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon className="size-4" />
                Edit
              </Button>
              <Select value={objective.status} onValueChange={(v) => v && handleStatus(v)}>
                <SelectTrigger className="h-8 w-32" disabled={mutating}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBJECTIVE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {OBJECTIVE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {role === 'admin' && (
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={mutating}>
              <Trash2Icon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {objective.description && (
        <p className="max-w-3xl text-sm text-muted-foreground">{objective.description}</p>
      )}

      {/* Latest + trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Latest — {latest ? periodKeyLabel(latest.period_key) : 'no data'}
              {latest && latest.period_key === currentPeriod ? ' (to date)' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums">
                {fmtKpiValue(latest?.value ?? null, objective.unit)}
              </span>
              <ObjectiveTrafficLight status={traffic} withLabel />
            </div>
            <p className="text-xs text-muted-foreground">
              Target {targetLabel(objective.direction, objective.target_value, objective.unit)}{' '}
              ({objective.metric_name})
            </p>
          </CardContent>
        </Card>

        <Card size="sm" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length < 2 ? (
              <p className="text-sm text-muted-foreground">
                Not enough periods for a trend yet.
              </p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} width={44} domain={['auto', 'auto']} />
                    <Tooltip
                      formatter={(v) => [fmtKpiValue(Number(v), objective.unit), objective.metric_name]}
                    />
                    <ReferenceLine
                      y={objective.target_value}
                      stroke="#64748b"
                      strokeDasharray="5 4"
                      label={{
                        value: `target ${targetLabel(objective.direction, objective.target_value, objective.unit)}`,
                        fontSize: 10,
                        fill: '#64748b',
                        position: 'insideTopRight',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#162040"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Period table */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Period values</CardTitle>
        </CardHeader>
        <CardContent>
          {values.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No values recorded yet.{' '}
              {objective.source === 'auto'
                ? 'Run Refresh metrics to compute the elapsed periods.'
                : 'Record the first period value to start the trend.'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {values.map((v) => {
                    const s = deriveObjectiveStatus(
                      objective.direction,
                      objective.target_value,
                      v.value
                    )
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">
                          {periodKeyLabel(v.period_key)}
                          {v.period_key === currentPeriod && (
                            <span className="ml-1 text-xs text-muted-foreground">(to date)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtKpiValue(v.value, objective.unit)}
                        </TableCell>
                        <TableCell>
                          <ObjectiveTrafficLight status={s} withLabel />
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                          {v.note ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {v.entered_by_name ?? 'Auto'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums">
                          {fmtDate(v.computed_at)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Improvement actions */}
      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Improvement actions</CardTitle>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingAction(null)
                  setActionOpen(true)
                }}
              >
                <PlusIcon className="size-4" />
                Add action
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No improvement actions. Add one when the objective runs off track.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {actions.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className={cn(
                        'text-sm',
                        a.status === 'done' && 'text-muted-foreground line-through'
                      )}
                    >
                      {a.description}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.assigned_to_name ?? 'Unassigned'}
                      {a.due_date ? ` · due ${fmtDate(a.due_date)}` : ''}
                      {a.status === 'done' && a.completed_at
                        ? ` · done ${fmtDate(a.completed_at)}`
                        : ''}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <StatusBadge status={a.status} />
                    {canManage && a.status === 'open' && (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Mark done"
                          onClick={() => handleActionDone(a, true)}
                          disabled={mutating}
                        >
                          <CheckIcon className="size-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Edit"
                          onClick={() => {
                            setEditingAction(a)
                            setActionOpen(true)
                          }}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                      </>
                    )}
                    {canManage && a.status === 'done' && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Reopen"
                        onClick={() => handleActionDone(a, false)}
                        disabled={mutating}
                      >
                        <UndoIcon className="size-4" />
                      </Button>
                    )}
                    {role === 'admin' && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Delete"
                        onClick={() => handleActionDelete(a)}
                        disabled={mutating}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit history */}
      <AuditHistory rows={auditHistory} />

      <ManualValueDialog
        open={valueOpen}
        onOpenChange={setValueOpen}
        objective={objective}
        currentPeriod={currentPeriod}
      />
      <EditObjectiveDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        objective={objective}
        profiles={profiles}
      />
      {actionOpen && (
        <ActionDialog
          key={editingAction?.id ?? 'new'}
          open={actionOpen}
          onOpenChange={setActionOpen}
          objectiveId={objective.id}
          profiles={profiles}
          editing={editingAction}
        />
      )}
    </div>
  )
}
