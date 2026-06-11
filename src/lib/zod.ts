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
