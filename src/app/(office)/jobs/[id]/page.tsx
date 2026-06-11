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
    </div>
  )
}
