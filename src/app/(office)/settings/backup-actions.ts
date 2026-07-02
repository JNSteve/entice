'use server'

import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Admin "Export all data" (ISO 7.5.3 pragmatic v1).
 *
 * Reads every business table under the ADMIN'S OWN RLS session (no service
 * role exists in this project) and returns one JSON document the client
 * downloads as entice-backup-YYYYMMDD.json. Reads are chunked at 1000 rows a
 * page so large tables never hit PostgREST row limits.
 *
 * swms_signatures / form_signons exclude the base64 signature_data blobs
 * (they would dwarf the rest of the file) — the header notes how many rows
 * carry a blob so the omission is visible. Signature PNG files referenced by
 * signature_path live in storage and are covered by Supabase's own backups.
 */

const PAGE_SIZE = 1000

// Ordered roughly parent-before-child so a manual restore can replay in order.
// `columns` overrides `*` where blob columns must stay out of the export.
const EXPORT_TABLES: { table: string; columns?: string }[] = [
  // Master / reference data
  { table: 'settings' },
  { table: 'profiles' },
  { table: 'cost_codes' },
  { table: 'rate_items' },
  { table: 'plant' },
  { table: 'checklist_templates' },
  // CRM
  { table: 'clients' },
  { table: 'contacts' },
  { table: 'sites' },
  // Quotes
  { table: 'quotes' },
  { table: 'quote_sections' },
  { table: 'quote_lines' },
  // Jobs
  { table: 'jobs' },
  { table: 'job_checklist_items' },
  { table: 'work_logs' },
  // Projects
  { table: 'projects' },
  { table: 'budget_lines' },
  { table: 'costs' },
  // Procurement
  { table: 'vendors' },
  { table: 'vendor_compliance_docs' },
  { table: 'packages' },
  { table: 'package_rfqs' },
  { table: 'package_quotes' },
  { table: 'commitments' },
  { table: 'purchase_orders' },
  { table: 'po_lines' },
  // Money
  { table: 'variations' },
  { table: 'claims' },
  { table: 'claim_lines' },
  { table: 'retention_entries' },
  { table: 'invoices' },
  { table: 'invoice_lines' },
  { table: 'payments' },
  // Field operations
  { table: 'assignments' },
  { table: 'timesheet_entries' },
  { table: 'diaries' },
  { table: 'diary_labour' },
  { table: 'diary_plant' },
  // WHS & quality
  { table: 'swms_templates' },
  { table: 'swms_instances' },
  {
    table: 'swms_signatures',
    columns:
      'id,swms_instance_id,user_id,name,company,external,signature_path,version,signed_at',
  },
  { table: 'subbie_swms' },
  { table: 'form_templates' },
  { table: 'form_submissions' },
  {
    table: 'form_signons',
    columns:
      'id,submission_id,profile_id,name,company,signature_path,signed_at,created_at',
  },
  { table: 'incidents' },
  { table: 'corrective_actions' },
  { table: 'ncrs' },
  { table: 'capa_actions' },
  { table: 'hold_points' },
  // Controlled documents
  { table: 'documents' },
  { table: 'document_acknowledgements' },
  // Programme
  { table: 'programme_tasks' },
  { table: 'programme_links' },
  // Cross-cutting
  { table: 'attachments' },
  { table: 'share_links' },
  { table: 'audit_log' },
]

export async function exportAllData(): Promise<{
  error?: string
  json?: string
}> {
  await requireRole('admin')

  const supabase = await createClient()

  const tables: Record<string, unknown[]> = {}
  const rowCounts: Record<string, number> = {}

  for (const { table, columns } of EXPORT_TABLES) {
    const rows: unknown[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns ?? '*')
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) return { error: `Export failed at ${table}: ${error.message}` }

      rows.push(...(data ?? []))
      if (!data || data.length < PAGE_SIZE) break
    }
    tables[table] = rows
    rowCounts[table] = rows.length
  }

  // Signature blobs are excluded above — record how many rows carry one so
  // the export is honest about what it does not contain.
  const signatureBlobCounts: Record<string, number> = {}
  for (const table of ['swms_signatures', 'form_signons']) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .not('signature_data', 'is', null)
    if (error) return { error: `Export failed at ${table}: ${error.message}` }
    signatureBlobCounts[table] = count ?? 0
  }

  const payload = {
    app: 'entice',
    format_version: 1,
    exported_at: new Date().toISOString(),
    note:
      'Row-level export under the exporting admin’s RLS session. ' +
      'signature_data blobs are excluded from swms_signatures/form_signons ' +
      '(counts below); storage files (attachments bucket) are not included.',
    row_counts: rowCounts,
    signature_data_blobs_excluded: signatureBlobCounts,
    tables,
  }

  return { json: JSON.stringify(payload, null, 1) }
}
