'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  RotateCcwIcon,
  LockIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/StatusBadge'
import { AuditHistory } from '@/components/AuditHistory'
import { fmtDate } from '@/lib/format'
import { todayAUClient } from '@/lib/tz-client'
import { cn } from '@/lib/utils'
import type { AuditRow } from '@/lib/audit-queries'
import {
  riskRating,
  riskTransitionAllowed,
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
import { RatingBadge, type ProjectOption, type ProfileOption } from '../risks-client'
import {
  updateRiskItem,
  setRiskStatus,
  deleteRiskItem,
  createRiskTreatment,
  updateRiskTreatment,
  deleteRiskTreatment,
  markRiskTreatmentDone,
  reopenRiskTreatment,
} from '../actions'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskDetailData {
  id: string
  number: string
  kind: RiskKind
  title: string
  context: string | null
  source: RiskSource
  iso_domain: RiskDomain
  category: string | null
  project_id: string | null
  project_label: string | null
  existing_controls: string | null
  likelihood: number
  consequence: number
  inherent_score: number
  inherent_rating: RiskRating
  residual_likelihood: number | null
  residual_consequence: number | null
  residual_score: number | null
  residual_rating: RiskRating | null
  owner_id: string | null
  owner_name: string | null
  review_date: string | null
  status: RiskStatus
  created_by_name: string | null
  closed_at: string | null
  created_at: string
}

export interface TreatmentRow {
  id: string
  risk_item_id: string
  description: string
  assigned_to: string | null
  assigned_to_name: string | null
  due_date: string | null
  status: string
  completed_at: string | null
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────

function EditRiskDialog({
  open,
  onOpenChange,
  risk,
  projects,
  profiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  risk: RiskDetailData
  projects: ProjectOption[]
  profiles: ProfileOption[]
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    kind: risk.kind,
    title: risk.title,
    context: risk.context ?? '',
    source: risk.source,
    iso_domain: risk.iso_domain,
    project_id: risk.project_id ?? '',
    category: risk.category ?? '',
    existing_controls: risk.existing_controls ?? '',
    likelihood: String(risk.likelihood),
    consequence: String(risk.consequence),
    residual_likelihood:
      risk.residual_likelihood == null ? '' : String(risk.residual_likelihood),
    residual_consequence:
      risk.residual_consequence == null ? '' : String(risk.residual_consequence),
    owner_id: risk.owner_id ?? '',
    review_date: risk.review_date ?? '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const inherentPreview = Number(form.likelihood) * Number(form.consequence)
  const residualPreview =
    form.residual_likelihood && form.residual_consequence
      ? Number(form.residual_likelihood) * Number(form.residual_consequence)
      : null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateRiskItem(risk.id, {
        kind: form.kind,
        title: form.title,
        context: form.context || null,
        source: form.source,
        iso_domain: form.iso_domain,
        project_id: form.project_id || null,
        category: form.category || null,
        existing_controls: form.existing_controls || null,
        likelihood: form.likelihood,
        consequence: form.consequence,
        residual_likelihood: form.residual_likelihood || null,
        residual_consequence: form.residual_consequence || null,
        owner_id: form.owner_id || null,
        review_date: form.review_date || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Saved')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {risk.number}</DialogTitle>
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
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Context / description</Label>
            <Textarea
              value={form.context}
              onChange={(e) => field('context', e.target.value)}
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
                  {form.category &&
                    !RISK_CATEGORIES.includes(
                      form.category as (typeof RISK_CATEGORIES)[number]
                    ) && (
                      <SelectItem value={form.category}>{form.category}</SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>
          </div>

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

          <div className="flex flex-col gap-1.5">
            <Label>Existing controls</Label>
            <Textarea
              value={form.existing_controls}
              onChange={(e) => field('existing_controls', e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Likelihood</Label>
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
                {form.kind === 'opportunity' ? 'Benefit' : 'Consequence'}
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

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Residual likelihood</Label>
              <Select
                value={form.residual_likelihood || '__none'}
                onValueChange={(v) =>
                  field('residual_likelihood', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not scored" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not scored</SelectItem>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} — {LIKELIHOOD_LABELS[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Residual consequence</Label>
              <Select
                value={form.residual_consequence || '__none'}
                onValueChange={(v) =>
                  field('residual_consequence', !v || v === '__none' ? '' : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not scored" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not scored</SelectItem>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} — {CONSEQUENCE_LABELS[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">Inherent:</span>
              <RatingBadge
                rating={riskRating(inherentPreview)}
                score={inherentPreview}
                kind={form.kind}
              />
            </span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">Residual:</span>
              <RatingBadge
                rating={riskRating(residualPreview)}
                score={residualPreview}
                kind={form.kind}
              />
            </span>
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
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Treatment dialog (add / edit) ───────────────────────────────────────────

function TreatmentDialog({
  open,
  onOpenChange,
  riskId,
  profiles,
  treatment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  riskId: string
  profiles: ProfileOption[]
  /** When set, edits this treatment; otherwise creates a new one. */
  treatment?: TreatmentRow
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    description: treatment?.description ?? '',
    assigned_to: treatment?.assigned_to ?? '',
    due_date: treatment?.due_date ?? '',
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        description: form.description,
        assigned_to: form.assigned_to || null,
        due_date: form.due_date || null,
      }
      const result = treatment
        ? await updateRiskTreatment(treatment.id, riskId, payload)
        : await createRiskTreatment({ risk_item_id: riskId, ...payload })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(treatment ? 'Treatment updated' : 'Treatment added')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{treatment ? 'Edit treatment' : 'Add treatment'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="What will be done to treat this risk / realise this opportunity?"
              rows={3}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Assigned to</Label>
              <Select
                value={form.assigned_to}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    assigned_to: !v || v === '__none' ? '' : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
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
                value={form.due_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, due_date: e.target.value }))
                }
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
              {pending ? 'Saving…' : treatment ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Detail client ────────────────────────────────────────────────────────────

export function RiskDetailClient({
  risk,
  treatments,
  role,
  profileId,
  projects,
  profiles,
  auditHistory,
}: {
  risk: RiskDetailData
  treatments: TreatmentRow[]
  role: 'admin' | 'office' | 'supervisor'
  profileId: string
  projects: ProjectOption[]
  profiles: ProfileOption[]
  auditHistory: AuditRow[]
}) {
  const router = useRouter()
  const canManage = role === 'admin' || role === 'office'
  const [pending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [addTreatmentOpen, setAddTreatmentOpen] = useState(false)
  const [editTreatment, setEditTreatment] = useState<TreatmentRow | null>(null)

  const today = todayAUClient()
  const openTreatments = treatments.filter((t) => t.status === 'open').length
  const closed = risk.status === 'closed'

  function moveStatus(target: RiskStatus) {
    startTransition(async () => {
      const result = await setRiskStatus(risk.id, { status: target })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        target === 'closed'
          ? 'Item closed'
          : `Status: ${RISK_STATUS_LABELS[target]}`
      )
    })
  }

  function handleDelete() {
    if (!confirm(`Delete ${risk.number}? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteRiskItem(risk.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Deleted')
      router.push('/whs/risks')
    })
  }

  function treatmentAction(
    fn: (id: string, riskId: string) => Promise<{ error?: string }>,
    id: string,
    success: string
  ) {
    startTransition(async () => {
      const result = await fn(id, risk.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(success)
    })
  }

  const targets = RISK_STATUSES.filter(
    (s) => s !== risk.status && riskTransitionAllowed(risk.status, s)
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">{risk.number}</h1>
            <StatusBadge status={risk.status} />
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {RISK_KIND_LABELS[risk.kind]}
            </span>
          </div>
          <p className="text-base">{risk.title}</p>
          <p className="text-xs text-muted-foreground">
            {RISK_DOMAIN_LABELS[risk.iso_domain]} ·{' '}
            {RISK_SOURCE_LABELS[risk.source]}
            {risk.category ? ` · ${risk.category}` : ''} ·{' '}
            {risk.project_label ?? 'Company-wide'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManage && !closed && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilIcon className="size-4" />
              Edit
            </Button>
          )}
          {canManage &&
            targets.map((t) => {
              if (t === 'open' && risk.status === 'closed' && role !== 'admin') {
                return null
              }
              return (
                <Button
                  key={t}
                  size="sm"
                  variant={t === 'closed' ? 'default' : 'outline'}
                  disabled={pending}
                  onClick={() => moveStatus(t)}
                >
                  {t === 'closed' ? (
                    <>
                      <LockIcon className="size-4" />
                      Close
                    </>
                  ) : risk.status === 'closed' ? (
                    'Reopen'
                  ) : (
                    RISK_STATUS_LABELS[t]
                  )}
                </Button>
              )
            })}
          {role === 'admin' && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700"
              disabled={pending}
              onClick={handleDelete}
            >
              <Trash2Icon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Details */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {risk.context && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Context
                </p>
                <p className="whitespace-pre-wrap">{risk.context}</p>
              </div>
            )}
            {risk.existing_controls && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Existing controls
                </p>
                <p className="whitespace-pre-wrap">{risk.existing_controls}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Owner</p>
                <p>{risk.owner_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Review date
                </p>
                <p
                  className={cn(
                    'tabular-nums',
                    !closed &&
                      risk.review_date &&
                      risk.review_date < today &&
                      'font-medium text-red-600 dark:text-red-400'
                  )}
                >
                  {risk.review_date ? fmtDate(risk.review_date) : '—'}
                  {!closed && risk.review_date && risk.review_date < today
                    ? ' (overdue)'
                    : ''}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Raised by
                </p>
                <p>{risk.created_by_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {closed ? 'Closed' : 'Raised'}
                </p>
                <p className="tabular-nums">
                  {closed && risk.closed_at
                    ? fmtDate(risk.closed_at)
                    : fmtDate(risk.created_at)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scoring */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">5×5 matrix rating</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Inherent (before treatment)
                </p>
                <p className="text-xs text-muted-foreground">
                  L{risk.likelihood} ({LIKELIHOOD_LABELS[risk.likelihood]}) × C
                  {risk.consequence} ({CONSEQUENCE_LABELS[risk.consequence]})
                </p>
              </div>
              <RatingBadge
                rating={risk.inherent_rating}
                score={risk.inherent_score}
                kind={risk.kind}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Residual (after treatment)
                </p>
                {risk.residual_likelihood != null &&
                risk.residual_consequence != null ? (
                  <p className="text-xs text-muted-foreground">
                    L{risk.residual_likelihood} (
                    {LIKELIHOOD_LABELS[risk.residual_likelihood]}) × C
                    {risk.residual_consequence} (
                    {CONSEQUENCE_LABELS[risk.residual_consequence]})
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not scored
                    {risk.kind === 'risk'
                      ? ' — required before this risk can be closed'
                      : ' (optional for opportunities)'}
                  </p>
                )}
              </div>
              <RatingBadge
                rating={risk.residual_rating}
                score={risk.residual_score}
                kind={risk.kind}
              />
            </div>
            {canManage && !closed && (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => setEditOpen(true)}
              >
                {risk.residual_score == null
                  ? 'Record residual rating'
                  : 'Update scores'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Treatments */}
      <Card size="sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">
            Treatments{' '}
            <span className="font-normal text-muted-foreground">
              {openTreatments} open
            </span>
          </CardTitle>
          {canManage && !closed && (
            <Button size="sm" variant="outline" onClick={() => setAddTreatmentOpen(true)}>
              <PlusIcon className="size-4" />
              Add treatment
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {treatments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No treatments recorded.
              {risk.kind === 'risk'
                ? ' Add the actions that will reduce this risk.'
                : ' Add the actions that will realise this opportunity.'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {treatments.map((t) => {
                    const overdue =
                      t.status === 'open' && t.due_date && t.due_date < today
                    const canComplete =
                      canManage || (role === 'supervisor' && t.assigned_to === profileId)
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="max-w-[340px] whitespace-normal text-sm">
                          {t.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.assigned_to_name ?? '—'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-sm tabular-nums',
                            overdue
                              ? 'font-medium text-red-600 dark:text-red-400'
                              : 'text-muted-foreground'
                          )}
                        >
                          {t.due_date ? fmtDate(t.due_date) : '—'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {t.status === 'open' && canComplete && !closed && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Mark done"
                                disabled={pending}
                                onClick={() =>
                                  treatmentAction(
                                    markRiskTreatmentDone,
                                    t.id,
                                    'Treatment completed'
                                  )
                                }
                              >
                                <CheckIcon className="size-4" />
                              </Button>
                            )}
                            {t.status === 'done' && canComplete && !closed && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Reopen"
                                disabled={pending}
                                onClick={() =>
                                  treatmentAction(
                                    reopenRiskTreatment,
                                    t.id,
                                    'Treatment reopened'
                                  )
                                }
                              >
                                <RotateCcwIcon className="size-4" />
                              </Button>
                            )}
                            {canManage && !closed && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Edit"
                                onClick={() => setEditTreatment(t)}
                              >
                                <PencilIcon className="size-4" />
                              </Button>
                            )}
                            {role === 'admin' && !closed && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Delete"
                                className="text-red-600 hover:text-red-700"
                                disabled={pending}
                                onClick={() =>
                                  treatmentAction(
                                    deleteRiskTreatment,
                                    t.id,
                                    'Treatment deleted'
                                  )
                                }
                              >
                                <Trash2Icon className="size-4" />
                              </Button>
                            )}
                          </div>
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

      {/* Audit history */}
      <AuditHistory rows={auditHistory} />

      {/* Dialogs */}
      {editOpen && (
        <EditRiskDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          risk={risk}
          projects={projects}
          profiles={profiles}
        />
      )}
      {addTreatmentOpen && (
        <TreatmentDialog
          open={addTreatmentOpen}
          onOpenChange={setAddTreatmentOpen}
          riskId={risk.id}
          profiles={profiles}
        />
      )}
      {editTreatment && (
        <TreatmentDialog
          open={!!editTreatment}
          onOpenChange={(open) => !open && setEditTreatment(null)}
          riskId={risk.id}
          profiles={profiles}
          treatment={editTreatment}
        />
      )}
    </div>
  )
}
