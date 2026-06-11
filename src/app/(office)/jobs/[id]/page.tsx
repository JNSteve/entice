import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtDate } from '@/lib/format'
import { StatusActions } from './job-actions'
import { EditJobDialog } from './edit-job-dialog'
import { ChecklistSection } from './checklist-section'
import { WorkLogSection } from './work-log-section'
import { CostsSection } from './costs-section'
import { InvoiceSection, type JobInvoiceRow } from './invoice-section'
import { docTotals } from '@/lib/money'
import { PhotoUpload } from '@/components/PhotoUpload'
import { AttachmentList } from '@/components/AttachmentList'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { fetchSwmsInstances } from '@/lib/swms-queries'
import { SwmsInstancesSection } from '@/components/SwmsInstancesSection'
import { DocketTable, type DocketRow, type CostCodeOption } from '@/components/DocketTable'

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: job },
    { data: checklistItems },
    { data: workLogs },
    { data: costs },
    { data: sites },
    { data: supervisors },
    { data: templates },
    { data: costCodes },
    attachments,
    swmsInstances,
    { data: swmsTemplates },
  ] = await Promise.all([
    supabase
      .from('jobs')
      .select(
        `*,
         clients(id, name),
         sites(id, name),
         profiles!jobs_supervisor_id_fkey(id, full_name),
         quotes(id, number, status)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('job_checklist_items')
      .select('id, text, done, done_at, position, done_by, profiles!job_checklist_items_done_by_fkey(full_name)')
      .eq('job_id', id)
      .order('position'),
    supabase
      .from('work_logs')
      .select('id, date, notes, created_by, profiles!work_logs_created_by_fkey(full_name)')
      .eq('job_id', id)
      .order('date', { ascending: false }),
    supabase
      .from('costs')
      .select('id, date, description, amount, cost_code_id, cost_codes(code, name)')
      .eq('parent_type', 'job')
      .eq('parent_id', id)
      .order('date', { ascending: false }),
    supabase.from('sites').select('id, client_id, name').order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .in('role', ['admin', 'office', 'supervisor'])
      .eq('active', true)
      .order('full_name'),
    supabase.from('checklist_templates').select('id, title').order('title'),
    supabase
      .from('cost_codes')
      .select('id, code, name')
      .eq('active', true)
      .order('code'),
    fetchAttachmentsWithUrls(supabase, 'job', id),
    fetchSwmsInstances(supabase, 'job', id),
    supabase
      .from('swms_templates')
      .select('id, title, version')
      .eq('active', true)
      .order('title'),
  ])

  if (!job) notFound()

  const clientRel = job.clients as unknown as { id: string; name: string } | null
  const siteRel = job.sites as unknown as { id: string; name: string } | null
  const supervisorRel = job.profiles as unknown as { id: string; full_name: string } | null
  const quoteRel = job.quotes as unknown as { id: string; number: string; status: string } | null

  const checklistData = (checklistItems ?? []).map((item) => {
    const doneByProfile = item.profiles as unknown as { full_name: string } | null
    return {
      id: item.id,
      text: item.text,
      done: item.done,
      done_at: item.done_at ?? null,
      done_by_name: doneByProfile?.full_name ?? null,
      position: item.position,
    }
  })

  const workLogData = (workLogs ?? []).map((entry) => {
    const createdByProfile = entry.profiles as unknown as { full_name: string } | null
    return {
      id: entry.id,
      date: entry.date,
      notes: entry.notes,
      created_by_name: createdByProfile?.full_name ?? null,
    }
  })

  const costsData = (costs ?? []).map((c) => {
    const codeRel = c.cost_codes as unknown as { code: string; name: string } | null
    return {
      id: c.id,
      date: c.date,
      description: c.description,
      amount: Number(c.amount),
      cost_code_label: codeRel ? `${codeRel.code} – ${codeRel.name}` : null,
    }
  })

  const canMutate = profile.role === 'admin' || profile.role === 'office' || profile.role === 'supervisor'
  const canSeeCosts = profile.role === 'admin' || profile.role === 'office'
  const canDeleteAttachment = profile.role === 'admin' || profile.role === 'office'

  // Invoices — admin/office only (money data).
  let invoiceRows: JobInvoiceRow[] = []
  let hasQuoteBasis = false
  if (canSeeCosts) {
    const [{ data: invoices }, { count: quoteLineCount }] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, number, status, gst_rate, issue_date, paid_at, invoice_lines(qty, unit_sell)')
        .eq('job_id', id)
        .order('created_at'),
      job.quote_id
        ? supabase
            .from('quote_lines')
            .select('id', { count: 'exact', head: true })
            .eq('quote_id', job.quote_id)
        : Promise.resolve({ count: 0 }),
    ])

    invoiceRows = (invoices ?? []).map((inv) => {
      const { total } = docTotals(
        ((inv.invoice_lines ?? []) as { qty: number; unit_sell: number }[]).map((l) => ({
          qty: Number(l.qty),
          unitSell: Number(l.unit_sell),
        })),
        Number(inv.gst_rate)
      )
      return {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        total,
        issue_date: inv.issue_date,
        paid_at: inv.paid_at,
      }
    })

    hasQuoteBasis = quoteRel?.status === 'accepted' && (quoteLineCount ?? 0) > 0
  }

  const photoItems = attachments.filter((a) => a.kind === 'photo')
  const docketItems = attachments.filter((a) => a.kind === 'docket')
  const docItems = attachments.filter((a) => a.kind !== 'photo' && a.kind !== 'docket')

  const dateRange = job.scheduled_start
    ? `${fmtDate(job.scheduled_start)}${job.scheduled_end ? ` – ${fmtDate(job.scheduled_end)}` : ''}`
    : null

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <PageHeader
          title={`${job.number} — ${job.title}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canMutate && (
                <EditJobDialog
                  jobId={job.id}
                  clientId={job.client_id}
                  title={job.title}
                  description={job.description ?? null}
                  siteId={job.site_id ?? null}
                  supervisorId={job.supervisor_id ?? null}
                  scheduledStart={job.scheduled_start ?? null}
                  scheduledEnd={job.scheduled_end ?? null}
                  sites={(sites ?? []).map((s) => ({ id: s.id, name: s.name, client_id: s.client_id }))}
                  supervisors={supervisors ?? []}
                />
              )}
            </div>
          }
        />

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={job.status} />
          {clientRel && (
            <Link href={`/clients/${clientRel.id}`} className="text-muted-foreground hover:text-foreground underline underline-offset-2">
              {clientRel.name}
            </Link>
          )}
          {siteRel && (
            <span className="text-muted-foreground">{siteRel.name}</span>
          )}
          {supervisorRel && (
            <span className="text-muted-foreground">{supervisorRel.full_name}</span>
          )}
          {dateRange && (
            <span className="text-muted-foreground tabular-nums">{dateRange}</span>
          )}
          {quoteRel && (
            <Link
              href={`/quotes/${quoteRel.id}`}
              className="font-mono text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {quoteRel.number}
            </Link>
          )}
        </div>

        {/* Status stepper actions */}
        {canMutate && (
          <StatusActions
            jobId={job.id}
            status={job.status}
            scheduledStart={job.scheduled_start ?? null}
          />
        )}

        {/* Description */}
        {job.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap max-w-2xl">
            {job.description}
          </p>
        )}
      </div>

      <div className="border-t" />

      {/* Checklist */}
      <ChecklistSection
        jobId={job.id}
        items={checklistData}
        templates={(templates ?? []).map((t) => ({ id: t.id, title: t.title }))}
      />

      <div className="border-t" />

      {/* Work log */}
      <WorkLogSection jobId={job.id} entries={workLogData} />

      {/* SWMS */}
      <div className="border-t" />
      <SwmsInstancesSection
        parentType="job"
        parentId={job.id}
        instances={swmsInstances}
        templates={swmsTemplates ?? []}
        canManage={canMutate}
        canSupersede={canSeeCosts}
      />

      {/* Costs — admin/office only */}
      {canSeeCosts && (
        <>
          <div className="border-t" />
          <CostsSection
            jobId={job.id}
            costs={costsData}
            costCodes={(costCodes ?? []).map((cc) => ({
              id: cc.id,
              code: cc.code,
              name: cc.name,
            }))}
          />
        </>
      )}

      {/* Invoices — admin/office only */}
      {canSeeCosts && (
        <>
          <div className="border-t" />
          <InvoiceSection
            jobId={job.id}
            jobStatus={job.status}
            hasQuoteBasis={hasQuoteBasis}
            invoices={invoiceRows}
          />
        </>
      )}

      {/* Photos */}
      <div className="border-t" />
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Photos</h2>
        <PhotoUpload
          parentType="job"
          parentId={job.id}
          kind="photo"
          capture
          multiple
        />
        <AttachmentList
          items={photoItems}
          canDelete={canDeleteAttachment}
        />
      </section>

      {/* Dockets */}
      <div className="border-t" />
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Dockets</h2>
        <DocketTable
          rows={docketItems.map((a) => ({
            id: a.id,
            filename: a.filename,
            caption: a.caption,
            signedUrl: a.signedUrl,
            created_at: a.created_at,
            created_by_name: a.created_by_name,
            meta: a.meta as DocketRow['meta'],
          }))}
          parentType="job"
          parentId={job.id}
          costCodes={(costCodes ?? []).map<CostCodeOption>((cc) => ({
            id: cc.id,
            code: cc.code,
            name: cc.name,
          }))}
          canCreateCost={canSeeCosts}
        />
      </section>

      {/* Documents */}
      <div className="border-t" />
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Documents</h2>
        <PhotoUpload
          parentType="job"
          parentId={job.id}
          kind="document"
          multiple
        />
        <AttachmentList
          items={docItems}
          canDelete={canDeleteAttachment}
        />
      </section>
    </div>
  )
}
