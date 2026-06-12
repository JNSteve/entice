import { describe, expect, it } from 'vitest'
import {
  validateSubmissionData,
  MAX_SIGNATURE_CHARS,
  SIGNATURE_DATA_URL_PREFIX,
} from '@/lib/form-validate'
import type { FormField } from '@/lib/zod'

function field(partial: Partial<FormField> & Pick<FormField, 'key' | 'type'>): FormField {
  return {
    label: partial.key,
    options: [],
    required: false,
    ...partial,
  } as FormField
}

describe('validateSubmissionData', () => {
  it('fails when a required text field is missing or blank', () => {
    const schema = [field({ key: 'topic', type: 'text', label: 'Topic', required: true })]

    const missing = validateSubmissionData(schema, {})
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.errors.topic).toMatch(/required/i)

    const blank = validateSubmissionData(schema, { topic: '   ' })
    expect(blank.ok).toBe(false)
    if (!blank.ok) expect(blank.errors.topic).toMatch(/required/i)
  })

  it('fails when a required checkbox is false (required means must be ticked)', () => {
    const schema = [
      field({ key: 'ppe', type: 'checkbox', label: 'PPE checked', required: true }),
    ]

    const unticked = validateSubmissionData(schema, { ppe: false })
    expect(unticked.ok).toBe(false)
    if (!unticked.ok) expect(unticked.errors.ppe).toMatch(/ticked/i)

    const absent = validateSubmissionData(schema, {})
    expect(absent.ok).toBe(false)
    if (!absent.ok) expect(absent.errors.ppe).toMatch(/ticked/i)

    const ticked = validateSubmissionData(schema, { ppe: true })
    expect(ticked.ok).toBe(true)
  })

  it('allows an optional checkbox to be false and stores the boolean', () => {
    const schema = [field({ key: 'opt', type: 'checkbox' })]
    const result = validateSubmissionData(schema, { opt: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.opt).toBe(false)
  })

  it('fails when a select value is not one of the options', () => {
    const schema = [
      field({
        key: 'brakes',
        type: 'select',
        options: ['OK', 'Defect', 'N/A'],
        required: true,
      }),
    ]

    const bad = validateSubmissionData(schema, { brakes: 'Broken' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.brakes).toMatch(/options/i)

    const good = validateSubmissionData(schema, { brakes: 'Defect' })
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.data.brakes).toBe('Defect')
  })

  it('rejects signatures that are not PNG data URLs and ones that are too large', () => {
    const schema = [field({ key: 'sig', type: 'signature', required: true })]

    const notDataUrl = validateSubmissionData(schema, { sig: 'hello.png' })
    expect(notDataUrl.ok).toBe(false)

    const wrongPrefix = validateSubmissionData(schema, {
      sig: 'data:image/jpeg;base64,AAAA',
    })
    expect(wrongPrefix.ok).toBe(false)

    const tooLarge = validateSubmissionData(schema, {
      sig: SIGNATURE_DATA_URL_PREFIX + 'A'.repeat(MAX_SIGNATURE_CHARS),
    })
    expect(tooLarge.ok).toBe(false)

    const good = validateSubmissionData(schema, {
      sig: SIGNATURE_DATA_URL_PREFIX + 'iVBORw0KGgo=',
    })
    expect(good.ok).toBe(true)
  })

  it('strips unknown keys not present in the template schema', () => {
    const schema = [field({ key: 'topic', type: 'text', required: true })]
    const result = validateSubmissionData(schema, {
      topic: 'Working at heights',
      injected: 'nope',
      __proto__pollution: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ topic: 'Working at heights' })
    }
  })

  it('never stores photo fields in the data payload (photos attach after submit)', () => {
    const schema = [
      field({ key: 'photos', type: 'photo', required: true }),
      field({ key: 'notes', type: 'textarea' }),
    ]
    // Required photo fields must not block submission either.
    const result = validateSubmissionData(schema, {
      photos: ['something'],
      notes: 'ok',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ notes: 'ok' })
    }
  })

  it('coerces numeric strings for number and rating fields and bounds ratings 1-5', () => {
    const schema = [
      field({ key: 'hours', type: 'number', required: true }),
      field({ key: 'stars', type: 'rating', required: true }),
    ]

    const good = validateSubmissionData(schema, { hours: '1432.5', stars: '4' })
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.data.hours).toBe(1432.5)
      expect(good.data.stars).toBe(4)
    }

    const badNumber = validateSubmissionData(schema, { hours: 'lots', stars: 3 })
    expect(badNumber.ok).toBe(false)

    const outOfRange = validateSubmissionData(schema, { hours: 1, stars: 6 })
    expect(outOfRange.ok).toBe(false)

    const fractional = validateSubmissionData(schema, { hours: 1, stars: 3.5 })
    expect(fractional.ok).toBe(false)
  })

  it('validates date and time formats', () => {
    const schema = [
      field({ key: 'd', type: 'date', required: true }),
      field({ key: 't', type: 'time', required: true }),
    ]

    const good = validateSubmissionData(schema, { d: '2026-06-12', t: '07:30' })
    expect(good.ok).toBe(true)

    const bad = validateSubmissionData(schema, { d: '12/06/2026', t: '7.30am' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.d).toBeTruthy()
      expect(bad.errors.t).toBeTruthy()
    }
  })

  it('omits blank optional values and trims text', () => {
    const schema = [
      field({ key: 'topic', type: 'text', required: true }),
      field({ key: 'notes', type: 'textarea' }),
      field({ key: 'rating', type: 'rating' }),
    ]
    const result = validateSubmissionData(schema, {
      topic: '  Hot works  ',
      notes: '',
      rating: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ topic: 'Hot works' })
    }
  })

  it('tolerates a non-object payload by treating it as empty', () => {
    const schema = [field({ key: 'topic', type: 'text', required: true })]
    const result = validateSubmissionData(schema, 'not-an-object')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.topic).toMatch(/required/i)

    const optionalOnly = validateSubmissionData(
      [field({ key: 'notes', type: 'textarea' })],
      null
    )
    expect(optionalOnly.ok).toBe(true)
    if (optionalOnly.ok) expect(optionalOnly.data).toEqual({})
  })
})
