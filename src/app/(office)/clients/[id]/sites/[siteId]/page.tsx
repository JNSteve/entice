import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { buttonVariants } from '@/components/ui/button'
import { QrCodeIcon } from 'lucide-react'
import { fmtDate } from '@/lib/format'
import { fetchAttachmentsForParents } from '@/lib/attachment-queries'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ComplianceItems,
  type DocumentOption,
  type PropertyItemRow,
} from './compliance-items'
import { OfficeThread, type OfficeMessageRow } from './office-thread'
import { PendingUploads, type PendingUploadRow } from './pending-uploads'
import {
  MaintenanceSection,
  type MaintenanceEntryRow,
} from './maintenance-section'

/**
 * Office view of one property (site): its compliance register (the portal's
 * Compliance tab source of truth) plus the works on it. Admin/office manage;
 * supervisors read-only; field has no route here (clients module is a/o/s).
 */
export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string; siteId: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const { id: clientId, siteId } = await params

  const supabase = await createSupabaseClient()

  const [
    { data: client },
    { data: site },
    { data: items },
    { data: docs },
    { data: jobs },
    { data: projects },
    { data: maintenanceRows },
  ] = await Promise.all([
    supabase.from('clients').select('id, name').eq('id', clientId).single(),
    supabase
      .from('sites')
      .select('*')
      .eq('id', siteId)
      .eq('client_id', clientId)
      .single(),
    supabase
      .from('property_compliance_items')
      .select(
        'id, kind, title, issue_date, review_due, notes, evidence_path, evidence_filename, document_id, status, created_at, documents(doc_number, title)'
      )
      .eq('site_id', siteId)
      .order('status', { ascending: true }) // active before superseded
      .order('created_at', { ascending: false }),
    supabase
      .from('documents')
      .select('id, doc_number, title')
      .eq('status', 'issued')
      .not('file_path', 'is', null)
      .order('title'),
    supabase
      .from('jobs')
      .select('id, number, title, status, created_at')
      .eq('site_id', siteId)
      .eq('archived', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, number, name, status, created_at')
      .eq('site_id', siteId)
      .eq('archived', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('maintenance_entries')
      .select('*, jobs(number), projects(number)')
      .eq('site_id', siteId)
      .order('done_at', { ascending: false })
      .order('created_at', { ascending: false }),
  ])

  if (!client || !site) notFound()

  const canEdit = profile.role === 'admin' || profile.role === 'office'

  // Portal correspondence thread (admin/office only — supervisors have no
  // portal_messages SELECT, so skip the query rather than render an empty
  // state that reads as "no messages").
  let threadMessages: OfficeMessageRow[] = []
  let unreadCount = 0
  if (canEdit) {
    const { data: messages } = await supabase
      .from('portal_messages')
      .select(
        'id, sender, sender_name, body, created_at, read_by_office, profiles(full_name)'
      )
      .eq('client_id', clientId)
      .eq('site_id', siteId)
      .order('created_at', { ascending: true })
    threadMessages = (messages ?? []).map((m) => {
      const office = m.profiles as unknown as { full_name: string } | null
      const unread = m.sender === 'client' && !m.read_by_office
      return {
        id: m.id as string,
        sender: m.sender as 'client' | 'office',
        sender_name:
          m.sender === 'office'
            ? (office?.full_name ?? 'Office')
            : ((m.sender_name as string | null) ?? 'Client'),
        body: m.body as string,
        created_display: new Date(m.created_at as string).toLocaleString('en-AU', {
          timeZone: 'Australia/Brisbane',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
        unread,
      }
    })
    unreadCount = threadMessages.filter((m) => m.unread).length
  }

  // Client-filed documents awaiting review (admin/office only — the table's
  // RLS is staff-only anyway).
  let pendingUploads: PendingUploadRow[] = []
  if (canEdit) {
    const { data: uploads } = await supabase
      .from('portal_uploads')
      .select('id, kind, title, issue_date, review_due, notes, path, filename, created_at')
      .eq('site_id', siteId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    const uploadPaths = (uploads ?? []).map((u) => u.path as string)
    const uploadUrlMap = new Map<string, string>()
    if (uploadPaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from('attachments')
        .createSignedUrls(uploadPaths, 3600)
      for (const entry of signed ?? []) {
        if (entry.signedUrl && entry.path) uploadUrlMap.set(entry.path, entry.signedUrl)
      }
    }
    pendingUploads = (uploads ?? []).map((u) => ({
      id: u.id as string,
      kind: u.kind as string,
      title: u.title as string,
      issue_date: u.issue_date as string,
      review_due: (u.review_due as string | null) ?? null,
      notes: (u.notes as string | null) ?? null,
      filename: u.filename as string,
      signedUrl: uploadUrlMap.get(u.path as string) ?? null,
      created_at: u.created_at as string,
    }))
  }

  // Batch-sign evidence paths (office-side 1h links; the portal uses its own
  // logged short-lived route instead).
  const paths = (items ?? [])
    .map((i) => i.evidence_path as string | null)
    .filter((p): p is string => Boolean(p))
  const urlMap = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(paths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlMap.set(entry.path, entry.signedUrl)
    }
  }

  const itemRows: PropertyItemRow[] = (items ?? []).map((i) => {
    const doc = i.documents as unknown as { doc_number: string | null; title: string } | null
    return {
      id: i.id as string,
      kind: i.kind as PropertyItemRow['kind'],
      title: i.title as string,
      issue_date: i.issue_date as string,
      review_due: (i.review_due as string | null) ?? null,
      notes: (i.notes as string | null) ?? null,
      evidence_path: (i.evidence_path as string | null) ?? null,
      evidence_filename: (i.evidence_filename as string | null) ?? null,
      evidenceUrl: i.evidence_path ? (urlMap.get(i.evidence_path as string) ?? null) : null,
      document_id: (i.document_id as string | null) ?? null,
      document_label: doc ? [doc.doc_number, doc.title].filter(Boolean).join(' — ') : null,
      status: i.status as PropertyItemRow['status'],
    }
  })

  const documentOptions: DocumentOption[] = (docs ?? []).map((d) => ({
    id: d.id as string,
    label: [d.doc_number as string | null, d.title as string].filter(Boolean).join(' — '),
  }))

  // Maintenance log — entries newest-first + their evidence (batched signing).
  const maintenanceEntryIds = (maintenanceRows ?? []).map((m) => m.id as string)
  const maintenanceEvidence = await fetchAttachmentsForParents(
    supabase,
    'maintenance',
    maintenanceEntryIds
  )

  const maintenanceEntries: MaintenanceEntryRow[] = (maintenanceRows ?? []).map((m) => {
    const jobRel = m.jobs as unknown as { number: string } | null
    const projectRel = m.projects as unknown as { number: string } | null
    return {
      id: m.id as string,
      kind: m.kind as MaintenanceEntryRow['kind'],
      title: m.title as string,
      description: (m.description as string | null) ?? null,
      done_at: m.done_at as string,
      status: m.status as MaintenanceEntryRow['status'],
      follow_up: (m.follow_up as string | null) ?? null,
      flagged: Boolean(m.flagged),
      flag_note: (m.flag_note as string | null) ?? null,
      client_visible: Boolean(m.client_visible),
      job_id: (m.job_id as string | null) ?? null,
      project_id: (m.project_id as string | null) ?? null,
      job_number: jobRel?.number ?? null,
      project_number: projectRel?.number ?? null,
      evidence: (maintenanceEvidence[m.id as string] ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.content_type,
        kind: a.kind,
        signedUrl: a.signedUrl,
      })),
    }
  })

  const maintenanceJobOptions = (jobs ?? []).map((j) => ({
    id: j.id as string,
    number: j.number as string,
    label: j.title as string,
  }))
  const maintenanceProjectOptions = (projects ?? []).map((p) => ({
    id: p.id as string,
    number: p.number as string,
    label: p.name as string,
  }))

  const address = [site.address, site.suburb, site.state, site.postcode]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link
          href={`/clients/${client.id}`}
          className="text-sm text-muted-foreground hover:text-primary hover:underline"
        >
          ← {client.name}
        </Link>
        <PageHeader
          title={site.name}
          description={address || 'Property compliance register'}
          actions={
            canEdit ? (
              <a
                href={`/api/pdf/portal-register/${siteId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <QrCodeIcon className="size-4" />
                Register QR poster
              </a>
            ) : undefined
          }
        />
      </div>

      {canEdit && <PendingUploads clientId={clientId} uploads={pendingUploads} />}

      <ComplianceItems
        clientId={clientId}
        siteId={siteId}
        items={itemRows}
        documents={documentOptions}
        canEdit={canEdit}
        canDelete={profile.role === 'admin'}
      />

      {/* Maintenance log — make-safes/repairs/inspections with photo evidence */}
      <MaintenanceSection
        siteId={siteId}
        entries={maintenanceEntries}
        jobs={maintenanceJobOptions}
        projects={maintenanceProjectOptions}
        canEdit={canEdit}
      />

      {/* Portal correspondence — the client side lives on their Messages tab */}
      {canEdit && (
        <OfficeThread
          clientId={clientId}
          siteId={siteId}
          clientName={client.name}
          messages={threadMessages}
          unreadCount={unreadCount}
          canReply={canEdit}
        />
      )}

      {/* Works on this property — what the portal's Works tab draws from */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Works on this property</h2>
        {(jobs ?? []).length === 0 && (projects ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs or projects on this site.</p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(projects ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <Link href={`/projects/${p.id}`} className="text-primary hover:underline">
                        {p.number}
                      </Link>
                    </TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">Project</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(p.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
                {(jobs ?? []).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-medium">
                      <Link href={`/jobs/${j.id}`} className="text-primary hover:underline">
                        {j.number}
                      </Link>
                    </TableCell>
                    <TableCell>{j.title}</TableCell>
                    <TableCell className="text-muted-foreground">Job</TableCell>
                    <TableCell>
                      <StatusBadge status={j.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(j.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
