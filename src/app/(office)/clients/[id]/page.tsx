import { notFound } from 'next/navigation'
import { requireRole, getProfile } from '@/lib/auth'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
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
  ] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).single(),
    supabase.from('contacts').select('*').eq('client_id', id).order('name'),
    supabase.from('sites').select('*').eq('client_id', id).order('name'),
    supabase.from('quotes').select('id, status, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('jobs').select('id, status, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('projects').select('id, status, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('invoices').select('id, status, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
  ])

  if (!client) notFound()

  const canEdit = profile?.role === 'admin' || profile?.role === 'office'

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <PageHeader
        title={client.name}
        description={TYPE_LABELS[client.type] ?? client.type}
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <EditClientDialog
                client={{
                  id: client.id,
                  name: client.name,
                  type: client.type,
                  abn: client.abn,
                  payment_terms_days: client.payment_terms_days ?? 30,
                  notes: client.notes,
                }}
              />
              <ArchiveClientButton clientId={client.id} />
            </div>
          ) : undefined
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
                    <TableCell className="font-medium">{site.name}</TableCell>
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

      {/* Related: Quotes */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Quotes</h2>
        {quotes && quotes.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-mono text-xs">{q.id.slice(0, 8)}</TableCell>
                    <TableCell>{q.status ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {q.created_at ? new Date(q.created_at).toLocaleDateString('en-AU') : '—'}
                    </TableCell>
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
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-xs">{j.id.slice(0, 8)}</TableCell>
                    <TableCell>{j.status ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {j.created_at ? new Date(j.created_at).toLocaleDateString('en-AU') : '—'}
                    </TableCell>
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
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}</TableCell>
                    <TableCell>{p.status ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('en-AU') : '—'}
                    </TableCell>
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
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.id.slice(0, 8)}</TableCell>
                    <TableCell>{inv.status ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-AU') : '—'}
                    </TableCell>
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
