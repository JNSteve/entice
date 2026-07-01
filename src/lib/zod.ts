import { z } from 'zod'

export const CLIENT_TYPES = [
  'builder',
  'strata',
  'council',
  'government',
  'facility_manager',
  'insurer',
  'private',
  'other',
] as const

export type ClientType = (typeof CLIENT_TYPES)[number]

export const clientSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(CLIENT_TYPES),
  abn: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim()))
    .refine(
      (v) => v === undefined || /^\d{11}$/.test(v.replace(/\s/g, '')),
      'ABN must be 11 digits'
    ),
  payment_terms_days: z.coerce
    .number()
    .int()
    .min(0)
    .max(120)
    .default(30),
  notes: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
})

export type ClientInput = z.infer<typeof clientSchema>

export const contactSchema = z.object({
  id: z.string().uuid().optional(),
  client_id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  role: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
  email: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim()))
    .refine(
      (v) => v === undefined || z.string().email().safeParse(v).success,
      'Invalid email address'
    ),
  phone: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
})

export type ContactInput = z.infer<typeof contactSchema>

export const siteSchema = z.object({
  id: z.string().uuid().optional(),
  client_id: z.string().uuid(),
  name: z.string().min(1, 'Site name is required'),
  address: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
  suburb: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
  state: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
  postcode: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
  notes: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === '' ? undefined : v?.trim())),
})

export type SiteInput = z.infer<typeof siteSchema>

// ─── Settings ────────────────────────────────────────────────────────────────

/** Trims a string; empty/missing becomes null (clears the column on update). */
const optionalText = z
  .string()
  .nullish()
  .transform((v) => {
    const t = v?.trim()
    return t ? t : null
  })

export const settingsSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  abn: optionalText.refine(
    (v) => v === null || /^\d{11}$/.test(v.replace(/\s/g, '')),
    'ABN must be 11 digits'
  ),
  address: optionalText,
  phone: optionalText,
  email: optionalText.refine(
    (v) => v === null || z.email().safeParse(v).success,
    'Invalid email address'
  ),
  gst_rate: z.coerce.number().min(0).max(100),
  invoice_footer: optionalText,
  claim_footer: optionalText,
  logo_path: optionalText.optional(),
})

export type SettingsInput = z.infer<typeof settingsSchema>

// ─── Users / profiles ────────────────────────────────────────────────────────

export const USER_ROLES = ['admin', 'office', 'supervisor', 'field'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const userCreateSchema = z.object({
  full_name: z.string().min(1, 'Name is required'),
  email: z.email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(USER_ROLES),
})

export type UserCreateInput = z.infer<typeof userCreateSchema>

export const profileUpdateSchema = z.object({
  full_name: z.string().min(1, 'Name is required').optional(),
  phone: optionalText.optional(),
  role: z.enum(USER_ROLES).optional(),
  hourly_cost: z.number().min(0).nullable().optional(),
  active: z.boolean().optional(),
})

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>

// ─── Rate items ──────────────────────────────────────────────────────────────

export const RATE_KINDS = [
  'labour',
  'plant',
  'material',
  'subbie',
  'other',
] as const
export type RateKind = (typeof RATE_KINDS)[number]

export const rateItemSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(RATE_KINDS),
  name: z.string().min(1, 'Name is required'),
  unit: z.string().min(1, 'Unit is required'),
  cost: z.coerce.number().min(0),
  default_markup_pct: z.coerce.number().min(0).max(1000),
  active: z.boolean().default(true),
})

export type RateItemInput = z.infer<typeof rateItemSchema>

// ─── Cost codes ──────────────────────────────────────────────────────────────

export const COST_CODE_CATEGORIES = [
  'labour',
  'plant',
  'materials',
  'subcontract',
  'other',
] as const
export type CostCodeCategory = (typeof COST_CODE_CATEGORIES)[number]

export const costCodeSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1, 'Code is required').transform((v) => v.trim()),
  name: z.string().min(1, 'Name is required'),
  category: z.enum(COST_CODE_CATEGORIES),
  active: z.boolean().default(true),
})

export type CostCodeInput = z.infer<typeof costCodeSchema>

// ─── Plant ───────────────────────────────────────────────────────────────────

export const PLANT_OWNERSHIP = ['owned', 'hired'] as const
export type PlantOwnership = (typeof PLANT_OWNERSHIP)[number]

export const plantSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Name is required'),
  type: optionalText,
  rego: optionalText,
  ownership: z.enum(PLANT_OWNERSHIP),
  hourly_rate: z.number().min(0).nullable(),
  active: z.boolean().default(true),
})

export type PlantInput = z.infer<typeof plantSchema>

// ─── Quotes ──────────────────────────────────────────────────────────────────

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'lost'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const quoteCreateSchema = z.object({
  client_id: z.uuid('Pick a client'),
  site_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  contact_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  title: z.string().min(1, 'Title is required'),
})

export type QuoteCreateInput = z.infer<typeof quoteCreateSchema>

export const quoteHeaderSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: optionalText.optional(),
  valid_days: z.coerce.number().int().min(1).max(365).optional(),
  notes: optionalText.optional(),
})

export type QuoteHeaderInput = z.infer<typeof quoteHeaderSchema>

