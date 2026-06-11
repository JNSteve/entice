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
