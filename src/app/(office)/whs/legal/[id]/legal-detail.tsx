'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  ClipboardCheckIcon,
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
import { ComplianceLight } from '@/components/ComplianceLight'
import { fmtDate } from '@/lib/format'
import { todayAUClient } from '@/lib/tz-client'
import { cn } from '@/lib/utils'
import type { AuditRow } from '@/lib/audit-queries'
import {
  LEGAL_CATEGORIES,
  LEGAL_CATEGORY_LABELS,
  LEGAL_JURISDICTIONS,
  LEGAL_JURISDICTION_LABELS,
  RISK_DOMAINS,
  RISK_DOMAIN_LABELS,
  COMPLIANCE_VERDICTS,
  COMPLIANCE_VERDICT_LABELS,
  type LegalCategory,
  type LegalJurisdiction,
  type RiskDomain,
  type ComplianceState,
  type ComplianceVerdict,
  type ObligationStatus,
} from '@/lib/zod'
import {
  ComplianceBadge,
  reviewLight,
  type DocumentOption,
  type ProfileOption,
} from '../legal-client'
import {
  updateObligation,
  retireObligation,
  reactivateObligation,
  deleteObligation,
  recordEvaluation,
} from '../actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObligationDetailData {
  id: string
  number: string
  title: string
  category: LegalCategory
  jurisdiction: LegalJurisdiction
  iso_domain: RiskDomain
  summary: string | null
  how_it_applies: string | null
  how_we_comply: string | null
  controlling_document_id: string | null
  controlling_doc_label: string | null
  responsible_id: string | null
  responsible_name: string | null
  review_frequency_months: number
  next_review_date: string | null
  current_compliance: ComplianceState
  status: ObligationStatus
  created_by_name: string | null
  created_at: string
}

export interface EvaluationRow {
  id: string
  evaluated_on: string
  verdict: ComplianceVerdict
  notes: string | null
  evaluator_name: string | null
  ncr_id: string | null
  ncr_number: string | null
  ncr_status: string | null
  created_at: string
}

export interface NcrOption {
  id: string
  number: string
  title: string
  status: string
}

// ─── Verdict badge ────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: ComplianceVerdict }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        verdict === 'compliant'
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300'
          : 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300'
      )}
    >
      {COMPLIANCE_VERDICT_LABELS[verdict]}
    </span>
  )
}

// ─── Edit dialog (admin/office) ───────────────────────────────────────────────