export const quoteStatusSchema = z.object({
  status: z.enum(['sent', 'accepted', 'lost']),
  lost_reason: optionalText.optional(),
})

export type QuoteStatusInput = z.infer<typeof quoteStatusSchema>

export const quoteSectionSchema = z.object({
  quote_id: z.uuid(),
  title: z.string().min(1, 'Section title is required'),
})

export type QuoteSectionInput = z.infer<typeof quoteSectionSchema>

export const quoteLineCreateSchema = z.object({
  quote_id: z.uuid(),
  section_id: z.uuid(),
  /** When set, the line is prefilled from this rate item. */
  rate_item_id: z.uuid().optional(),
})

export type QuoteLineCreateInput = z.infer<typeof quoteLineCreateSchema>

export const quoteLineUpdateSchema = z.object({
  description: z.string(),
  qty: z.coerce.number().min(0),
  unit: z.string().min(1, 'Unit is required'),
  unit_cost: z.coerce.number().min(0),
  markup_pct: z.coerce.number().min(-100).max(1000),
  unit_sell: z.coerce.number().min(0),
  /** When false, unit_sell is recomputed server-side from cost + markup. */
  sell_overridden: z.boolean(),
})

export type QuoteLineUpdateInput = z.infer<typeof quoteLineUpdateSchema>

// ─── Invoices ────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_BASES = ['quote', 'costs', 'blank'] as const
export type InvoiceBasis = (typeof INVOICE_BASES)[number]

export const invoiceBasisSchema = z.enum(INVOICE_BASES)

export const invoiceHeaderSchema = z.object({
  issue_date: z.string().min(1, 'Issue date is required').optional(),
  due_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
})

export type InvoiceHeaderInput = z.infer<typeof invoiceHeaderSchema>

export const invoiceLineUpdateSchema = z.object({
  description: z.string(),
  qty: z.coerce.number().min(0),
  unit: z.string().min(1, 'Unit is required'),
  unit_sell: z.coerce.number().min(0),
})

export type InvoiceLineUpdateInput = z.infer<typeof invoiceLineUpdateSchema>

export const PAYMENT_METHODS = ['cash', 'eft', 'card', 'cheque', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const paymentSchema = z.object({
  invoice_id: z.uuid(),
  date: z.string().min(1, 'Date is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText.optional(),
})

export type PaymentInput = z.infer<typeof paymentSchema>

// ─── Checklist templates ─────────────────────────────────────────────────────

export const checklistTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required'),
  items: z
    .array(z.string())
    .transform((arr) => arr.map((s) => s.trim()).filter(Boolean))
    .refine((arr) => arr.length > 0, 'Add at least one item'),
})

export type ChecklistTemplateInput = z.infer<typeof checklistTemplateSchema>

// ─── Jobs ────────────────────────────────────────────────────────────────────

