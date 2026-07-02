'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  CheckIcon,
  RotateCcwIcon,
  ClipboardCheckIcon,
  AlertOctagonIcon,
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
import { cn } from '@/lib/utils'
import { validateSubmissionData } from '@/lib/form-validate'
import type { AuditRow as AuditLogRow } from '@/lib/audit-queries'
import {
  AUDIT_STANDARDS,
  AUDIT_STANDARD_LABELS,
  FINDING_CLASSIFICATIONS,
  FINDING_CLASSIFICATION_LABELS,
  type AuditStandard,
  type AuditStatus,
  type FindingClassification,
  type FormField,
  type NcrStatus,
} from '@/lib/zod'
import { StandardsBadges, type AreaOption, type ProfileOption, type TemplateOption } from '../audits-table'
import {
  updateAudit,
  setAuditStatus,
  conductAuditChecklist,
  createFinding,
  updateFinding,
  closeFinding,
  reopenFinding,
  deleteFinding,
  raiseNcrFromFinding,
} from '../actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditDetailData {
  id: string
  number: string
  programme_year: string
  programme_title: string | null
  area_id: string
  area_name: string
  standards: AuditStandard[]
  auditor_id: string | null
  auditor_name: string | null
  auditee: string | null
  planned_date: string | null
  conducted_date: string | null
  status: AuditStatus
  summary: string | null
  closed_at: string | null
  checklist_template_id: string | null
  checklist_template_name: string | null
  checklist_submission_id: string | null
}

export interface ChecklistData {
  templateSchema: FormField[]
  submission: {
    id: string
    data: Record<string, unknown>
    schema: FormField[]
    submitted_at: string
    submitted_by_name: string | null
  } | null
}

export interface FindingRow {
  id: string
  audit_id: string
  classification: FindingClassification
  description: string
  clause_ref: string | null
  status: 'open' | 'closed'
  ncr_id: string | null
  ncr_number: string | null
  ncr_status: NcrStatus | null
  raised_by_name: string | null
  closed_at: string | null
  created_at: string
}

// ─── Classification badge ─────────────────────────────────────────────────────

const CLASSIFICATION_CLASSES: Record<FindingClassification, string> = {
  observation:
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300',
  minor_nc:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300',
  major_nc:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300',
  opportunity:
    'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300',
}

function ClassificationBadge({
  classification,
}: {
  classification: FindingClassification
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        CLASSIFICATION_CLASSES[classification]
      )}
    >
      {FINDING_CLASSIFICATION_LABELS[classification]}
    </span>
  )
}

// ─── Edit audit dialog ────────────────────────────────────────────────────────

