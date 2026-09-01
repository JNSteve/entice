/**
 * Canonical attachment parent types and the table each one lives in.
 *
 * Lives in its own module because `attachments.ts` is a `'use server'` file and
 * may therefore only export async functions — while both it and the agent API's
 * chunked-upload filing step need this list. Duplicating it would drift: the set
 * has already grown in migrations 0032 (lot), 0051 (maintenance) and 0054
 * (regulated_waste_movement, env_facility).
 *
 * NOTE: adding a value here ALWAYS needs the matching `attachments_parent_type_check`
 * widened in a migration too — that mismatch is what broke every maintenance
 * photo upload until 0052 fixed it.
 */

export const PARENT_TYPES = [
  'job',
  'project',
  'quote',
  'invoice',
  'claim',
  'po',
  'vendor',
  'diary',
  'variation',
  'package',
  'incident',
  'form_submission',
  'ncr',
  'waste_load',
  'lot',
  'maintenance',
  'regulated_waste_movement',
  'env_facility',
] as const

export type AttachmentParentType = (typeof PARENT_TYPES)[number]

export const ATTACHMENT_KINDS = ['photo', 'docket', 'document', 'pdf'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/**
 * Table each parent_type lives in — used to verify the claimed parent exists
 * before recording an attachment against it.
 */
export const PARENT_TABLE: Record<AttachmentParentType, string> = {
  job: 'jobs',
  project: 'projects',
  quote: 'quotes',
  invoice: 'invoices',
  claim: 'claims',
  po: 'purchase_orders',
  vendor: 'vendors',
  diary: 'diaries',
  variation: 'variations',
  package: 'packages',
  incident: 'incidents',
  form_submission: 'form_submissions',
  ncr: 'ncrs',
  waste_load: 'waste_loads',
  lot: 'lots',
  maintenance: 'maintenance_entries',
  // Docket photos on the statutory movement record, and the signed
  // waste-tracking agent agreement on a receiving facility (migration 0054).
  regulated_waste_movement: 'regulated_waste_movements',
  env_facility: 'env_facilities',
}