export const JOB_STATUSES = [
  'quote',
  'scheduled',
  'in_progress',
  'completed',
  'invoiced',
  'paid',
  'lost',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const jobCreateSchema = z.object({
  client_id: z.uuid('Pick a client'),
  site_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  title: z.string().min(1, 'Title is required'),
  description: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
  supervisor_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type JobCreateInput = z.infer<typeof jobCreateSchema>

export const jobUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
  site_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  supervisor_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  scheduled_start: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
  scheduled_end: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
})

export type JobUpdateInput = z.infer<typeof jobUpdateSchema>

export const jobStatusSchema = z.object({
  status: z.enum(['scheduled', 'in_progress', 'completed', 'lost']),
  scheduled_start: z.string().nullish().optional(),
})

export type JobStatusInput = z.infer<typeof jobStatusSchema>

export const checklistItemSchema = z.object({
  job_id: z.uuid(),
  text: z.string().min(1, 'Item text is required'),
})

export type ChecklistItemInput = z.infer<typeof checklistItemSchema>

export const workLogSchema = z.object({
  job_id: z.uuid(),
  date: z.string().min(1, 'Date is required'),
  notes: z.string().min(1, 'Notes are required'),
})

export type WorkLogInput = z.infer<typeof workLogSchema>

export const jobCostSchema = z.object({
  job_id: z.uuid(),
  date: z.string().min(1, 'Date is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  cost_code_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type JobCostInput = z.infer<typeof jobCostSchema>

// ─── Projects ────────────────────────────────────────────────────────────────

export const PROJECT_STATUSES = [
  'active',
  'practical_completion',
  'defects_liability',
  'closed',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const projectCreateSchema = z.object({
  client_id: z.uuid('Pick a client'),
  site_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  name: z.string().min(1, 'Name is required'),
  description: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
  contract_sum: z.coerce.number().min(0).default(0),
  retention_pct: z.coerce.number().min(0).max(100).default(10),
  retention_cap_pct: z.coerce.number().min(0).max(100).default(5),
  dlp_months: z.coerce.number().int().min(0).max(120).default(12),
  claim_day: z.coerce.number().int().min(1).max(31).default(25),
  start_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
  supervisor_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>

/** Status transitions are validated in the server action (forward-only chain). */
export const projectUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  site_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  supervisor_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  contract_sum: z.coerce.number().min(0).optional(),
  retention_pct: z.coerce.number().min(0).max(100).optional(),
  retention_cap_pct: z.coerce.number().min(0).max(100).optional(),
  dlp_months: z.coerce.number().int().min(0).max(120).optional(),
  claim_day: z.coerce.number().int().min(1).max(31).optional(),
  start_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
  client_ref: optionalText.optional(),
  superintendent: optionalText.optional(),
})

export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>

export const budgetLineSchema = z.object({
  project_id: z.uuid(),
  cost_code_id: z.uuid('Pick a cost code'),
  description: z.string().min(1, 'Description is required'),
  budget_amount: z.coerce.number().min(0),
})

export type BudgetLineInput = z.infer<typeof budgetLineSchema>

export const budgetLineUpdateSchema = z.object({
  description: z.string().min(1, 'Description is required').optional(),
  cost_code_id: z.uuid('Pick a cost code').optional(),
  budget_amount: z.coerce.number().min(0).optional(),
})

export type BudgetLineUpdateInput = z.infer<typeof budgetLineUpdateSchema>

export const projectCostSchema = z.object({
  project_id: z.uuid(),
  date: z.string().min(1, 'Date is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  cost_code_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type ProjectCostInput = z.infer<typeof projectCostSchema>

// ─── Purchase orders ──────────────────────────────────────────────────────────

export const PO_STATUSES = ['draft', 'issued', 'closed', 'cancelled'] as const
export type PoStatus = (typeof PO_STATUSES)[number]

export const poCreateSchema = z.object({
  project_id: z.uuid(),
  vendor_id: z.uuid('Pick a vendor'),
  notes: optionalText.optional(),
})

export type PoCreateInput = z.infer<typeof poCreateSchema>

export const poHeaderSchema = z.object({
  vendor_id: z.uuid().optional(),
  notes: optionalText.optional(),
})

export type PoHeaderInput = z.infer<typeof poHeaderSchema>

export const poLineCreateSchema = z.object({
  po_id: z.uuid(),
  description: z.string().min(1, 'Description is required'),
  cost_code_id: z.uuid().nullish().transform((v) => v ?? null),
  qty: z.coerce.number().min(0),
  unit: z.string().min(1, 'Unit is required'),
  unit_cost: z.coerce.number().min(0),
})

export type PoLineCreateInput = z.infer<typeof poLineCreateSchema>

export const poLineUpdateSchema = z.object({
  description: z.string().min(1, 'Description is required').optional(),
  cost_code_id: z.uuid().nullish().transform((v) => v ?? null).optional(),
  qty: z.coerce.number().min(0).optional(),
  unit: z.string().min(1, 'Unit is required').optional(),
  unit_cost: z.coerce.number().min(0).optional(),
})

export type PoLineUpdateInput = z.infer<typeof poLineUpdateSchema>

export const poStatusSchema = z.object({
  status: z.enum(['issued', 'closed', 'cancelled'] as const),
})

export type PoStatusInput = z.infer<typeof poStatusSchema>

// ─── Variations ──────────────────────────────────────────────────────────────

export const VARIATION_STATUSES = [
  'notified',
  'priced',
  'submitted',
  'approved',
  'rejected',
] as const
export type VariationStatus = (typeof VARIATION_STATUSES)[number]

export const variationCreateSchema = z.object({
  project_id: z.uuid(),
  title: z.string().min(1, 'Title is required'),
  description: optionalText,
  cost_estimate: z.coerce.number().min(0).nullable().default(null),
  sell_amount: z.coerce.number().min(0).nullable().default(null),
  client_ref: optionalText,
  time_bar_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
  notes: optionalText,
})

export type VariationCreateInput = z.infer<typeof variationCreateSchema>

export const variationUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  description: optionalText.optional(),
  cost_estimate: z.coerce.number().min(0).nullable().optional(),
  sell_amount: z.coerce.number().min(0).nullable().optional(),
  client_ref: optionalText.optional(),
  time_bar_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
  notes: optionalText.optional(),
})

export type VariationUpdateInput = z.infer<typeof variationUpdateSchema>

export const variationStatusSchema = z.object({
  status: z.enum(VARIATION_STATUSES),
})

export type VariationStatusInput = z.infer<typeof variationStatusSchema>

// ─── Claims ──────────────────────────────────────────────────────────────────

export const CLAIM_STATUSES = ['draft', 'submitted', 'certified', 'paid'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const claimLineUpdateSchema = z.object({
  pct_complete: z.coerce
    .number()
    .min(0, '% complete cannot be negative')
    .max(100, '% complete cannot exceed 100'),
  /** Unlocks values below the previously-claimed floor (credit situations). */
  allow_reduction: z.boolean().default(false),
})

export type ClaimLineUpdateInput = z.infer<typeof claimLineUpdateSchema>

export const claimCertifySchema = z.object({
  certified_amount: z.coerce.number().min(0, 'Certified amount cannot be negative'),
  schedule_received_at: z.string().min(1, 'Schedule received date is required'),
})

export type ClaimCertifyInput = z.infer<typeof claimCertifySchema>

// ─── Vendors ─────────────────────────────────────────────────────────────────

export const vendorQuickSchema = z.object({
  name: z.string().min(1, 'Vendor name is required'),
  email: optionalText.refine(
    (v) => v === null || z.email().safeParse(v).success,
    'Invalid email address'
  ).optional(),
  trade: optionalText.optional(),
})

export type VendorQuickInput = z.infer<typeof vendorQuickSchema>

export const vendorSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  abn: optionalText.refine(
    (v) => v === null || /^\d{11}$/.test(v.replace(/\s/g, '')),
    'ABN must be 11 digits'
  ).optional(),
  trades: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    ),
  contact_name: optionalText.optional(),
  email: optionalText
    .refine(
      (v) => v === null || z.email().safeParse(v).success,
      'Invalid email address'
    )
    .optional(),
  phone: optionalText.optional(),
  payment_terms_days: z.coerce.number().int().min(0).max(120).default(30),
  notes: optionalText.optional(),
})

export type VendorInput = z.infer<typeof vendorSchema>

export const COMPLIANCE_DOC_KINDS = [
  'public_liability',
  'workers_comp',
  'licence',
  'other',
] as const
export type ComplianceDocKind = (typeof COMPLIANCE_DOC_KINDS)[number]

export const COMPLIANCE_DOC_KIND_LABELS: Record<ComplianceDocKind, string> = {
  public_liability: 'Public Liability',
  workers_comp: "Workers' Comp",
  licence: 'Licence',
  other: 'Other',
}

export const complianceDocSchema = z.object({
  id: z.string().uuid().optional(),
  vendor_id: z.string().uuid(),
  kind: z.enum(COMPLIANCE_DOC_KINDS),
  reference: optionalText.optional(),
  expiry_date: z.string().min(1, 'Expiry date is required'),
})

export type ComplianceDocInput = z.infer<typeof complianceDocSchema>

// ─── Retention ────────────────────────────────────────────────────────────────

export const RETENTION_RELEASE_KINDS = ['release_pc', 'release_final'] as const
export type RetentionReleaseKind = (typeof RETENTION_RELEASE_KINDS)[number]

export const retentionReleaseSchema = z.object({
  kind: z.enum(RETENTION_RELEASE_KINDS),
  amount: z.coerce.number().positive('Amount must be positive'),
  date: z.string().min(1, 'Date is required'),
  notes: optionalText.optional(),
})

export type RetentionReleaseInput = z.infer<typeof retentionReleaseSchema>

// ─── Trade packages ───────────────────────────────────────────────────────────

export const PACKAGE_STATUSES = [
  'planned',
  'rfq_out',
  'quotes_in',
  'recommended',
  'awarded',
] as const
export type PackageStatus = (typeof PACKAGE_STATUSES)[number]

export const packageCreateSchema = z.object({
  project_id: z.uuid(),
  name: z.string().min(1, 'Package name is required'),
  budget_amount: z.coerce.number().min(0).default(0),
  cost_code_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  owner_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  let_by_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
  notes: optionalText,
})

export type PackageCreateInput = z.infer<typeof packageCreateSchema>

export const RFQ_STATUSES = ['invited', 'quoted', 'declined'] as const
export type RfqStatus = (typeof RFQ_STATUSES)[number]

export const rfqSendSchema = z.object({
  vendor_ids: z.array(z.uuid()).min(1, 'Select at least one vendor'),
  email_snapshot: z.string().min(1, 'Email body is required'),
})

export type RfqSendInput = z.infer<typeof rfqSendSchema>

export const rfqStatusSchema = z.object({
  status: z.enum(RFQ_STATUSES),
})

export type RfqStatusInput = z.infer<typeof rfqStatusSchema>

export const packageQuoteSchema = z.object({
  vendor_id: z.uuid('Pick a vendor'),
  amount: z.coerce.number().min(0, 'Amount cannot be negative'),
  inclusions: optionalText,
  exclusions: optionalText,
  notes: optionalText,
  received_at: z.string().min(1, 'Received date is required'),
})

export type PackageQuoteInput = z.infer<typeof packageQuoteSchema>

export const packageAwardSchema = z.object({
  vendor_id: z.uuid('Pick a vendor'),
  amount: z.coerce.number().positive('Amount must be positive'),
  cost_code_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  description: z.string().min(1, 'Description is required'),
})

export type PackageAwardInput = z.infer<typeof packageAwardSchema>

// ─── Timesheet entries ───────────────────────────────────────────────────────

export const checkInSchema = z.object({
  assignment_id: z.uuid(),
  job_id: z.uuid().nullable(),
  project_id: z.uuid().nullable(),
  date: z.string().min(1, 'Date is required'),
})

export type CheckInInput = z.infer<typeof checkInSchema>

export const manualEntrySchema = z
  .object({
    assignment_id: z.uuid(),
    job_id: z.uuid().nullable(),
    project_id: z.uuid().nullable(),
    date: z.string().min(1, 'Date is required'),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
  })
  .refine(
    (d) => {
      const [sh, sm] = d.start_time.split(':').map(Number)
      const [eh, em] = d.end_time.split(':').map(Number)
      return eh * 60 + em > sh * 60 + sm
    },
    { message: 'End time must be after start time', path: ['end_time'] }
  )

export type ManualEntryInput = z.infer<typeof manualEntrySchema>

// ─── Site diary ──────────────────────────────────────────────────────────────

export const WEATHER_OPTIONS = [
  'Fine',
  'Overcast',
  'Rain — work affected',
  'Rain — work stopped',
] as const
export type WeatherOption = (typeof WEATHER_OPTIONS)[number]

export const diarySchema = z.object({
  project_id: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  /** Free text — usually one of WEATHER_OPTIONS with an optional addendum. */
  weather: optionalText.optional(),
  work_performed: z.string().min(1, 'Describe the work performed'),
  delays: optionalText.optional(),
  instructions: optionalText.optional(),
  visitors: optionalText.optional(),
})

export type DiaryInput = z.infer<typeof diarySchema>

export const labourRowSchema = z.object({
  diary_id: z.uuid(),
  user_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  name: z.string().min(1, 'Name is required'),
  trade: optionalText.optional(),
  headcount: z.coerce.number().int().min(1, 'Headcount must be at least 1').max(500),
  hours: z.coerce.number().min(0).max(24, 'Hours cannot exceed 24'),
})

export type LabourRowInput = z.infer<typeof labourRowSchema>

export const labourRowUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  trade: optionalText.optional(),
  headcount: z.coerce.number().int().min(1).max(500).optional(),
  hours: z.coerce.number().min(0).max(24).optional(),
})

export type LabourRowUpdateInput = z.infer<typeof labourRowUpdateSchema>

export const PLANT_STATUSES = ['working', 'idle', 'down'] as const
export type PlantStatus = (typeof PLANT_STATUSES)[number]

export const plantRowSchema = z.object({
  diary_id: z.uuid(),
  plant_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  name: z.string().min(1, 'Name is required'),
  status: z.enum(PLANT_STATUSES),
  hours: z.coerce.number().min(0).max(24, 'Hours cannot exceed 24'),
})

export type PlantRowInput = z.infer<typeof plantRowSchema>

// ─── SWMS ────────────────────────────────────────────────────────────────────

export const RISK_LEVELS = ['H', 'M', 'L'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  H: 'High',
  M: 'Medium',
  L: 'Low',
}

export const swmsHazardSchema = z.object({
  task: z.string().min(1, 'Task is required'),
  hazards: z.string().min(1, 'Hazards are required'),
  risk: z.enum(RISK_LEVELS),
  controls: z.string().min(1, 'Controls are required'),
  residual_risk: z.enum(RISK_LEVELS),
})

export type SwmsHazard = z.infer<typeof swmsHazardSchema>

export const swmsTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required'),
  body: optionalText,
  hazards: z.array(swmsHazardSchema).min(1, 'Add at least one hazard row'),
  active: z.boolean().default(true),
})

