'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { ArchiveBanner, ArchiveButton } from '@/components/ArchiveControl'
import { aud, fmtDate, pct } from '@/lib/format'
import { docTotals, lineTotal, round2 } from '@/lib/money'
import type { PricingDisplay, QuoteDoc } from '@/lib/quote-doc'
import { cn } from '@/lib/utils'
import { canPublishQuote } from '@/lib/portal-interactions'
import {
  addLine,
  addSection,
  convertQuoteToJob,
  convertQuoteToProject,
  deleteSection,
  moveSection,
  setQuotePortalPublished,
  setQuoteStatus,
  updateQuoteHeader,
  updateSection,
} from '../actions'
import {
  LineRow,
  LINE_GRID_COLS_EDITABLE,
  LINE_GRID_COLS_READONLY,
  type LineData,
} from './line-row'
import { RatePickerDialog } from './rate-picker-dialog'
import { DuplicateQuoteButton } from './duplicate-quote-button'
import { QuoteDocCard } from './quote-doc-card'
import { QuotePdfDialog } from './quote-pdf-dialog'

export type { LineData }
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BriefcaseIcon,
  CheckIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GlobeIcon,
  LayersIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

const NONE = 'none'

/** Sign-on-the-glass evidence recorded by the client portal. */
export interface QuotePortalAcceptance {
  action: 'accepted' | 'declined'
  signer_name: string
  /** Pre-formatted Brisbane datetime. */
  signed_display: string
  /** PNG data URL (accepted only). */
  signature_data: string | null
  reason: string | null
  ip: string | null
}

export interface QuoteData {
  id: string
  number: string
  title: string
  description: string | null
  status: 'draft' | 'sent' | 'accepted' | 'lost'
  gst_rate: number
  valid_days: number
  sent_at: string | null
  decided_at: string | null
  lost_reason: string | null
  client_name: string
  site_name: string | null
  contact_name: string | null
  pm_id: string | null
  pm_name: string | null
  converted_to: 'job' | 'project' | null
  converted_id: string | null
  converted_number: string | null
  archived: boolean
  portal_published: boolean
  portal_acceptance: QuotePortalAcceptance | null
  template_id: string | null
  template_name: string | null
  doc: QuoteDoc | null
  pdf_options: PricingDisplay | null
}

/** Active quote template, offered on the PDF dialog. */
export interface TemplateOption {
  id: string
  name: string
  is_default: boolean
  /** Template's default pricing display; seeds the PDF dialog when picked. */
  pricing_defaults: PricingDisplay
}

export interface SectionData {
  id: string
  title: string
  position: number
}

export interface RateItemData {
  id: string
  kind: string
  name: string
  unit: string
  cost: number
  default_markup_pct: number
}

export interface PmOption {
  id: string
  full_name: string
}

export function QuoteBuilder({
  quote,
  sections,
  lines,
  rateItems,
  pmOptions,
  templates,
}: {
  quote: QuoteData
  sections: SectionData[]
  lines: LineData[]
  rateItems: RateItemData[]
  pmOptions: PmOption[]
  templates: TemplateOption[]
}) {
  const editable = quote.status === 'draft' || quote.status === 'sent'

  // Lines whose section was deleted out from under them (FK sets null).
  const orphanLines = lines.filter((l) => l.section_id === null)

  return (
    <div className="flex flex-col gap-6">
      {quote.archived && <ArchiveBanner kind="quote" id={quote.id} />}

      <HeaderCard
        quote={quote}
        editable={editable}
        pmOptions={pmOptions}
        templates={templates}
      />

      <QuoteDocCard
        quoteId={quote.id}
        doc={quote.doc}
        templateName={quote.template_name}
        editable={editable}
      />

      {sections.map((section, i) => (
        <SectionCard
          key={section.id}
          quoteId={quote.id}
          section={section}
          lines={lines.filter((l) => l.section_id === section.id)}
          rateItems={rateItems}
          editable={editable}
          isFirst={i === 0}
          isLast={i === sections.length - 1}
        />
      ))}

      {orphanLines.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Ungrouped lines
            </h3>
            <LinesGrid
              lines={orphanLines}
              editable={editable}
            />
          </CardContent>
        </Card>
      )}

      {sections.length === 0 && orphanLines.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={<LayersIcon className="size-8" />}
              title="No sections yet"
              description="Add a section, then add lines to build the quote."
            />
          </CardContent>
        </Card>
      )}

      {editable && <AddSectionButton quoteId={quote.id} count={sections.length} />}

      <TotalsCard lines={lines} gstRate={quote.gst_rate} />
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

