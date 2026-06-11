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