export type SwmsTemplateInput = z.infer<typeof swmsTemplateSchema>

export const swmsInstanceCreateSchema = z
  .object({
    template_id: z.uuid('Pick a template'),
    project_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    job_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine(
    (d) => d.project_id !== null || d.job_id !== null,
    'Attach the SWMS to a project or job'
  )

export type SwmsInstanceCreateInput = z.infer<typeof swmsInstanceCreateSchema>

export const swmsSignSchema = z.object({
  instance_id: z.uuid(),
  name: z.string().min(1, 'Name is required'),
  /** The instance version the worker actually VIEWED and is attesting to.
   * signSwms compares this against the current instance.version (compare-and-set)
   * and rejects if the SWMS was revised between view and sign. */
  version: z.coerce.number().int(),
  /** PNG data URL exported from the signature pad. Char cap mirrors
   * formSignonSchema / the swms_signatures_signature_data DB check. */
  signature: z
    .string()
    .startsWith('data:image/png;base64,', 'Signature must be a PNG image')
    .max(140000, 'Signature image is too large'),
})

export type SwmsSignInput = z.infer<typeof swmsSignSchema>

// ─── Assignments ─────────────────────────────────────────────────────────────

export const assignmentSchema = z.object({
  user_id: z.uuid('Pick a person'),
  date: z.string().min(1, 'Date is required'),
  job_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  project_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  note: optionalText.optional(),
  /** Optional: create rows for every Mon–Sun day in range (capped 14 days, skip dupes). */
  repeat_until: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
}).refine(
  (d) => d.job_id !== null || d.project_id !== null,
  'Assign to a job or project'
)

export type AssignmentInput = z.infer<typeof assignmentSchema>

export const assignmentUpdateSchema = z.object({
  date: z.string().min(1, 'Date is required').optional(),
  job_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  project_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  note: optionalText.optional(),
})

export type AssignmentUpdateInput = z.infer<typeof assignmentUpdateSchema>

// ─── Docket / cost-from-docket ────────────────────────────────────────────────

/** Validates docket metadata stored in attachment.meta. */
export const docketMetaSchema = z.object({
  supplier: z.string().min(1, 'Supplier is required'),
  docket_no: z.string().min(1, 'Docket number is required'),
  docket_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)'),
  /** Set after a cost row is created from this docket. */
  cost_id: z.string().uuid().optional().nullable(),
})

export type DocketMeta = z.infer<typeof docketMetaSchema>

export const costFromDocketSchema = z.object({
  attachment_id: z.string().uuid(),
  /** Mirrors costs_parent_type_check — the COSTS row's parent, deliberately
   * narrower than attachments.parent_type. Do not widen. */
  parent_type: z.enum(['job', 'project']),
  parent_id: z.string().uuid(),
  date: z.string().min(1, 'Date is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  cost_code_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type CostFromDocketInput = z.infer<typeof costFromDocketSchema>

export const packageUpdateSchema = z.object({
  name: z.string().min(1, 'Package name is required').optional(),
  budget_amount: z.coerce.number().min(0).optional(),
  cost_code_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  owner_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  let_by_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
  notes: optionalText.optional(),
})

export type PackageUpdateInput = z.infer<typeof packageUpdateSchema>

// ─── Programme (Gantt) ───────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')

export const programmeTaskSchema = z
  .object({
    project_id: z.uuid(),
    name: z.string().min(1, 'Task name is required'),
    phase: optionalText,
    start_date: isoDate,
    end_date: isoDate,
    progress_pct: z.coerce.number().min(0).max(100).default(0),
  })
  .refine((d) => d.end_date >= d.start_date, {
    message: 'End date must be on or after the start date',
    path: ['end_date'],
  })

export type ProgrammeTaskInput = z.infer<typeof programmeTaskSchema>

export const programmeTaskUpdateSchema = z
  .object({
    name: z.string().min(1, 'Task name is required').optional(),
    phase: optionalText.optional(),
    start_date: isoDate.optional(),
    end_date: isoDate.optional(),
    progress_pct: z.coerce.number().min(0).max(100).optional(),
  })
  .refine(
    (d) => !d.start_date || !d.end_date || d.end_date >= d.start_date,
    { message: 'End date must be on or after the start date', path: ['end_date'] }
  )

export type ProgrammeTaskUpdateInput = z.infer<typeof programmeTaskUpdateSchema>

export const programmePredecessorsSchema = z.object({
  task_id: z.uuid(),
  project_id: z.uuid(),
  predecessor_ids: z.array(z.uuid()).max(50),
})

export type ProgrammePredecessorsInput = z.infer<typeof programmePredecessorsSchema>

// ─── WHS form templates ──────────────────────────────────────────────────────

export const FORM_TEMPLATE_KINDS = [
  'prestart',
  'take5',
  'toolbox',
  'induction',
  'incident',
  'custom',
] as const
export type FormTemplateKind = (typeof FORM_TEMPLATE_KINDS)[number]

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'checkbox',
  'date',
  'time',
  'photo',
  'signature',
  'rating',
] as const
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

const slugRegex = /^[a-z0-9_]+$/

export const formFieldSchema = z.object({
  key: z
    .string()
    .min(1, 'Key is required')
    .regex(slugRegex, 'Key must be lowercase letters, numbers and underscores only'),
  label: z.string().min(1, 'Label is required'),
  type: z.enum(FORM_FIELD_TYPES),
  options: z.array(z.string()).default([]),
  required: z.boolean().default(false),
})

export type FormField = z.infer<typeof formFieldSchema>

export const formTemplateSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.enum(FORM_TEMPLATE_KINDS),
    name: z.string().min(1, 'Name is required'),
    description: optionalText,
    schema: z
      .array(formFieldSchema)
      .min(1, 'Add at least one field')
      .refine(
        (fields) => {
          const keys = fields.map((f) => f.key)
          return keys.length === new Set(keys).size
        },
        'Field keys must be unique'
      ),
    requires_signon: z.boolean().default(false),
    active: z.boolean().default(true),
  })

export type FormTemplateInput = z.infer<typeof formTemplateSchema>

// ─── Form submissions (field) ────────────────────────────────────────────────

/**
 * Envelope for a dynamic form submission. The jsonb `data` payload is
 * validated separately against the template schema via
 * validateSubmissionData() in src/lib/form-validate.ts.
 */
export const formSubmissionSchema = z
  .object({
    template_id: z.uuid(),
    project_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    job_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    plant_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (d) => d.project_id !== null || d.job_id !== null,
    'Pick a project or job'
  )

export type FormSubmissionInput = z.infer<typeof formSubmissionSchema>

export const formSignonSchema = z.object({
  submission_id: z.uuid(),
  name: z.string().min(1, 'Name is required'),
  company: optionalText.optional(),
  /** PNG data URL exported from the signature pad. */
  signature: z
    .string()
    .startsWith('data:image/png;base64,', 'Signature must be a PNG image')
    .max(140000, 'Signature image is too large'),
  /** true = the signed-in user signing for themselves; false = pass-the-phone. */
  self: z.boolean(),
})

export type FormSignonInput = z.infer<typeof formSignonSchema>

// ─── Incidents ───────────────────────────────────────────────────────────────

export const INCIDENT_TYPES = [
  'injury',
  'near_miss',
  'property',
  'environmental',
] as const
export type IncidentType = (typeof INCIDENT_TYPES)[number]

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  injury: 'Injury',
  near_miss: 'Near miss',
  property: 'Property damage',
  environmental: 'Environmental',
}

export const INCIDENT_STATUSES = ['open', 'investigating', 'closed'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

export const incidentCreateSchema = z
  .object({
    project_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    job_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    type: z.enum(INCIDENT_TYPES),
    severity: z.coerce.number().int().min(1).max(5),
    /** datetime-local value: YYYY-MM-DDTHH:MM */
    occurred_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'When it happened is required'),
    location: optionalText,
    description: z.string().min(1, 'Describe what happened'),
    immediate_action: optionalText,
    /** UUID of the reporting profile. */
    reported_by: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine(
    (d) => d.project_id !== null || d.job_id !== null,
    'Pick a project or job'
  )

export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>

export const incidentUpdateSchema = z.object({
  type: z.enum(INCIDENT_TYPES).optional(),
  severity: z.coerce.number().int().min(1).max(5).optional(),
  occurred_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'When it happened is required')
    .optional(),
  location: optionalText.optional(),
  description: z.string().min(1, 'Describe what happened').optional(),
  immediate_action: optionalText.optional(),
  reported_by: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  project_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  job_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
})

export type IncidentUpdateInput = z.infer<typeof incidentUpdateSchema>

export const incidentStatusSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
})