function HeaderCard({
  quote,
  editable,
  pmOptions,
  templates,
}: {
  quote: QuoteData
  editable: boolean
  pmOptions: PmOption[]
  templates: TemplateOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState(quote.title)
  const [validDays, setValidDays] = useState(String(quote.valid_days))
  const [description, setDescription] = useState(quote.description ?? '')
  const [pmId, setPmId] = useState(quote.pm_id ?? NONE)

  function savePm(value: string) {
    setPmId(value)
    startTransition(async () => {
      const result = await updateQuoteHeader(quote.id, {
        pm_id: value === NONE ? null : value,
      })
      if (result.error) {
        toast.error(result.error)
        setPmId(quote.pm_id ?? NONE)
        return
      }
      toast.success('PM updated')
      router.refresh()
    })
  }

  function saveHeader(data: { title?: string; valid_days?: number; description?: string }) {
    startTransition(async () => {
      const result = await updateQuoteHeader(quote.id, data)
      if (result.error) {
        toast.error(result.error)
        // Revert optimistic state to the last server values.
        setTitle(quote.title)
        setValidDays(String(quote.valid_days))
        setDescription(quote.description ?? '')
        return
      }
      router.refresh()
    })
  }

  function changeStatus(status: 'sent' | 'accepted' | 'lost', lost_reason?: string) {
    startTransition(async () => {
      const result = await setQuoteStatus(quote.id, { status, lost_reason })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        status === 'sent'
          ? 'Quote marked as sent'
          : status === 'accepted'
            ? 'Quote accepted'
            : 'Quote marked as lost'
      )
      router.refresh()
    })
  }

  function handleLost() {
    const reason = prompt('Why was this quote lost? (optional)')
    if (reason === null) return // cancelled
    changeStatus('lost', reason)
  }

  function handlePortalPublish(published: boolean) {
    startTransition(async () => {
      const result = await setQuotePortalPublished(quote.id, published)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        published
          ? 'Published — the client can now view and sign this quote in their portal'
          : 'Removed from the client portal'
      )
      router.refresh()
    })
  }

  function handleConvertToJob() {
    const ok = confirm(
      `Convert "${quote.title}" to a Job?\n\nThis will create a new scheduled job from this quote. The quote cannot be converted again once confirmed.`
    )
    if (!ok) return
    startTransition(async () => {
      const result = await convertQuoteToJob(quote.id)
      if (result?.error) {
        toast.error(result.error)
      }
    })
  }

  function handleConvertToProject() {
    const ok = confirm(
      `Convert "${quote.title}" to a Project?\n\nThis will create a new project with budget lines derived from the quote sections. The quote cannot be converted again once confirmed.`
    )
    if (!ok) return
    startTransition(async () => {
      const result = await convertQuoteToProject(quote.id)
      if (result?.error) {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-lg font-semibold">{quote.number}</span>
              <StatusBadge status={quote.status} />
              {quote.converted_to && quote.converted_id && (
                <a
                  href={`/${quote.converted_to === 'job' ? 'jobs' : 'projects'}/${quote.converted_id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                >
                  <ExternalLinkIcon className="size-3" />
                  Converted &rarr; {quote.converted_number ?? (quote.converted_to === 'job' ? 'Job' : 'Project')}
                </a>
              )}
            </div>
            {editable ? (
              <Input
                aria-label="Quote title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (title.trim() && title !== quote.title) {
                    saveHeader({ title: title.trim() })
                  } else if (!title.trim()) {
                    setTitle(quote.title)
                  }
                }}
                className="max-w-xl font-medium"
              />
            ) : (
              <p className="text-base font-medium">{quote.title}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {quote.status === 'draft' && (
              <Button onClick={() => changeStatus('sent')} disabled={pending}>
                <SendIcon />
                Mark sent
              </Button>
            )}
            {quote.status === 'sent' && (
              <>
                <Button onClick={() => changeStatus('accepted')} disabled={pending}>
                  <CheckIcon />
                  Accepted
                </Button>
                <Button variant="destructive" onClick={handleLost} disabled={pending}>
                  <XIcon />
                  Lost
                </Button>
              </>
            )}
            {quote.status === 'accepted' && !quote.converted_id && (
              <>
                <Button variant="outline" onClick={handleConvertToJob} disabled={pending}>
                  <BriefcaseIcon />
                  Convert to Job
                </Button>
                <Button variant="outline" onClick={handleConvertToProject} disabled={pending}>
                  <FolderOpenIcon />
                  Convert to Project
                </Button>
              </>
            )}
            <QuotePdfDialog quote={quote} templates={templates} editable={editable} />
            <DuplicateQuoteButton id={quote.id} />
            {!quote.archived && <ArchiveButton kind="quote" id={quote.id} />}
          </div>
        </div>

        <Separator />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-muted-foreground">Client</dt>
            <dd className="font-medium">{quote.client_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Site</dt>
            <dd className="font-medium">{quote.site_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Contact</dt>
            <dd className="font-medium">{quote.contact_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">PM</dt>
            <dd>
              {editable ? (
                <Select value={pmId} onValueChange={(v) => savePm(v ?? NONE)}>
                  <SelectTrigger className="mt-0.5 h-7 w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No PM</SelectItem>
                    {pmOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-medium">{quote.pm_name ?? '—'}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              <Label htmlFor="qb-valid-days" className="font-normal text-muted-foreground">
                Valid (days)
              </Label>
            </dt>
            <dd>
              {editable ? (
                <Input
                  id="qb-valid-days"
                  type="number"
                  min={1}
                  max={365}
                  value={validDays}
                  onChange={(e) => setValidDays(e.target.value)}
                  onBlur={() => {
                    const n = parseInt(validDays, 10)
                    if (Number.isFinite(n) && n >= 1 && n <= 365 && n !== quote.valid_days) {
                      saveHeader({ valid_days: n })
                    } else if (!Number.isFinite(n) || n < 1 || n > 365) {
                      setValidDays(String(quote.valid_days))
                    }
                  }}
                  className="mt-0.5 h-7 w-20 tabular-nums"
                />
              ) : (
                <span className="font-medium tabular-nums">{quote.valid_days}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Sent</dt>
            <dd className="font-medium">{quote.sent_at ? fmtDate(quote.sent_at) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Decided</dt>
            <dd className="font-medium">
              {quote.decided_at ? fmtDate(quote.decided_at) : '—'}
            </dd>
          </div>
        </dl>

        {quote.status === 'lost' && quote.lost_reason && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Lost: {quote.lost_reason}
          </p>
        )}

        {/* Client portal: publish-for-signing toggle + acceptance evidence */}
        {canPublishQuote(quote.status) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <GlobeIcon className="size-4 text-muted-foreground" />
              {quote.portal_published ? (
                <span>
                  <span className="font-medium">On the client portal</span>
                  {' — '}
                  <span className="text-muted-foreground">
                    {quote.status === 'sent'
                      ? `${quote.client_name} can view the PDF and sign online.`
                      : `${quote.client_name} can view the accepted quotation.`}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Not on the client portal — publish so {quote.client_name} can view
                  {quote.status === 'sent' ? ' and sign' : ''} this quote online.
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => handlePortalPublish(!quote.portal_published)}
            >
              {quote.portal_published ? 'Unpublish' : 'Publish to portal'}
            </Button>
          </div>
        )}

        {quote.portal_acceptance?.action === 'accepted' && (
          <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 dark:border-green-800 dark:bg-green-950">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Accepted via client portal
            </p>
            <p className="text-sm text-green-700 dark:text-green-300/80">
              Signed by {quote.portal_acceptance.signer_name} on{' '}
              {quote.portal_acceptance.signed_display}
              {quote.portal_acceptance.ip ? ` · ${quote.portal_acceptance.ip}` : ''}
            </p>
            {quote.portal_acceptance.signature_data && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={quote.portal_acceptance.signature_data}
                alt={`Signature of ${quote.portal_acceptance.signer_name}`}
                className="h-16 w-fit max-w-56 rounded border bg-white object-contain"
              />
            )}
          </div>
        )}

        {quote.portal_acceptance?.action === 'declined' && quote.status === 'sent' && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm dark:border-red-900 dark:bg-red-950">
            <p className="font-medium text-red-700 dark:text-red-300">
              Declined via client portal
            </p>
            <p className="text-red-600 dark:text-red-300/80">
              {quote.portal_acceptance.signer_name} on{' '}
              {quote.portal_acceptance.signed_display}
              {quote.portal_acceptance.reason
                ? ` — “${quote.portal_acceptance.reason}”`
                : ''}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qb-description" className="text-muted-foreground">
            Description
          </Label>
          {editable ? (
            <Textarea
              id="qb-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if (description !== (quote.description ?? '')) {
                  saveHeader({ description })
                }
              }}
              placeholder="Scope of works, inclusions, exclusions…"
              rows={3}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm">
              {quote.description || '—'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Sections ────────────────────────────────────────────────────────────────

function SectionCard({
  quoteId,
  section,
  lines,
  rateItems,
  editable,
  isFirst,
  isLast,
}: {
  quoteId: string
  section: SectionData
  lines: LineData[]
  rateItems: RateItemData[]
  editable: boolean
  isFirst: boolean
  isLast: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(section.title)

  function saveTitle() {
    if (!title.trim()) {
      setTitle(section.title)
      return
    }
    if (title.trim() === section.title) return
    startTransition(async () => {
      const result = await updateSection(section.id, title.trim())
      if (result.error) {
        toast.error(result.error)
        setTitle(section.title)
        return
      }
      router.refresh()
    })
  }

  function handleMove(dir: 'up' | 'down') {
    startTransition(async () => {
      const result = await moveSection(section.id, dir)
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleDelete() {
    const message =
      lines.length > 0
        ? `Delete section "${section.title}" and its ${lines.length} line${lines.length === 1 ? '' : 's'}?`
        : `Delete section "${section.title}"?`
    if (!confirm(message)) return
    startTransition(async () => {
      const result = await deleteSection(section.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Section deleted')
      router.refresh()
    })
  }

  function handleAddLine() {
    startTransition(async () => {
      const result = await addLine({ quote_id: quoteId, section_id: section.id })
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          {editable ? (
            <Input
              aria-label="Section title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              className="max-w-sm font-semibold"
            />
          ) : (
            <h3 className="text-sm font-semibold">{section.title}</h3>
          )}
          {editable && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => handleMove('up')}
                disabled={pending || isFirst}
              >
                <ArrowUpIcon />
                <span className="sr-only">Move section up</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => handleMove('down')}
                disabled={pending || isLast}
              >
                <ArrowDownIcon />
                <span className="sr-only">Move section down</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleDelete}
                disabled={pending}
              >
                <Trash2Icon className="text-destructive" />
                <span className="sr-only">Delete section</span>
              </Button>
            </div>
          )}
        </div>

        <LinesGrid lines={lines} editable={editable} />

        {editable && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleAddLine} disabled={pending}>
              <PlusIcon />
              Add line
            </Button>
            <RatePickerDialog
              quoteId={quoteId}
              sectionId={section.id}
              rateItems={rateItems}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LinesGrid({ lines, editable }: { lines: LineData[]; editable: boolean }) {
  if (lines.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">No lines yet.</p>
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'hidden gap-2 px-1 text-xs font-medium text-muted-foreground md:grid',
          editable ? LINE_GRID_COLS_EDITABLE : LINE_GRID_COLS_READONLY
        )}
      >
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span>Unit</span>
        <span className="text-right">Unit cost</span>
        <span className="text-right">Markup %</span>
        <span className="text-right">Unit sell</span>
        <span className="text-right">Total</span>
        {editable && <span className="sr-only">Actions</span>}
      </div>
      {lines.map((line, i) => (
        <LineRow
          key={line.id}
          line={line}
          editable={editable}
          isFirst={i === 0}
          isLast={i === lines.length - 1}
        />
      ))}
    </div>
  )
}

function AddSectionButton({ quoteId, count }: { quoteId: string; count: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleAdd() {
    startTransition(async () => {
      const result = await addSection({
        quote_id: quoteId,
        title: `Section ${count + 1}`,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div>
      <Button variant="outline" onClick={handleAdd} disabled={pending}>
        <PlusIcon />
        Add section
      </Button>
    </div>
  )
}

// ─── Totals ──────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  labour: 'Labour',
  plant: 'Plant',
  material: 'Materials',
  subbie: 'Subcontract',
  other: 'Other',
}
const KIND_ORDER = ['labour', 'plant', 'material', 'subbie', 'other', 'untagged']

function TotalsCard({ lines, gstRate }: { lines: LineData[]; gstRate: number }) {
  const { subtotal, gst, total } = docTotals(
    lines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })),
    gstRate
  )
  const costTotal = round2(
    lines.reduce((s, l) => s + lineTotal(l.qty, l.unit_cost), 0)
  )
  const marginDollars = round2(subtotal - costTotal)
  const marginPct = subtotal > 0 ? round2((marginDollars / subtotal) * 100) : 0

  // Internal margin lens: where the money sits by cost category. Lines from
  // the rate library / takeoff carry their kind; hand-typed lines show as
  // Untagged. Only shown once at least one line is categorised.
  const byKind = new Map<string, { cost: number; sell: number }>()
  for (const l of lines) {
    const key = l.kind ?? 'untagged'
    const entry = byKind.get(key) ?? { cost: 0, sell: 0 }
    entry.cost += lineTotal(l.qty, l.unit_cost)
    entry.sell += lineTotal(l.qty, l.unit_sell)
    byKind.set(key, entry)
  }
  const breakdown = KIND_ORDER.filter(
    (k) => byKind.has(k) && k !== 'untagged'
  ).length
    ? KIND_ORDER.filter((k) => byKind.has(k)).map((k) => {
        const entry = byKind.get(k)!
        const cost = round2(entry.cost)
        const sell = round2(entry.sell)
        return {
          kind: k,
          label: KIND_LABELS[k] ?? 'Untagged',
          cost,
          sell,
          marginPct: sell > 0 ? round2(((sell - cost) / sell) * 100) : null,
        }
      })
    : []

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {breakdown.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cost breakdown
            </p>
            <div className="grid grid-cols-[auto_1fr_1fr_3.5rem] gap-x-5 gap-y-1 tabular-nums">
              <span className="text-xs text-muted-foreground">Category</span>
              <span className="text-right text-xs text-muted-foreground">Cost</span>
              <span className="text-right text-xs text-muted-foreground">Sell</span>
              <span className="text-right text-xs text-muted-foreground">Margin</span>
              {breakdown.map((b) => (
                <React.Fragment key={b.kind}>
                  <span>{b.label}</span>
                  <span className="text-right">{aud(b.cost)}</span>
                  <span className="text-right">{aud(b.sell)}</span>
                  <span className="text-right text-muted-foreground">
                    {b.marginPct === null ? '—' : pct(b.marginPct)}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
        <dl className="ml-auto flex w-full max-w-sm flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-8">
            <dt className="text-muted-foreground">Cost total</dt>
            <dd className="tabular-nums">{aud(costTotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-8">
            <dt className="text-muted-foreground">Sell subtotal (ex GST)</dt>
            <dd className="tabular-nums">{aud(subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-8">
            <dt className="text-muted-foreground">Margin</dt>
            <dd className="tabular-nums">
              {aud(marginDollars)}
              <span className="text-muted-foreground"> ({subtotal > 0 ? pct(marginPct) : '—'})</span>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-8">
            <dt className="text-muted-foreground">GST ({pct(gstRate)})</dt>
            <dd className="tabular-nums">{aud(gst)}</dd>
          </div>
          <Separator className="my-1" />
          <div className="flex items-center justify-between gap-8 text-base font-semibold">
            <dt>Total inc GST</dt>
            <dd className="tabular-nums">{aud(total)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
