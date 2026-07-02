'use client'

import React, { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  PlusIcon,
  ScaleIcon,
  DownloadIcon,
  FileTextIcon,
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
import { ComplianceLight } from '@/components/ComplianceLight'
import { deriveComplianceStatus } from '@/lib/compliance'
import { todayAUClient } from '@/lib/tz-client'
import { fmtDate } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import {
  LEGAL_CATEGORIES,
  LEGAL_CATEGORY_LABELS,
  LEGAL_JURISDICTIONS,
  LEGAL_JURISDICTION_LABELS,
  RISK_DOMAINS,
  RISK_DOMAIN_LABELS,
  COMPLIANCE_STATES,
  COMPLIANCE_STATE_LABELS,
  OBLIGATION_STATUSES,
  OBLIGATION_STATUS_LABELS,
  type LegalCategory,
  type LegalJurisdiction,
  type RiskDomain,
  type ComplianceState,
  type ObligationStatus,
} from '@/lib/zod'
import { createObligation } from './actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObligationRow {
  id: string
  number: string
  title: string
  category: LegalCategory
  jurisdiction: LegalJurisdiction
  iso_domain: RiskDomain
  next_review_date: string | null
  current_compliance: ComplianceState
  status: ObligationStatus
  responsible_name: string | null
  controlling_doc_label: string | null
}

export interface DocumentOption {
  id: string
  label: string
}

export interface ProfileOption {
  id: string
  full_name: string
}

// ─── Compliance badge (derived state — compliant / gap / not evaluated) ───────

const COMPLIANCE_CLASSES: Record<ComplianceState, string> = {
  compliant:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300',
  gap: 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300',
  not_evaluated:
    'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

export function ComplianceBadge({ state }: { state: ComplianceState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        COMPLIANCE_CLASSES[state]
      )}
    >
      {COMPLIANCE_STATE_LABELS[state]}
    </span>
  )
}

/** Traffic light against next_review_date (30-day amber rule, AU calendar). */
export function reviewLight(
  nextReviewDate: string | null,
  today: string
): 'green' | 'amber' | 'red' {
  return deriveComplianceStatus(
    nextReviewDate ? [{ expiry_date: nextReviewDate }] : [],
    today
  )
}

// ─── Add obligation dialog (admin/office) ─────────────────────────────────────