export type IncidentStatusInput = z.infer<typeof incidentStatusSchema>

// ─── Corrective actions ───────────────────────────────────────────────────────

export const correctiveActionSchema = z.object({
  incident_id: z.uuid(),
  description: z.string().min(1, 'Description is required'),
  /** UUID of assigned profile (optional). */
  assigned_to: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  due_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
})

export type CorrectiveActionInput = z.infer<typeof correctiveActionSchema>

export const correctiveActionUpdateSchema = z.object({
  description: z.string().min(1, 'Description is required').optional(),
  assigned_to: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  due_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
})

// ─── NCR / CAPA register (ISO 9001/14001 §10.2) ──────────────────────────────

export const NCR_SOURCES = [
  'quality',
  'environmental',
  'customer_complaint',
  'audit_finding',
  'supplier',
  'safety',
  'other',
] as const
export type NcrSource = (typeof NCR_SOURCES)[number]

export const NCR_SOURCE_LABELS: Record<NcrSource, string> = {
  quality: 'Quality',
  environmental: 'Environmental',
  customer_complaint: 'Customer complaint',
  audit_finding: 'Audit finding',
  supplier: 'Supplier',
  safety: 'Safety',
  other: 'Other',
}

// Lifecycle, in order. The verification gate sits between 'actions' and
// 'verified'; 'closed' is reachable only from 'verified' (enforced in the
// server action, never bypassable from the client).
export const NCR_STATUSES = [
  'open',
  'investigating',
  'actions',
  'verified',
  'closed',
] as const
export type NcrStatus = (typeof NCR_STATUSES)[number]

