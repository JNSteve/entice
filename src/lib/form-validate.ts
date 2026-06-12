import type { FormField } from '@/lib/zod'

/**
 * Dynamic validation of a form submission's `data` payload against a
 * template schema. Pure — used client-side for inline errors and
 * server-side as the authority before insert.
 *
 * Rules:
 *  - Unknown keys (not in the template schema) are stripped.
 *  - `photo` fields are never stored in data — photos attach to the
 *    submission AFTER submit via the attachments table.
 *  - Required checkbox means "must be ticked" (true).
 *  - Select values must be one of the template's options.
 *  - Signatures are PNG data URLs, capped at ~100KB binary (140000 chars).
 *  - Empty optional values are omitted from the cleaned payload.
 */

export type SubmissionValidation =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> }

export const SIGNATURE_DATA_URL_PREFIX = 'data:image/png;base64,'
/** ~100KB of PNG as a base64 data URL. Matches the DB check (<= 140000). */
export const MAX_SIGNATURE_CHARS = 140000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  )
}

export function validateSubmissionData(
  schema: FormField[],
  input: unknown
): SubmissionValidation {
  const raw =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}

  const data: Record<string, unknown> = {}
  const errors: Record<string, string> = {}

  for (const field of schema) {
    // Photo fields are captured after submit — never part of the payload.
    if (field.type === 'photo') continue

    const value = raw[field.key]

    if (isBlank(value)) {
      if (field.required) {
        errors[field.key] =
          field.type === 'checkbox'
            ? `${field.label} must be ticked`
            : `${field.label} is required`
      }
      continue
    }

    switch (field.type) {
      case 'text':
      case 'textarea': {
        if (typeof value !== 'string') {
          errors[field.key] = `${field.label} must be text`
          break
        }
        data[field.key] = value.trim()
        break
      }
      case 'number': {
        const n =
          typeof value === 'number'
            ? value
            : typeof value === 'string'
              ? Number(value)
              : NaN
        if (!Number.isFinite(n)) {
          errors[field.key] = `${field.label} must be a number`
          break
        }
        data[field.key] = n
        break
      }
      case 'select': {
        if (typeof value !== 'string' || !field.options.includes(value)) {
          errors[field.key] = `${field.label} must be one of the listed options`
          break
        }
        data[field.key] = value
        break
      }
      case 'checkbox': {
        if (typeof value !== 'boolean') {
          errors[field.key] = `${field.label} must be ticked or left blank`
          break
        }
        if (field.required && value !== true) {
          errors[field.key] = `${field.label} must be ticked`
          break
        }
        data[field.key] = value
        break
      }
      case 'date': {
        if (typeof value !== 'string' || !DATE_RE.test(value.trim())) {
          errors[field.key] = `${field.label} must be a date (YYYY-MM-DD)`
          break
        }
        data[field.key] = value.trim()
        break
      }
      case 'time': {
        if (typeof value !== 'string' || !TIME_RE.test(value.trim())) {
          errors[field.key] = `${field.label} must be a time (HH:MM)`
          break
        }
        data[field.key] = value.trim()
        break
      }
      case 'rating': {
        const n =
          typeof value === 'number'
            ? value
            : typeof value === 'string'
              ? Number(value)
              : NaN
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          errors[field.key] = `${field.label} must be a rating from 1 to 5`
          break
        }
        data[field.key] = n
        break
      }
      case 'signature': {
        if (
          typeof value !== 'string' ||
          !value.startsWith(SIGNATURE_DATA_URL_PREFIX)
        ) {
          errors[field.key] = `${field.label} must be a signature`
          break
        }
        if (value.length > MAX_SIGNATURE_CHARS) {
          errors[field.key] = `${field.label} image is too large`
          break
        }
        data[field.key] = value
        break
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, data }
}