function EditObligationDialog({
  open,
  onOpenChange,
  obligation,
  documents,
  profiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  obligation: ObligationDetailData
  documents: DocumentOption[]
  profiles: ProfileOption[]
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    title: obligation.title,
    category: obligation.category,
    jurisdiction: obligation.jurisdiction,
    iso_domain: obligation.iso_domain,
    summary: obligation.summary ?? '',
    how_it_applies: obligation.how_it_applies ?? '',
    how_we_comply: obligation.how_we_comply ?? '',
    controlling_document_id: obligation.controlling_document_id ?? '',
    responsible_id: obligation.responsible_id ?? '',
    review_frequency_months: String(obligation.review_frequency_months),
    next_review_date: obligation.next_review_date ?? '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateObligation(obligation.id, {
        title: form.title,
        category: form.category,
        jurisdiction: form.jurisdiction,
        iso_domain: form.iso_domain,
        summary: form.summary || null,
        how_it_applies: form.how_it_applies || null,
        how_we_comply: form.how_we_comply || null,
        controlling_document_id: form.controlling_document_id || null,
        responsible_id: form.responsible_id || null,
        review_frequency_months: form.review_frequency_months,
        next_review_date: form.next_review_date || null,
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
          <DialogTitle>Edit {obligation.number}</DialogTitle>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => v && field('category', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEGAL_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {LEGAL_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Jurisdiction</Label>
              <Select
                value={form.jurisdiction}
                onValueChange={(v) => v && field('jurisdiction', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEGAL_JURISDICTIONS.map((j) => (
                    <SelectItem key={j} value={j}>
                      {LEGAL_JURISDICTION_LABELS[j]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

          <div className="flex flex-col gap-1.5">
            <Label>What it requires</Label>
            <Textarea
              value={form.summary}
              onChange={(e) => field('summary', e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>How it applies to us</Label>
            <Textarea
              value={form.how_it_applies}
              onChange={(e) => field('how_it_applies', e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>How we comply</Label>
            <Textarea
              value={form.how_we_comply}
              onChange={(e) => field('how_we_comply', e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Controlling document</Label>
            <Select
              value={form.controlling_document_id}
              onValueChange={(v) =>
                field('controlling_document_id', !v || v === '__none' ? '' : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {documents.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Responsible</Label>
              <Select
                value={form.responsible_id}
                onValueChange={(v) =>
                  field('responsible_id', !v || v === '__none' ? '' : v)
                }
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
              <Label>Review every (months)</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={form.review_frequency_months}
                onChange={(e) => field('review_frequency_months', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Next review</Label>
              <Input
                type="date"
                value={form.next_review_date}
                onChange={(e) => field('next_review_date', e.target.value)}
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

// ─── Record evaluation dialog ─────────────────────────────────────────────────
//
// Always creates a NEW evaluation row (append-only — evaluations can never be
// edited). A gap verdict must escalate: raise a new NCR (prefilled from the
// obligation, source 'legal_compliance') or link an existing open NCR.

function RecordEvaluationDialog({
  open,
  onOpenChange,
  obligation,
  ncrs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  obligation: ObligationDetailData
  ncrs: NcrOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    evaluated_on: todayAUClient(),
    verdict: 'compliant' as ComplianceVerdict,
    notes: '',
    gap_mode: 'create' as 'create' | 'link',
    ncr_id: '',
    ncr_severity: '3',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const isGap = form.verdict === 'gap'
    if (isGap && form.gap_mode === 'link' && !form.ncr_id) {
      toast.error('Pick the NCR to link, or raise a new one')
      return
    }
    startTransition(async () => {
      const result = await recordEvaluation({
        obligation_id: obligation.id,
        evaluated_on: form.evaluated_on,
        verdict: form.verdict,
        notes: form.notes || null,
        ncr_id: isGap && form.gap_mode === 'link' ? form.ncr_id : null,
        create_ncr: isGap && form.gap_mode === 'create',
        ncr_severity: form.ncr_severity,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        form.verdict === 'gap'
          ? 'Gap recorded and escalated to the NCR register'
          : 'Evaluation recorded'
      )
      onOpenChange(false)
      if (form.verdict === 'gap' && result.ncrId) {
        router.push(`/whs/ncr/${result.ncrId}`)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record evaluation — {obligation.number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            A re-evaluation is always a new record — the evaluation history is
            append-only and cannot be edited.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Evaluated on</Label>
              <Input
                type="date"
                value={form.evaluated_on}
                onChange={(e) => field('evaluated_on', e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Verdict</Label>
              <Select
                value={form.verdict}
                onValueChange={(v) => v && field('verdict', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_VERDICTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {COMPLIANCE_VERDICT_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notes / evidence reviewed</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => field('notes', e.target.value)}
              placeholder="What was checked and what evidence supports the verdict"
              rows={3}
            />
          </div>

          {form.verdict === 'gap' && (
            <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-900 dark:bg-red-950/30">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                A gap must be escalated to the NCR / CAPA register
              </p>
              <div className="flex gap-1">
                {(
                  [
                    ['create', 'Raise a new NCR'],
                    ['link', 'Link an existing NCR'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => field('gap_mode', mode)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs transition-colors',
                      form.gap_mode === mode
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {form.gap_mode === 'create' ? (
                <div className="flex flex-col gap-1.5">
                  <Label>NCR severity (1–5)</Label>
                  <Select
                    value={form.ncr_severity}
                    onValueChange={(v) => v && field('ncr_severity', v)}
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
                  <p className="text-xs text-muted-foreground">
                    Raises an NCR (source: legal compliance) titled and
                    described from this obligation, linked to this evaluation.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label>Existing NCR</Label>
                  <Select
                    value={form.ncr_id}
                    onValueChange={(v) => field('ncr_id', v ?? '')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick an open NCR" />
                    </SelectTrigger>
                    <SelectContent>
                      {ncrs.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          No open NCRs — raise a new one
                        </SelectItem>
                      ) : (
                        ncrs.map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            {n.number} — {n.title}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Recording…' : 'Record evaluation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function LegalDetailClient({
  obligation,
  evaluations,
  role,
  documents,
  profiles,
  ncrs,
  auditHistory,
}: {
  obligation: ObligationDetailData
  evaluations: EvaluationRow[]
  role: 'admin' | 'office' | 'supervisor'
  documents: DocumentOption[]
  profiles: ProfileOption[]
  ncrs: NcrOption[]
  auditHistory: AuditRow[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [evaluateOpen, setEvaluateOpen] = useState(false)

  const today = todayAUClient()
  const canManage = role === 'admin' || role === 'office'
  const isActive = obligation.status === 'active'

  function handleRetire() {
    if (!window.confirm(`Retire ${obligation.number}? It stays on the register for audit history.`)) return
    startTransition(async () => {
      const result = await retireObligation(obligation.id)
      if (result.error) toast.error(result.error)
      else toast.success('Obligation retired')
    })
  }

  function handleReactivate() {
    startTransition(async () => {
      const result = await reactivateObligation(obligation.id)
      if (result.error) toast.error(result.error)
      else toast.success('Obligation reactivated')
    })
  }

  function handleDelete() {
    if (!window.confirm(`Delete ${obligation.number} and its evaluation history? Retiring is the normal path — delete cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteObligation(obligation.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Obligation deleted')
      router.push('/whs/legal')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">{obligation.number}</h1>
            <ComplianceBadge state={obligation.current_compliance} />
            {obligation.status === 'retired' && <StatusBadge status="retired" />}
          </div>
          <p className="text-base">{obligation.title}</p>
          <p className="text-sm text-muted-foreground">
            {LEGAL_CATEGORY_LABELS[obligation.category]} ·{' '}
            {LEGAL_JURISDICTION_LABELS[obligation.jurisdiction]} ·{' '}
            {RISK_DOMAIN_LABELS[obligation.iso_domain]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isActive && (
            <Button size="sm" onClick={() => setEvaluateOpen(true)}>
              <ClipboardCheckIcon className="size-4" />
              Record evaluation
            </Button>
          )}
          {canManage && isActive && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon className="size-4" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetire}
                disabled={pending}
              >
                <ArchiveIcon className="size-4" />
                Retire
              </Button>
            </>
          )}
          {role === 'admin' && obligation.status === 'retired' && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleReactivate}
              disabled={pending}
            >
              <ArchiveRestoreIcon className="size-4" />
              Reactivate
            </Button>
          )}
          {role === 'admin' && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700"
              onClick={handleDelete}
              disabled={pending}
            >
              <Trash2Icon className="size-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Obligation detail */}
        <Card size="sm" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Obligation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                What it requires
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {obligation.summary ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                How it applies to us
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {obligation.how_it_applies ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                How we comply
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {obligation.how_we_comply ?? '—'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Review / meta */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Review & responsibility</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Next review</span>
              <span className="flex items-center gap-2 tabular-nums">
                {isActive && (
                  <ComplianceLight
                    status={reviewLight(obligation.next_review_date, today)}
                  />
                )}
                {obligation.next_review_date
                  ? fmtDate(obligation.next_review_date)
                  : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Review frequency</span>
              <span>
                Every {obligation.review_frequency_months} month
                {obligation.review_frequency_months === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Responsible</span>
              <span>{obligation.responsible_name ?? '—'}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">Controlling doc</span>
              <span className="text-right">
                {obligation.controlling_doc_label ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Added</span>
              <span className="tabular-nums">
                {fmtDate(obligation.created_at)}
                {obligation.created_by_name
                  ? ` · ${obligation.created_by_name}`
                  : ''}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Compliance state and the next review date advance automatically
              from the latest evaluation — they cannot be set by hand.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Evaluations timeline (append-only) */}
      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">
              Compliance evaluations — {evaluations.length} record
              {evaluations.length === 1 ? '' : 's'}
            </CardTitle>
            {isActive && (
              <Button size="sm" variant="outline" onClick={() => setEvaluateOpen(true)}>
                <PlusIcon className="size-4" />
                Record evaluation
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {evaluations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not yet evaluated. Record the first compliance evaluation to move
              this obligation off &ldquo;Not evaluated&rdquo;.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evaluated</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead>Evaluator</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>NCR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluations.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {fmtDate(e.evaluated_on)}
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={e.verdict} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {e.evaluator_name ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                        <span className="line-clamp-2 whitespace-pre-wrap">
                          {e.notes ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {e.ncr_id && e.ncr_number ? (
                          <Link
                            href={`/whs/ncr/${e.ncr_id}`}
                            className="flex items-center gap-2 font-mono text-sm hover:underline"
                          >
                            {e.ncr_number}
                            {e.ncr_status ? (
                              <StatusBadge status={e.ncr_status} />
                            ) : null}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            The evaluation history is append-only — a re-evaluation is a new
            record, never an edit. The latest evaluation decides the compliance
            state above.
          </p>
        </CardContent>
      </Card>

      {/* Audit history */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">History</CardTitle>
        </CardHeader>
        <CardContent>
          {auditHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          ) : (
            <AuditHistory rows={auditHistory} heading="" />
          )}
        </CardContent>
      </Card>

      {canManage && (
        <EditObligationDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          obligation={obligation}
          documents={documents}
          profiles={profiles}
        />
      )}
      <RecordEvaluationDialog
        open={evaluateOpen}
        onOpenChange={setEvaluateOpen}
        obligation={obligation}
        ncrs={ncrs}
      />
    </div>
  )
}