function AddObligationDialog({
  open,
  onOpenChange,
  documents,
  profiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: DocumentOption[]
  profiles: ProfileOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({
    title: '',
    category: 'act' as LegalCategory,
    jurisdiction: 'qld' as LegalJurisdiction,
    iso_domain: 'ohs' as RiskDomain,
    summary: '',
    how_it_applies: '',
    how_we_comply: '',
    controlling_document_id: '',
    responsible_id: '',
    review_frequency_months: '12',
    next_review_date: '',
  })

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createObligation({
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
      toast.success('Obligation added')
      onOpenChange(false)
      if (result.id) router.push(`/whs/legal/${result.id}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add obligation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => field('title', e.target.value)}
              placeholder="e.g. Work Health and Safety Act 2011 (Qld)"
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
              placeholder="Summary of the requirement"
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
              placeholder="Controls, procedures and records demonstrating compliance"
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
            <div className="col-span-1 flex flex-col gap-1.5">
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
              {pending ? 'Adding…' : 'Add obligation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function LegalClient({
  items,
  documents,
  profiles,
  role,
}: {
  items: ObligationRow[]
  documents: DocumentOption[]
  profiles: ProfileOption[]
  role: 'admin' | 'office' | 'supervisor'
}) {
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string>('all')
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [complianceFilter, setComplianceFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)

  const today = todayAUClient()
  const canManage = role === 'admin' || role === 'office'

  const filtered = useMemo(
    () =>
      items.filter((o) => {
        if (statusFilter !== 'all' && o.status !== statusFilter) return false
        if (categoryFilter !== 'all' && o.category !== categoryFilter) return false
        if (jurisdictionFilter !== 'all' && o.jurisdiction !== jurisdictionFilter)
          return false
        if (domainFilter !== 'all' && o.iso_domain !== domainFilter) return false
        if (complianceFilter !== 'all' && o.current_compliance !== complianceFilter)
          return false
        return true
      }),
    [items, statusFilter, categoryFilter, jurisdictionFilter, domainFilter, complianceFilter]
  )

  function exportCsv() {
    downloadCsv(
      'legal-register.csv',
      filtered.map((o) => ({
        number: o.number,
        title: o.title,
        category: LEGAL_CATEGORY_LABELS[o.category],
        jurisdiction: LEGAL_JURISDICTION_LABELS[o.jurisdiction],
        domain: RISK_DOMAIN_LABELS[o.iso_domain],
        responsible: o.responsible_name ?? '',
        controlling_document: o.controlling_doc_label ?? '',
        next_review: o.next_review_date ?? '',
        compliance: COMPLIANCE_STATE_LABELS[o.current_compliance],
        status: OBLIGATION_STATUS_LABELS[o.status],
      }))
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {(['all', ...OBLIGATION_STATUSES] as const).map((s) => (
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
              {s === 'all' ? 'All' : OBLIGATION_STATUS_LABELS[s as ObligationStatus]}{' '}
              <span className="text-xs opacity-70">
                {s === 'all'
                  ? items.length
                  : items.filter((o) => o.status === s).length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v ?? 'all')}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {LEGAL_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {LEGAL_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={jurisdictionFilter}
            onValueChange={(v) => setJurisdictionFilter(v ?? 'all')}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All jurisdictions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jurisdictions</SelectItem>
              {LEGAL_JURISDICTIONS.map((j) => (
                <SelectItem key={j} value={j}>
                  {LEGAL_JURISDICTION_LABELS[j]}
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

          <Select
            value={complianceFilter}
            onValueChange={(v) => setComplianceFilter(v ?? 'all')}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All compliance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All compliance</SelectItem>
              {COMPLIANCE_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {COMPLIANCE_STATE_LABELS[s]}
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

          <Button
            size="sm"
            variant="outline"
            render={
              <a
                href="/api/pdf/legal-register/list"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <FileTextIcon className="size-4" />
            PDF
          </Button>

          {canManage && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <PlusIcon className="size-4" />
              Add obligation
            </Button>
          )}
        </div>
      </div>

      {/* Register */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<ScaleIcon className="size-8" />}
          title="No obligations"
          description="No obligations match the current filters."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead>Controlling doc</TableHead>
                <TableHead>Next review</TableHead>
                <TableHead>Compliance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link
                      href={`/whs/legal/${o.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {o.number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <div className="flex flex-col">
                      <Link
                        href={`/whs/legal/${o.id}`}
                        className="truncate text-sm hover:underline"
                      >
                        {o.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {RISK_DOMAIN_LABELS[o.iso_domain]}
                        {o.status === 'retired' ? ' · Retired' : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {LEGAL_CATEGORY_LABELS[o.category]}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {LEGAL_JURISDICTION_LABELS[o.jurisdiction]}
                  </TableCell>
                  <TableCell className="max-w-[130px] truncate text-sm text-muted-foreground">
                    {o.responsible_name ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                    {o.controlling_doc_label ?? '—'}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 text-sm tabular-nums">
                      {o.status === 'active' ? (
                        <ComplianceLight
                          status={reviewLight(o.next_review_date, today)}
                        />
                      ) : null}
                      {o.next_review_date ? fmtDate(o.next_review_date) : '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {o.status === 'retired' ? (
                      <StatusBadge status="retired" />
                    ) : (
                      <ComplianceBadge state={o.current_compliance} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && (
        <AddObligationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          documents={documents}
          profiles={profiles}
        />
      )}
    </div>
  )
}
