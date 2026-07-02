'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import {
  ClipboardListIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  UsersIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { FormDataView } from '@/components/FormDataView'
import { ShareLinkDialog } from '@/components/ShareLinkDialog'
import { downloadCsv } from '@/lib/csv'
import { createClient } from '@/lib/supabase/client'
import type { FormField, FormTemplateKind } from '@/lib/zod'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmissionRow {
  id: string
  kind: FormTemplateKind
  templateId: string
  templateName: string
  templateVersion: number
  requiresSignon: boolean
  submittedAt: string
  project: { id: string; number: string; name: string } | null
  job: { id: string; number: string; title: string } | null
  plant: { id: string; name: string } | null
  submittedBy: string
  signonCount: number
  externalCount: number
  data: Record<string, unknown>
  /** Schema captured at submit time; null for legacy rows (fall back to template). */
  schemaSnapshot: FormField[] | null
}

export interface SignonDetail {
  id: string
  name: string
  company: string | null
  profile_id: string | null
  signed_at: string
  signature_data: string | null
  signature_path: string | null
  signedUrl?: string | null
}

// ─── Kind config ──────────────────────────────────────────────────────────────

const KIND_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Start',
  take5: 'Take 5',
  toolbox: 'Toolbox',
  induction: 'Induction',
  incident: 'Incident',
  custom: 'Custom',
  audit: 'Audit',
}

const KIND_COLORS: Record<FormTemplateKind, string> = {
  prestart: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  take5: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300',
  toolbox: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  induction: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  incident: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  custom: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  audit: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
}

const KIND_FILTER_TABS = [
  { value: 'all', label: 'All' },
  { value: 'prestart', label: 'Pre-Starts' },
  { value: 'take5', label: 'Take 5s' },
  { value: 'toolbox', label: 'Toolbox' },
  { value: 'induction', label: 'Inductions' },
  { value: 'incident', label: 'Incidents' },
  { value: 'custom', label: 'Custom' },
  { value: 'audit', label: 'Audit' },
] as const

// ─── Filters bar ──────────────────────────────────────────────────────────────

function FiltersBar({
  projects,
  profiles,
  filters,
  onFilterChange,
}: {
  projects: { id: string; number: string; name: string }[]
  profiles: { id: string; full_name: string }[]
  filters: { project_id: string; person_id: string; from: string; to: string }
  onFilterChange: (key: string, value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.project_id || '_all'}
        onValueChange={(v) => onFilterChange('project_id', !v || v === '_all' ? '' : v)}
      >
        <SelectTrigger className="w-52">
          <SelectValue placeholder="All projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.number} — {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.person_id || '_all'}
        onValueChange={(v) => onFilterChange('person_id', !v || v === '_all' ? '' : v)}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All people" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All people</SelectItem>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={filters.from}
        onChange={(e) => onFilterChange('from', e.target.value)}
        className="w-36"
        placeholder="From"
      />
      <Input
        type="date"
        value={filters.to}
        onChange={(e) => onFilterChange('to', e.target.value)}
        className="w-36"
        placeholder="To"
      />
    </div>
  )
}

// ─── Submission detail drawer ─────────────────────────────────────────────────