function EditAuditDialog({
  open,
  onOpenChange,
  audit,
  areas,
  profiles,
  templates,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  audit: AuditDetailData
  areas: AreaOption[]
  profiles: ProfileOption[]
  templates: TemplateOption[]
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    area_id: audit.area_id,
    auditor_id: audit.auditor_id ?? '',
    auditee: audit.auditee ?? '',
    planned_date: audit.planned_date ?? '',
    checklist_template_id: audit.checklist_template_id ?? '',
    summary: audit.summary ?? '',
  })
  const [standards, setStandards] = useState<AuditStandard[]>(audit.standards)

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleStandard(s: AuditStandard) {
    setStandards((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateAudit(audit.id, {
        area_id: form.area_id,
        standards,
        auditor_id: form.auditor_id || null,
        auditee: form.auditee || null,
        planned_date: form.planned_date || null,
        checklist_template_id: form.checklist_template_id || null,
        summary: form.summary || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Audit updated')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit audit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Area / process</Label>
              <Select value={form.area_id} onValueChange={(v) => v && field('area_id', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Planned date</Label>
              <Input
                type="date"
                value={form.planned_date}
                onChange={(e) => field('planned_date', e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Standards covered</Label>
            <div className="flex gap-2">
              {AUDIT_STANDARDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStandard(s)}
                  aria-pressed={standards.includes(s)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    standards.includes(s)
                      ? 'border-foreground bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {AUDIT_STANDARD_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Auditor</Label>
              <Select
                value={form.auditor_id}
                onValueChange={(v) => field('auditor_id', !v || v === '__none' ? '' : v)}
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
              <Label>Auditee</Label>
              <Input
                value={form.auditee}
                onChange={(e) => field('auditee', e.target.value)}
                placeholder="Person / function audited"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Checklist template</Label>
            <Select
              value={form.checklist_template_id}
              onValueChange={(v) =>
                field('checklist_template_id', !v || v === '__none' ? '' : v)
              }
            >
              <SelectTrigger disabled={Boolean(audit.checklist_submission_id)}>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {audit.checklist_submission_id && (
              <p className="text-xs text-muted-foreground">
                The checklist has been conducted — the template is locked.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Close-out summary</Label>
            <Textarea
              value={form.summary}
              onChange={(e) => field('summary', e.target.value)}
              placeholder="Overall conclusion for the audit report"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || standards.length === 0}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Conduct checklist dialog ─────────────────────────────────────────────────

const selectClass =
  'w-full rounded-md border bg-background px-3 py-2 text-sm appearance-none'

function ChecklistField({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField
  value: unknown
  error?: string
  onChange: (v: unknown) => void
}) {
  const id = `cl-${field.key}`

  if (field.type === 'checkbox') {
    return (
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-destructive"> *</span>}
      </Label>
      {field.type === 'select' ? (
        <select
          id={id}
          className={cn(selectClass, error && 'border-destructive')}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <Textarea
          id={id}
          rows={2}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && 'border-destructive')}
        />
      ) : field.type === 'number' ? (
        <Input
          id={id}
          type="number"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && 'border-destructive')}
        />
      ) : field.type === 'date' ? (
        <Input
          id={id}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn('w-44', error && 'border-destructive')}
        />
      ) : (
        <Input
          id={id}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && 'border-destructive')}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ConductChecklistDialog({
  open,
  onOpenChange,
  auditId,
  templateName,
  schema,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  auditId: string
  templateName: string
  schema: FormField[]
}) {
  const [pending, startTransition] = useTransition()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  function setValue(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }))
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validated = validateSubmissionData(schema, values)
    if (!validated.ok) {
      setErrors(validated.errors)
      toast.error(Object.values(validated.errors)[0])
      return
    }
    setErrors({})
    startTransition(async () => {
      const result = await conductAuditChecklist({
        audit_id: auditId,
        data: validated.data,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Checklist recorded')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conduct audit — {templateName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {schema
            .filter((f) => f.type !== 'photo' && f.type !== 'signature' && f.type !== 'rating' && f.type !== 'time')
            .map((f) => (
              <ChecklistField
                key={f.key}
                field={f}
                value={values[f.key]}
                error={errors[f.key]}
                onChange={(v) => setValue(f.key, v)}
              />
            ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Recording…' : 'Record checklist'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Finding dialog (add / edit) ──────────────────────────────────────────────

function FindingDialog({
  open,
  onOpenChange,
  auditId,
  finding,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  auditId: string
  finding?: FindingRow
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    classification: (finding?.classification ?? 'observation') as FindingClassification,
    description: finding?.description ?? '',
    clause_ref: finding?.clause_ref ?? '',
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const payload = {
        classification: form.classification,
        description: form.description,
        clause_ref: form.clause_ref || null,
      }
      const result = finding
        ? await updateFinding(finding.id, payload)
        : await createFinding({ ...payload, audit_id: auditId })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(finding ? 'Finding updated' : 'Finding recorded')
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{finding ? 'Edit finding' : 'Record finding'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Classification</Label>
              <Select
                value={form.classification}
                onValueChange={(v) =>
                  v && setForm((f) => ({ ...f, classification: v as FindingClassification }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINDING_CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {FINDING_CLASSIFICATION_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Clause ref (optional)</Label>
              <Input
                value={form.clause_ref}
                onChange={(e) => setForm((f) => ({ ...f, clause_ref: e.target.value }))}
                placeholder="e.g. 9001 8.5.1"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What was found, and against what requirement?"
              rows={3}
              required
            />
          </div>
          {form.classification === 'major_nc' && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              A major nonconformance must be escalated to an NCR, and cannot be
              closed until that NCR is closed (verified effective).
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : finding ? 'Save' : 'Record finding'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Raise NCR dialog (prefilled from the finding) ────────────────────────────

function RaiseNcrDialog({
  open,
  onOpenChange,
  finding,
  auditNumber,
  areaName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  finding: FindingRow
  auditNumber: string
  areaName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    severity: finding.classification === 'major_nc' ? '4' : '3',
    title: `Audit finding — ${finding.clause_ref ? `${finding.clause_ref} — ` : ''}${areaName}`,
    description: `Raised from internal audit ${auditNumber}${
      finding.clause_ref ? ` (clause ${finding.clause_ref})` : ''
    }:\n\n${finding.description}`,
    category: 'Internal audit',
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await raiseNcrFromFinding({
        finding_id: finding.id,
        severity: form.severity,
        title: form.title,
        description: form.description,
        category: form.category || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('NCR raised and linked to the finding')
      onOpenChange(false)
      if (result.ncrId) router.push(`/whs/ncr/${result.ncrId}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise NCR from finding</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Creates a numbered NCR (source: audit finding) in the NCR/CAPA
            register and links it to this finding.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Severity (1–5)</Label>
              <Select
                value={form.severity}
                onValueChange={(v) => v && setForm((f) => ({ ...f, severity: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} {n >= 4 ? '— High' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={5}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Raising…' : 'Raise NCR'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AuditDetailClient({
  audit,
  checklist,
  findings,
  areas,
  profiles,
  templates,
  role,
  profileId,
  auditHistory,
}: {
  audit: AuditDetailData
  checklist: ChecklistData
  findings: FindingRow[]
  areas: AreaOption[]
  profiles: ProfileOption[]
  templates: TemplateOption[]
  role: string
  profileId: string
  auditHistory: AuditLogRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [conductOpen, setConductOpen] = useState(false)
  const [findingDialogOpen, setFindingDialogOpen] = useState(false)
  const [editingFinding, setEditingFinding] = useState<FindingRow | undefined>(undefined)
  const [raiseNcrFinding, setRaiseNcrFinding] = useState<FindingRow | null>(null)

  const isAdmin = role === 'admin'
  // Mirrors the server rule: admin/office always; supervisor only when they
  // are the named auditor.
  const canWork =
    role === 'admin' ||
    role === 'office' ||
    (role === 'supervisor' && audit.auditor_id === profileId)

  const openFindings = findings.filter((f) => f.status === 'open').length
  const conductable = audit.status === 'planned' || audit.status === 'in_progress'

  function doStatusTransition(newStatus: AuditStatus, successMessage: string) {
    startTransition(async () => {
      const result = await setAuditStatus(audit.id, { status: newStatus })
      if (result.error) toast.error(result.error)
      else toast.success(successMessage)
    })
  }

  function doCloseFinding(finding: FindingRow) {
    startTransition(async () => {
      const result = await closeFinding(finding.id)
      if (result.error) toast.error(result.error)
      else toast.success('Finding closed')
    })
  }

  function doReopenFinding(finding: FindingRow) {
    startTransition(async () => {
      const result = await reopenFinding(finding.id)
      if (result.error) toast.error(result.error)
      else toast.success('Finding reopened')
    })
  }

  function doDeleteFinding(finding: FindingRow) {
    if (!confirm('Delete this finding?')) return
    startTransition(async () => {
      const result = await deleteFinding(finding.id)
      if (result.error) toast.error(result.error)
      else toast.success('Finding deleted')
    })
  }

  const meta = [
    { label: 'Programme', value: audit.programme_year },
    { label: 'Area / process', value: audit.area_name },
    { label: 'Standards', value: <StandardsBadges standards={audit.standards} /> },
    { label: 'Status', value: <StatusBadge status={audit.status} /> },
    { label: 'Auditor', value: audit.auditor_name ?? '—' },
    { label: 'Auditee', value: audit.auditee ?? '—' },
    {
      label: 'Planned',
      value: audit.planned_date ? fmtDate(audit.planned_date) : '—',
    },
    {
      label: 'Conducted',
      value: audit.conducted_date ? fmtDate(audit.conducted_date) : '—',
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-bold">{audit.number}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Internal audit — {audit.area_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWork && audit.status === 'planned' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('in_progress', 'Audit started')}
            >
              Start audit
            </Button>
          )}
          {canWork && conductable && audit.checklist_template_id && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConductOpen(true)}
            >
              <ClipboardCheckIcon className="mr-1 size-3.5" />
              {audit.checklist_submission_id ? 'Redo checklist' : 'Conduct checklist'}
            </Button>
          )}
          {canWork && audit.status === 'in_progress' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('complete', 'Audit complete — checklist frozen')}
            >
              Mark complete
            </Button>
          )}
          {canWork && audit.status === 'complete' && (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => doStatusTransition('closed', 'Audit closed')}
              >
                Close audit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  doStatusTransition('in_progress', 'Audit returned to in progress')
                }
              >
                Return to in progress
              </Button>
            </>
          )}
          {audit.status === 'closed' && isAdmin && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => doStatusTransition('complete', 'Audit reopened')}
            >
              <RotateCcwIcon className="mr-1 size-3.5" />
              Reopen
            </Button>
          )}
          {canWork && audit.status !== 'closed' && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditOpen(true)}>
              <PencilIcon className="mr-1 size-3.5" />
              Edit
            </Button>
          )}
          <a href={`/api/pdf/audit/${audit.id}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost">
              PDF
            </Button>
          </a>
        </div>
      </div>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {meta.map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-1 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Close-out summary</p>
            <p className="whitespace-pre-wrap text-sm">
              {audit.summary ?? (
                <span className="text-muted-foreground">
                  Not yet written — capture the overall conclusion before close-out.
                </span>
              )}
            </p>
          </div>
          {audit.closed_at && (
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Closed {fmtDate(audit.closed_at)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Checklist{audit.checklist_template_name ? ` — ${audit.checklist_template_name}` : ''}
            </CardTitle>
            {checklist.submission && (
              <a
                href={`/api/pdf/form/${checklist.submission.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button size="sm" variant="ghost">
                  Checklist PDF
                </Button>
              </a>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!audit.checklist_template_id ? (
            <p className="text-sm text-muted-foreground">
              No checklist template picked yet — set one via Edit before conducting the audit.
            </p>
          ) : !checklist.submission ? (
            <p className="text-sm text-muted-foreground">
              Not conducted yet. The audit cannot be marked complete until the
              checklist has been filled.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Check item</TableHead>
                      <TableHead className="w-40">Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {checklist.submission.schema
                      .filter((f) => f.type !== 'photo')
                      .map((f) => {
                        const raw = checklist.submission!.data[f.key]
                        const value =
                          raw === undefined || raw === null || raw === ''
                            ? '—'
                            : typeof raw === 'boolean'
                              ? raw
                                ? 'Yes'
                                : 'No'
                              : String(raw)
                        const bad = value === 'Minor NC' || value === 'Major NC'
                        return (
                          <TableRow key={f.key}>
                            <TableCell className="text-sm">{f.label}</TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  'whitespace-pre-wrap text-sm',
                                  bad
                                    ? 'font-medium text-red-600 dark:text-red-400'
                                    : value === 'Conforming'
                                      ? 'text-green-700 dark:text-green-400'
                                      : 'text-muted-foreground'
                                )}
                              >
                                {value}
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Conducted by {checklist.submission.submitted_by_name ?? '—'} ·{' '}
                {fmtDate(checklist.submission.submitted_at)}
                {audit.status === 'complete' || audit.status === 'closed'
                  ? ' · frozen (audit complete)'
                  : ''}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Findings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              Findings
              {openFindings > 0 && (
                <span className="ml-2 text-xs font-medium text-red-600 dark:text-red-400">
                  {openFindings} open
                </span>
              )}
            </CardTitle>
            {canWork && audit.status !== 'closed' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingFinding(undefined)
                  setFindingDialogOpen(true)
                }}
              >
                <PlusIcon className="mr-1 size-3.5" />
                Record finding
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No findings recorded. An audit with no findings can be closed once complete.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classification</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Clause</TableHead>
                    <TableHead>NCR</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findings.map((finding) => (
                    <TableRow key={finding.id}>
                      <TableCell>
                        <ClassificationBadge classification={finding.classification} />
                      </TableCell>
                      <TableCell className="max-w-[280px] text-sm">
                        {finding.description}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {finding.clause_ref ?? '—'}
                      </TableCell>
                      <TableCell>
                        {finding.ncr_id ? (
                          <Link
                            href={`/whs/ncr/${finding.ncr_id}`}
                            className="flex items-center gap-1.5 text-sm hover:underline"
                          >
                            <span className="font-mono">{finding.ncr_number}</span>
                            {finding.ncr_status && (
                              <StatusBadge status={finding.ncr_status} />
                            )}
                          </Link>
                        ) : finding.classification === 'major_nc' &&
                          finding.status === 'open' ? (
                          <span
                            className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400"
                            title="A major NC must be escalated to an NCR before it can be closed"
                          >
                            <AlertOctagonIcon className="size-3.5" />
                            NCR required
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={finding.status} />
                        {finding.closed_at && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {fmtDate(finding.closed_at)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canWork && audit.status !== 'closed' && (
                          <div className="flex items-center justify-end gap-1">
                            {!finding.ncr_id && finding.status === 'open' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() => setRaiseNcrFinding(finding)}
                              >
                                Raise NCR
                              </Button>
                            )}
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title={finding.status === 'open' ? 'Close finding' : 'Reopen'}
                              disabled={pending}
                              onClick={() =>
                                finding.status === 'open'
                                  ? doCloseFinding(finding)
                                  : doReopenFinding(finding)
                              }
                            >
                              {finding.status === 'open' ? (
                                <CheckIcon className="size-3.5" />
                              ) : (
                                <RotateCcwIcon className="size-3.5" />
                              )}
                            </Button>
                            {finding.status === 'open' && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title="Edit"
                                onClick={() => {
                                  setEditingFinding(finding)
                                  setFindingDialogOpen(true)
                                }}
                              >
                                <PencilIcon className="size-3.5" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title="Delete"
                                disabled={pending}
                                onClick={() => doDeleteFinding(finding)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2Icon className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">History</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditHistory rows={auditHistory} />
        </CardContent>
      </Card>

      {/* Dialogs */}
      <EditAuditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        audit={audit}
        areas={areas}
        profiles={profiles}
        templates={templates}
      />
      {audit.checklist_template_id && (
        <ConductChecklistDialog
          open={conductOpen}
          onOpenChange={setConductOpen}
          auditId={audit.id}
          templateName={audit.checklist_template_name ?? 'Checklist'}
          schema={checklist.templateSchema}
        />
      )}
      <FindingDialog
        key={editingFinding?.id ?? 'new'}
        open={findingDialogOpen}
        onOpenChange={(open) => {
          setFindingDialogOpen(open)
          if (!open) setEditingFinding(undefined)
        }}
        auditId={audit.id}
        finding={editingFinding}
      />
      {raiseNcrFinding && (
        <RaiseNcrDialog
          key={raiseNcrFinding.id}
          open={raiseNcrFinding !== null}
          onOpenChange={(open) => {
            if (!open) setRaiseNcrFinding(null)
          }}
          finding={raiseNcrFinding}
          auditNumber={audit.number}
          areaName={audit.area_name}
        />
      )}
    </div>
  )
}
