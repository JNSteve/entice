import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole, getProfile } from '@/lib/auth'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtDate } from '@/lib/format'
import { FileTextIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  EditClientDialog,
  ArchiveClientButton,
  ContactDialog,
  DeleteContactButton,
  SiteDialog,
  DeleteSiteButton,
} from '../client-dialogs'
import { ComplianceLight } from '@/components/ComplianceLight'
import { derivePropertyStatus } from '@/lib/portal'
import { todayAU } from '@/lib/tz'
import { PortalLinks, type ClientLinkRow } from './portal-links'

const TYPE_LABELS: Record<string, string> = {
  builder: 'Builder',
  strata: 'Strata',
  council: 'Council',
  government: 'Government',
  facility_manager: 'Facility Manager',
  insurer: 'Insurer',
  private: 'Private',
  other: 'Other',
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')
  const profile = await getProfile()

  const { id } = await params
  const supabase = await createSupabaseClient()

  const [
    { data: client },
    { data: contacts },
    { data: sites },
    { data: quotes },
    { data: jobs },
    { data: projects },
    { data: invoices },
    { data: portalLinks },
  ] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).single(),
    supabase.from('contacts').select('*').eq('client_id', id).order('name'),
    supabase.from('sites').select('*').eq('client_id', id).order('name'),
    supabase.from('quotes').select('id, number, title, status, created_at').eq('client_id', id).eq('archived', false).order('created_at', { ascending: false }).limit(10),
    supabase.from('jobs').select('id, number, title, status, created_at, client_shared').eq('client_id', id).eq('archived', false).order('created_at', { ascending: false }).limit(10),
    supabase.from('projects').select('id, number, name, status, created_at, client_shared').eq('client_id', id).eq('archived', false).order('created_at', { ascending: false }).limit(10),
    supabase.from('invoices').select('id, number, status, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('client_links').select('id, token, label, created_at, expires_at, revoked_at, show_financials, notifications_enabled').eq('client_id', id).order('created_at', { ascending: false }),
  ])

  if (!client) notFound()

  const canEdit = profile?.role === 'admin' || profile?.role === 'office'

  // Per-site compliance lights (active items' review dates, 30-day rule) and
  // the portal access log — office's view of what the client portal shows.
  const siteIds = (sites ?? []).map((s) => s.id as string)
  const { data: complianceItems } =
    siteIds.length > 0
      ? await supabase
          .from('property_compliance_items')
          .select('site_id, review_due')
          .in('site_id', siteIds)
          .eq('status', 'active')
      : { data: [] as { site_id: string; review_due: string | null }[] }

  const today = todayAU()
  const duesBySite = new Map<string, (string | null)[]>()
  for (const item of complianceItems ?? []) {
    const list = duesBySite.get(item.site_id as string) ?? []
    list.push((item.review_due as string | null) ?? null)
    duesBySite.set(item.site_id as string, list)
  }

  // Access log is admin/office only (portal_views RLS) — skip the query for
  // supervisors so an empty result isn't mistaken for "no views".
  const linkIds = (portalLinks ?? []).map((l) => l.id as string)
  const { data: views, count: viewCount } =
    canEdit && linkIds.length > 0
      ? await supabase
          .from('portal_views')
          .select('id, client_link_id, site_id, path, viewed_at', { count: 'exact' })
          .in('client_link_id', linkIds)
          .order('viewed_at', { ascending: false })
          .limit(15)
      : { data: [], count: 0 }

  const linkLabelById = new Map(
    (portalLinks ?? []).map((l) => [l.id as string, (l.label as string | null) ?? '—'])
  )
  const siteNameById = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]))

  // Unread portal messages across this client's properties (admin/office —
  // portal_messages RLS excludes supervisors).
  const { count: unreadMessages } = canEdit
    ? await supabase
        .from('portal_messages')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', id)
        .eq('sender', 'client')
        .eq('read_by_office', false)
    : { count: 0 }

  // Portal feedback register-lite (admin/office — portal_feedback RLS).
  const { data: feedback } = canEdit
    ? await supabase
        .from('portal_feedback')
        .select('id, rating, comment, created_at, site_id, jobs(number, title), projects(number, name)')
        .eq('client_id', id)
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] }
  const feedbackRows = (feedback ?? []).map((f) => {
    const job = f.jobs as unknown as { number: string; title: string } | null
    const project = f.projects as unknown as { number: string; name: string } | null
    return {
      id: f.id as string,
      rating: Number(f.rating),
      comment: (f.comment as string | null) ?? null,
      created_at: f.created_at as string,
      siteName: f.site_id ? (siteNameById.get(f.site_id as string) ?? '—') : '—',
      work: job
        ? `${job.number} — ${job.title}`
        : project
          ? `${project.number} — ${project.name}`
          : '—',
    }
  })

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <PageHeader
        title={client.name}
        description={TYPE_LABELS[client.type] ?? client.type}
        actions={
          <div className="flex items-center gap-2">
            {client.archived && (
              <Badge variant="destructive">Archived</Badge>
            )}
            {canEdit && (
              <a
                href={`/api/pdf/compliance-report/${client.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <FileTextIcon className="size-4" />
                Compliance report
              </a>
            )}
            {canEdit && (
              <>
                <EditClientDialog
                  client={{
                    id: client.id,
                    name: client.name,
                    type: client.type,
                    abn: client.abn,
                    address: client.address,
                    payment_terms_days: client.payment_terms_days ?? 30,
                    notes: client.notes,
                  }}
                />
                <ArchiveClientButton clientId={client.id} archived={client.archived ?? false} />
              </>
            )}
          </div>
        }
      />

      {/* Client info card */}
      <section className="rounded-xl border bg-card p-4 md:p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd>
              <Badge variant="secondary" className="capitalize font-normal mt-0.5">
                {TYPE_LABELS[client.type] ?? client.type}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ABN</dt>
            <dd className="font-medium">{client.abn ?? '—'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="font-medium">{client.address ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Payment terms</dt>
            <dd className="font-medium">{client.payment_terms_days ?? 30} days</dd>
          </div>
          {client.notes && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{client.notes}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Contacts */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Contacts</h2>
          {canEdit && <ContactDialog clientId={client.id} />}
        </div>
        {contacts && contacts.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  {canEdit && <TableHead className="w-16" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.role ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.email ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.phone ?? '—'}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <ContactDialog clientId={client.id} contact={contact} />
                          <DeleteContactButton contactId={contact.id} clientId={client.id} />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No contacts yet.</p>
        )}
      </section>

      {/* Sites */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Sites</h2>
          {canEdit && <SiteDialog clientId={client.id} />}
        </div>
        {sites && sites.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Compliance</span>
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Suburb</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Postcode</TableHead>
                  {canEdit && <TableHead className="w-16" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell>
                      <ComplianceLight
                        status={derivePropertyStatus(duesBySite.get(site.id) ?? [], today)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/clients/${client.id}/sites/${site.id}`}
                        className="text-primary hover:underline"
                      >
                        {site.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{site.address ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{site.suburb ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{site.state ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{site.postcode ?? '—'}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <SiteDialog clientId={client.id} site={site} />
                          <DeleteSiteButton siteId={site.id} clientId={client.id} />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No sites yet.</p>
        )}
      </section>

      {/* Client portal: links + access log */}
      <PortalLinks
        clientId={client.id}
        clientName={client.name}
        links={(portalLinks ?? []) as ClientLinkRow[]}
        canManage={canEdit}
        unreadMessages={unreadMessages ?? 0}
      />
      {canEdit && (
        <section>
          <h2 className="mb-3 text-base font-semibold">
            Portal access log
            {typeof viewCount === 'number' && viewCount > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {viewCount} view{viewCount === 1 ? '' : 's'} recorded
              </span>
            )}
          </h2>
          {(views ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No portal activity yet. Every page view and file download through
              the client portal is recorded here.
            </p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Link</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Page / file</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(views ?? []).map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {new Date(v.viewed_at as string).toLocaleString('en-AU', {
                          timeZone: 'Australia/Brisbane',
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </TableCell>
                      <TableCell>{linkLabelById.get(v.client_link_id as string) ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.site_id ? (siteNameById.get(v.site_id as string) ?? '—') : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {v.path}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* Portal feedback (CP3 — satisfaction register-lite) */}
      {canEdit && feedbackRows.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">
            Portal feedback
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              avg{' '}
              {(
                feedbackRows.reduce((s, f) => s + f.rating, 0) / feedbackRows.length
              ).toFixed(1)}
              /5 across the latest {feedbackRows.length}
            </span>
          </h2>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Work</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Comment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedbackRows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {fmtDate(f.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-amber-500">{'★'.repeat(f.rating)}</span>
                      <span className="text-muted-foreground/40">
                        {'★'.repeat(5 - f.rating)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">{f.work}</TableCell>
                    <TableCell className="max-w-40 truncate text-muted-foreground">
                      {f.siteName}
                    </TableCell>
                    <TableCell className="max-w-80 truncate text-muted-foreground">
                      {f.comment ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Related: Quotes */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Quotes</h2>
        {quotes && quotes.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">
                      <Link href={`/quotes/${q.id}`} className="text-primary hover:underline">
                        {q.number}
                      </Link>
                    </TableCell>
                    <TableCell>{q.title ?? '—'}</TableCell>
                    <TableCell>{q.status ? <StatusBadge status={q.status} /> : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(q.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </section>

      {/* Related: Jobs */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Jobs</h2>
        {jobs && jobs.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-medium">
                      <Link href={`/jobs/${j.id}`} className="text-primary hover:underline">
                        {j.number}
                      </Link>
                    </TableCell>
                    <TableCell>{j.title ?? '—'}</TableCell>
                    <TableCell>{j.status ? <StatusBadge status={j.status} /> : '—'}</TableCell>
                    <TableCell>
                      {j.client_shared ? (
                        <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                          Shared
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not shared</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(j.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </section>

      {/* Related: Projects */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Projects</h2>
        {projects && projects.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      <Link href={`/projects/${p.id}`} className="text-primary hover:underline">
                        {p.number}
                      </Link>
                    </TableCell>
                    <TableCell>{p.name ?? '—'}</TableCell>
                    <TableCell>{p.status ? <StatusBadge status={p.status} /> : '—'}</TableCell>
                    <TableCell>
                      {p.client_shared ? (
                        <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                          Shared
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not shared</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(p.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </section>

      {/* Related: Invoices */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Invoices</h2>
        {invoices && invoices.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">
                        {inv.number}
                      </Link>
                    </TableCell>
                    <TableCell>{inv.status ? <StatusBadge status={inv.status} /> : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(inv.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </section>
    </div>
  )
}