function SubmissionDrawer({
  row,
  schema,
  signons,
  attachmentCount,
  open,
  onClose,
}: {
  row: SubmissionRow
  schema: FormField[] | null
  signons: SignonDetail[]
  attachmentCount: number
  open: boolean
  onClose: () => void
}) {
  const targetLabel = row.project
    ? `${row.project.number} — ${row.project.name}`
    : row.job
      ? `${row.job.number} — ${row.job.title}`
      : row.plant?.name ?? '—'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`border font-medium ${KIND_COLORS[row.kind]}`}
            >
              {KIND_LABELS[row.kind]}
            </Badge>
            <span>{row.templateName}</span>
            <Badge variant="secondary" className="tabular-nums">v{row.templateVersion}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 text-sm border-b pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Target</p>
            <p>{targetLabel}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Submitted by</p>
            <p>{row.submittedBy}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Date &amp; time</p>
            <p>{format(parseISO(row.submittedAt), 'dd/MM/yyyy HH:mm')}</p>
          </div>
          {attachmentCount > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Attachments</p>
              <p>{attachmentCount} file{attachmentCount !== 1 ? 's' : ''}</p>
            </div>
          )}
        </div>

        {/* Form data */}
        {schema ? (
          <div className="py-2">
            <FormDataView schema={schema} data={row.data} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">Loading form fields…</p>
        )}

        {/* Sign-ons */}
        {signons.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-sm font-semibold mb-3 flex items-center gap-2">
              <UsersIcon className="size-4" />
              Sign-ons ({signons.length})
            </p>
            <div className="rounded-lg border divide-y">
              {signons.map((sg) => (
                <div key={sg.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{sg.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {sg.company && (
                        <p className="text-xs text-muted-foreground">{sg.company}</p>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-xs ${sg.profile_id ? 'border-green-200 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'border-slate-200 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400'}`}
                      >
                        {sg.profile_id ? 'Internal' : 'External'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(sg.signed_at), 'dd/MM/yyyy HH:mm')}
                      </span>
                    </div>
                  </div>
                  {sg.signedUrl && (
                    <img
                      src={sg.signedUrl}
                      alt={`${sg.name} signature`}
                      className="h-12 w-24 object-contain rounded border bg-white"
                    />
                  )}
                  {!sg.signedUrl && sg.signature_data && (
                    <img
                      src={sg.signature_data}
                      alt={`${sg.name} signature`}
                      className="h-12 w-24 object-contain rounded border bg-white"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            render={
              <a
                href={`/api/pdf/form/${row.id}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <FileTextIcon className="size-4" />
            PDF
          </Button>
          {row.requiresSignon && (
            <ShareLinkDialog
              target={{ formSubmissionId: row.id }}
              defaultLabel={`${row.templateName} — ${format(parseISO(row.submittedAt), 'dd/MM/yyyy')}`}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main register ─────────────────────────────────────────────────────────────

interface FormsRegisterProps {
  rows: SubmissionRow[]
  projects: { id: string; number: string; name: string }[]
  profiles: { id: string; full_name: string }[]
  filters: {
    kind: string
    project_id: string
    person_id: string
    from: string
    to: string
  }
  /** When set, auto-open the drawer for this submission ID. */
  highlight: string | null
}

export function FormsRegister({ rows, projects, profiles, filters, highlight }: FormsRegisterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  // Drawer state
  const [drawerRow, setDrawerRow] = useState<SubmissionRow | null>(null)
  const [drawerSchema, setDrawerSchema] = useState<FormField[] | null>(null)
  const [drawerSignons, setDrawerSignons] = useState<SignonDetail[]>([])
  const [drawerAttachmentCount, setDrawerAttachmentCount] = useState(0)

  // Auto-open drawer for highlight param
  React.useEffect(() => {
    if (!highlight) return
    const target = rows.find((r) => r.id === highlight)
    if (target) {
      openDrawer(target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight])

  function buildUrl(params: Record<string, string>) {
    const sp = new URLSearchParams()
    const merged = {
      kind: filters.kind,
      project_id: filters.project_id,
      person_id: filters.person_id,
      from: filters.from,
      to: filters.to,
      ...params,
    }
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== 'all') sp.set(k, v)
    }
    const qs = sp.toString()
    return `${pathname}${qs ? '?' + qs : ''}`
  }

  function handleFilterChange(key: string, value: string) {
    startTransition(() => {
      router.push(buildUrl({ [key]: value }))
    })
  }

  function handleKindTab(value: string) {
    startTransition(() => {
      router.push(buildUrl({ kind: value }))
    })
  }

  async function openDrawer(row: SubmissionRow) {
    setDrawerRow(row)
    setDrawerSchema(null)
    setDrawerSignons([])
    setDrawerAttachmentCount(0)

    const supabase = createClient()

    // Prefer the schema captured at submit time; only legacy rows (null snapshot)
    // fall back to the template's CURRENT schema.
    const needsTemplateSchema = row.schemaSnapshot === null

    // Fetch template schema (only if needed), signons, and attachment count in parallel
    const [templateRes, signonsRes, attachmentsRes] = await Promise.all([
      needsTemplateSchema
        ? supabase
            .from('form_templates')
            .select('schema')
            .eq('id', row.templateId)
            .single()
        : Promise.resolve({ data: null }),
      supabase
        .from('form_signons')
        .select('id, name, company, profile_id, signed_at, signature_data, signature_path')
        .eq('submission_id', row.id)
        .order('signed_at'),
      supabase
        .from('attachments')
        .select('id', { count: 'exact', head: true })
        .eq('parent_type', 'form_submission')
        .eq('parent_id', row.id),
    ])

    setDrawerSchema(
      row.schemaSnapshot ?? (templateRes.data?.schema as FormField[]) ?? []
    )
    setDrawerAttachmentCount(attachmentsRes.count ?? 0)

    const rawSignons = (signonsRes.data ?? []) as SignonDetail[]

    // Sign signature_path entries if present
    const toSign = rawSignons.filter((sg) => sg.signature_path && !sg.signature_data)
    const pathToUrl = new Map<string, string>()
    if (toSign.length > 0) {
      const { data: signed } = await supabase.storage
        .from('attachments')
        .createSignedUrls(toSign.map((sg) => sg.signature_path!), 3600)
      for (const entry of signed ?? []) {
        if (entry.signedUrl && entry.path) pathToUrl.set(entry.path, entry.signedUrl)
      }
    }

    const enriched = rawSignons.map((sg) => ({
      ...sg,
      signedUrl: sg.signature_path ? (pathToUrl.get(sg.signature_path) ?? null) : null,
    }))

    setDrawerSignons(enriched)
  }

  function handleCsvExport() {
    downloadCsv('whs-forms.csv', rows.map((r) => ({
      date: format(parseISO(r.submittedAt), 'dd/MM/yyyy'),
      time: format(parseISO(r.submittedAt), 'HH:mm'),
      kind: KIND_LABELS[r.kind],
      template: r.templateName,
      version: `v${r.templateVersion}`,
      target: r.project
        ? `${r.project.number} — ${r.project.name}`
        : r.job
          ? `${r.job.number} — ${r.job.title}`
          : r.plant?.name ?? '',
      submitted_by: r.submittedBy,
      signon_count: r.signonCount,
    })))
  }

  const activeKind = filters.kind || 'all'

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Kind filter tabs */}
        <div className="flex gap-1 overflow-x-auto border-b">
          {KIND_FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => handleKindTab(tab.value)}
              className={[
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                activeKind === tab.value
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FiltersBar
            projects={projects}
            profiles={profiles}
            filters={filters}
            onFilterChange={handleFilterChange}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCsvExport}
            disabled={rows.length === 0}
          >
            <DownloadIcon className="size-4" />
            CSV
          </Button>
        </div>

        {/* Table */}
        <DataTable
          columns={[
            {
              key: 'submitted_at',
              header: 'Date / Time',
              render: (r: SubmissionRow) => (
                <span className="whitespace-nowrap text-sm tabular-nums">
                  {format(parseISO(r.submittedAt), 'dd/MM/yyyy HH:mm')}
                </span>
              ),
            },
            {
              key: 'kind',
              header: 'Kind',
              render: (r: SubmissionRow) => (
                <Badge variant="outline" className={`border font-medium ${KIND_COLORS[r.kind]}`}>
                  {KIND_LABELS[r.kind]}
                </Badge>
              ),
            },
            {
              key: 'template',
              header: 'Template',
              render: (r: SubmissionRow) => (
                <span className="text-sm">
                  {r.templateName}{' '}
                  <span className="text-muted-foreground">v{r.templateVersion}</span>
                </span>
              ),
            },
            {
              key: 'target',
              header: 'Target',
              render: (r: SubmissionRow) => {
                if (r.project) {
                  return (
                    <Link
                      href={`/projects/${r.project.id}`}
                      className="text-sm hover:underline flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.project.number} — {r.project.name}
                      <ExternalLinkIcon className="size-3 text-muted-foreground" />
                    </Link>
                  )
                }
                if (r.job) {
                  return (
                    <Link
                      href={`/jobs/${r.job.id}`}
                      className="text-sm hover:underline flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.job.number} — {r.job.title}
                      <ExternalLinkIcon className="size-3 text-muted-foreground" />
                    </Link>
                  )
                }
                if (r.plant) {
                  return <span className="text-sm">{r.plant.name}</span>
                }
                return <span className="text-sm text-muted-foreground">—</span>
              },
            },
            {
              key: 'submitted_by',
              header: 'Submitted by',
              render: (r: SubmissionRow) => (
                <span className="text-sm">{r.submittedBy}</span>
              ),
            },
            {
              key: 'signons',
              header: 'Sign-ons',
              render: (r: SubmissionRow) => {
                if (!r.requiresSignon) return <span className="text-muted-foreground">—</span>
                if (r.signonCount === 0) return <span className="text-sm tabular-nums text-muted-foreground">0</span>
                return (
                  <span className="text-sm tabular-nums">
                    {r.signonCount}
                    {r.externalCount > 0 && (
                      <span className="text-muted-foreground"> ({r.externalCount} ext)</span>
                    )}
                  </span>
                )
              },
            },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              className: 'w-0',
              render: (r: SubmissionRow) => (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      openDrawer(r)
                    }}
                  >
                    View
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    render={
                      <a
                        href={`/api/pdf/form/${r.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Download PDF"
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                  >
                    <FileTextIcon className="size-4" />
                  </Button>
                </div>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={<ClipboardListIcon className="size-8" />}
              title="No form submissions yet"
              description="Form submissions will appear here once workers complete WHS forms in the field."
            />
          }
        />
      </div>

      {/* Detail drawer */}
      {drawerRow && (
        <SubmissionDrawer
          row={drawerRow}
          schema={drawerSchema}
          signons={drawerSignons}
          attachmentCount={drawerAttachmentCount}
          open={!!drawerRow}
          onClose={() => setDrawerRow(null)}
        />
      )}
    </>
  )
}
