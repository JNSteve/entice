import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole, getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { PageHeader } from '@/components/PageHeader'
import { AttachmentList } from '@/components/AttachmentList'
import { PhotoUpload } from '@/components/PhotoUpload'
import { StatusBadge } from '@/components/StatusBadge'
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
  EditVendorDialog,
  ArchiveVendorButton,
  ComplianceDocDialog,
  DeleteComplianceDocButton,
} from '../vendor-dialogs'
import { COMPLIANCE_DOC_KIND_LABELS, type ComplianceDocKind } from '@/lib/zod'
import { fmtDate, aud } from '@/lib/format'
import { expiryColour } from '@/lib/compliance'
import { todayAU } from '@/lib/tz'

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')
  const profile = await getProfile()

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: vendor },
    { data: complianceDocs },
    { data: purchaseOrders },
    { data: commitments },
    { data: rfqs },
  ] = await Promise.all([
    supabase.from('vendors').select('*').eq('id', id).single(),
    supabase
      .from('vendor_compliance_docs')
      .select('id, vendor_id, kind, reference, expiry_date')
      .eq('vendor_id', id)
      .order('expiry_date', { ascending: true }),
    supabase
      .from('purchase_orders')
      .select(
        'id, number, status, project_id, projects!purchase_orders_project_id_fkey(name)'
      )
      .eq('vendor_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('commitments')
      .select(
        'id, description, amount, status, package_id, packages!commitments_package_id_fkey(name)'
      )
      .eq('vendor_id', id)
      .order('date', { ascending: false })
      .limit(20),
    supabase
      .from('package_rfqs')
      .select(
        'id, status, invited_at, package_id, packages!package_rfqs_package_id_fkey(name)'
      )
      .eq('vendor_id', id)
      .order('invited_at', { ascending: false })
      .limit(20),
  ])

  if (!vendor) notFound()

  // PO totals — compute from po_lines
  const poIds = (purchaseOrders ?? []).map((po) => po.id)
  const { data: poLines } =
    poIds.length > 0
      ? await supabase
          .from('po_lines')
          .select('po_id, qty, unit_cost')
          .in('po_id', poIds)
      : { data: [] }

  const poTotalMap = new Map<string, number>()
  for (const line of poLines ?? []) {
    const current = poTotalMap.get(line.po_id) ?? 0
    poTotalMap.set(
      line.po_id,
      current + Number(line.qty) * Number(line.unit_cost)
    )
  }

  // Attachments for this vendor
  const attachments = await fetchAttachmentsWithUrls(supabase, 'vendor', id)

  const canEdit =
    profile?.role === 'admin' || profile?.role === 'office'

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <PageHeader
        title={vendor.name}
        description={
          vendor.trades && vendor.trades.length > 0
            ? vendor.trades.join(', ')
            : 'Supplier'
        }
        actions={
          <div className="flex items-center gap-2">
            {vendor.archived && (
              <Badge variant="destructive">Archived</Badge>
            )}
            {canEdit && (
              <>
                <EditVendorDialog
                  vendor={{
                    id: vendor.id,
                    name: vendor.name,
                    abn: vendor.abn,
                    trades: vendor.trades ?? [],
                    contact_name: vendor.contact_name,
                    email: vendor.email,
                    phone: vendor.phone,
                    payment_terms_days: vendor.payment_terms_days ?? 30,
                    notes: vendor.notes,
                  }}
                />
                <ArchiveVendorButton
                  vendorId={vendor.id}
                  archived={vendor.archived ?? false}
                />
              </>
            )}
          </div>
        }
      />

      {/* Details card */}
      <section className="rounded-xl border bg-card p-4 md:p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 text-sm">
          <div>
            <dt className="text-muted-foreground">ABN</dt>
            <dd className="font-medium">{vendor.abn ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Contact</dt>
            <dd className="font-medium">{vendor.contact_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium break-all">{vendor.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Phone</dt>
            <dd className="font-medium">{vendor.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Payment terms</dt>
            <dd className="font-medium">
              {vendor.payment_terms_days ?? 30} days
            </dd>
          </div>
          {vendor.trades && vendor.trades.length > 0 && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-muted-foreground">Trades</dt>
              <dd className="flex flex-wrap gap-1 mt-1">
                {vendor.trades.map((t: string) => (
                  <Badge key={t} variant="secondary" className="font-normal">
                    {t}
                  </Badge>
                ))}
              </dd>
            </div>
          )}
          {vendor.notes && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{vendor.notes}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Compliance documents */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Compliance documents</h2>
          {canEdit && <ComplianceDocDialog vendorId={vendor.id} />}
        </div>
        {complianceDocs && complianceDocs.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Expiry</TableHead>
                  {canEdit && <TableHead className="w-16" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {complianceDocs.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">
                      {COMPLIANCE_DOC_KIND_LABELS[
                        doc.kind as ComplianceDocKind
                      ] ?? doc.kind}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {doc.reference ?? '—'}
                    </TableCell>
                    <TableCell className={expiryColour(doc.expiry_date, todayAU())}>
                      {fmtDate(doc.expiry_date)}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <ComplianceDocDialog
                            vendorId={vendor.id}
                            doc={{
                              id: doc.id,
                              vendor_id: doc.vendor_id,
                              kind: doc.kind as ComplianceDocKind,
                              reference: doc.reference ?? null,
                              expiry_date: doc.expiry_date,
                            }}
                          />
                          <DeleteComplianceDocButton
                            docId={doc.id}
                            vendorId={vendor.id}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No compliance documents recorded.
          </p>
        )}
      </section>

      {/* Attachments */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Attachments</h2>
          {canEdit && (
            <PhotoUpload
              parentType="vendor"
              parentId={vendor.id}
              kind="document"
              multiple
            />
          )}
        </div>
        {attachments.length > 0 ? (
          <AttachmentList items={attachments} canDelete={canEdit} />
        ) : (
          <p className="text-sm text-muted-foreground">No attachments yet.</p>
        )}
      </section>

      {/* Purchase orders */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Purchase orders</h2>
        {purchaseOrders && purchaseOrders.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.map((po) => {
                  const projectRel = po.projects as unknown as
                    | { name: string }
                    | null
                  const total = poTotalMap.get(po.id) ?? 0
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">
                        {po.project_id ? (
                          <Link
                            href={`/projects/${po.project_id}/pos/${po.id}`}
                            className="underline underline-offset-2"
                          >
                            {po.number}
                          </Link>
                        ) : (
                          po.number
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {projectRel?.name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={po.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {aud(total)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No purchase orders.</p>
        )}
      </section>

      {/* Commitments */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Commitments</h2>
        {commitments && commitments.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commitments.map((c) => {
                  const pkgRel = c.packages as unknown as
                    | { name: string }
                    | null
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.description}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {pkgRel?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {aud(Number(c.amount))}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No commitments.</p>
        )}
      </section>

      {/* RFQ history */}
      <section>
        <h2 className="mb-3 text-base font-semibold">RFQ history</h2>
        {rfqs && rfqs.length > 0 ? (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invited</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfqs.map((r) => {
                  const pkgRel = r.packages as unknown as
                    | { name: string }
                    | null
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {pkgRel?.name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {fmtDate(r.invited_at)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            RFQ activity appears here once procurement is in use.
          </p>
        )}
      </section>
    </div>
  )
}