/** Office-side raise: a fuller form than the field report. */
export const ncrCreateSchema = z.object({
  source: z.enum(NCR_SOURCES),
  category: optionalText,
  severity: z.coerce.number().int().min(1).max(5),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Describe the nonconformance'),
  immediate_action: optionalText,
  project_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  job_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  vendor_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  incident_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  occurred_on: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
})

export type NcrCreateInput = z.infer<typeof ncrCreateSchema>

/** Field-side raise (report-only): phone-simple, no CAPA/management fields. */
export const ncrFieldRaiseSchema = z.object({
  source: z.enum(['quality', 'environmental', 'safety', 'other'] as const),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Describe the problem'),
  project_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type NcrFieldRaiseInput = z.infer<typeof ncrFieldRaiseSchema>

/** Edit while not closed. Includes root_cause (captured during investigation). */
export const ncrUpdateSchema = z.object({
  source: z.enum(NCR_SOURCES).optional(),
  category: optionalText.optional(),
  severity: z.coerce.number().int().min(1).max(5).optional(),
  title: z.string().min(1, 'Title is required').optional(),
  description: z.string().min(1, 'Describe the nonconformance').optional(),
  immediate_action: optionalText.optional(),
  root_cause: optionalText.optional(),
  project_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  job_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  vendor_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  occurred_on: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
})

export type NcrUpdateInput = z.infer<typeof ncrUpdateSchema>

/**
 * Status transition. Moving to 'verified' requires verification_notes (the
 * verification-of-effectiveness evidence). The forward chain and the close gate
 * are enforced in the server action.
 */
export const ncrStatusSchema = z
  .object({
    status: z.enum(NCR_STATUSES),
    verification_notes: optionalText.optional(),
  })
  .refine(
    (d) => d.status !== 'verified' || Boolean(d.verification_notes),
    {
      message: 'Verification notes are required to verify effectiveness',
      path: ['verification_notes'],
    }
  )

export type NcrStatusInput = z.infer<typeof ncrStatusSchema>

export const CAPA_KINDS = ['corrective', 'preventive'] as const
export type CapaKind = (typeof CAPA_KINDS)[number]

export const CAPA_KIND_LABELS: Record<CapaKind, string> = {
  corrective: 'Corrective',
  preventive: 'Preventive',
}

export const capaActionSchema = z.object({
  ncr_id: z.uuid(),
  kind: z.enum(CAPA_KINDS),
  description: z.string().min(1, 'Description is required'),
  assigned_to: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  due_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
})

export type CapaActionInput = z.infer<typeof capaActionSchema>

export const capaActionUpdateSchema = z.object({
  kind: z.enum(CAPA_KINDS).optional(),
  description: z.string().min(1, 'Description is required').optional(),
  assigned_to: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null)
    .optional(),
  due_date: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
})

export type CapaActionUpdateInput = z.infer<typeof capaActionUpdateSchema>

// ─── Hold points ─────────────────────────────────────────────────────────────

export const holdPointSchema = z.object({
  id: z.uuid().optional(),
  project_id: z.uuid(),
  task_id: z.uuid(),
  title: z.string().min(1, 'Title is required'),
  required_by: z.string().min(1, 'Required by is required').default('Superintendent'),
  date: isoDate,
  notes: optionalText,
})

export type HoldPointInput = z.infer<typeof holdPointSchema>

export const holdPointReleaseSchema = z.object({
  released_by: z.string().min(1, 'Released by is required'),
  release_ref: optionalText,
})

export type HoldPointReleaseInput = z.infer<typeof holdPointReleaseSchema>

// ─── Subbie SWMS ─────────────────────────────────────────────────────────────

export const SUBBIE_SWMS_STATUSES = [
  'submitted',
  'under_review',
  'accepted',
  'rejected',
] as const
export type SubbieSwmsStatus = (typeof SUBBIE_SWMS_STATUSES)[number]

export const SUBBIE_SWMS_STATUS_LABELS: Record<SubbieSwmsStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

/** Review transition for a subbie SWMS row (notes required when rejecting). */
export const subbieSwmsStatusSchema = z
  .object({
    status: z.enum(['under_review', 'accepted', 'rejected'] as const),
    notes: optionalText,
    /** Optional vendor match, stored on accept. */
    vendor_id: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine(
    (v) => v.status !== 'rejected' || Boolean(v.notes),
    'Notes are required when rejecting'
  )

export type SubbieSwmsStatusInput = z.infer<typeof subbieSwmsStatusSchema>

// ─── Controlled document register (ISO 9001 §7.5) ────────────────────────────

export const DOC_CATEGORIES = [
  'policy',
  'procedure',
  'work_instruction',
  'form',
  'register',
  'plan',
  'sds',
  'external',
  'other',
] as const
export type DocCategory = (typeof DOC_CATEGORIES)[number]

export const DOC_CATEGORY_LABELS: Record<DocCategory, string> = {
  policy: 'Policy',
  procedure: 'Procedure',
  work_instruction: 'Work Instruction',
  form: 'Form',
  register: 'Register',
  plan: 'Plan',
  sds: 'SDS',
  external: 'External',
  other: 'Other',
}

export const DOC_SYSTEMS = ['qms', 'ems', 'ohs', 'integrated'] as const
export type DocSystem = (typeof DOC_SYSTEMS)[number]

export const DOC_SYSTEM_LABELS: Record<DocSystem, string> = {
  qms: 'QMS',
  ems: 'EMS',
  ohs: 'OHS',
  integrated: 'Integrated',
}

// Approval lifecycle, in order. The status stepper renders this sequence;
// 'superseded'/'archived' are terminal off-ramps shown separately.
export const DOC_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'issued',
  'superseded',
  'archived',
] as const
export type DocStatus = (typeof DOC_STATUSES)[number]

/** The forward approval steps a document moves through to become live. */
export const DOC_LIFECYCLE: DocStatus[] = ['draft', 'in_review', 'approved', 'issued']

/**
 * New document (or new version) in the controlled register. A draft may be
 * created with no file yet (file_path/filename null); the issue action guards
 * against issuing without a file. The file, when present, is uploaded by the
 * browser client to attachments/documents/ first; this validates the row the
 * server action records afterwards. When supersedes_id is set the action also
 * flips the old row to 'superseded' and starts the new row in 'draft'.
 */
export const documentSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  category: z.enum(DOC_CATEGORIES),
  system: z.enum(DOC_SYSTEMS),
  doc_number: optionalText,
  version: z.string().min(1, 'Version is required').transform((v) => v.trim()),
  file_path: z
    .string()
    .regex(/^documents\//, 'Invalid file path')
    .refine((v) => !v.includes('..'), 'Invalid file path')
    .nullish()
    .transform((v) => v ?? null),
  filename: optionalText,
  content_type: optionalText,
  size: z.coerce
    .number()
    .int()
    .positive()
    .nullish()
    .transform((v) => v ?? null),
  review_due: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null)),
  notes: optionalText,
  supersedes_id: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
})

export type DocumentInput = z.infer<typeof documentSchema>

/** Metadata-only edit of an existing register document (no file change). */
export const documentUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  category: z.enum(DOC_CATEGORIES).optional(),
  system: z.enum(DOC_SYSTEMS).optional(),
  doc_number: optionalText.optional(),
  version: z
    .string()
    .min(1, 'Version is required')
    .transform((v) => v.trim())
    .optional(),
  review_due: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() === '' ? null : v?.trim() ?? null))
    .optional(),
  notes: optionalText.optional(),
})

export type DocumentUpdateInput = z.infer<typeof documentUpdateSchema>
