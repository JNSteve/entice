import { expect, test } from 'vitest'
import {
  MAX_UPLOAD_SIZE,
  buildStorageKey,
  safeContentType,
  sanitizeFilename,
  validateUploadFile,
} from '../src/lib/storage-keys'

// Any character outside this set would 400 or silently truncate the storage key.
const SAFE_KEY_PART = /^[a-zA-Z0-9._-]+$/

test('sanitizeFilename replaces spaces and parentheses', () => {
  expect(sanitizeFilename('site photo (1).jpg')).toBe('site_photo__1_.jpg')
  expect(sanitizeFilename('site photo (1).jpg')).toMatch(SAFE_KEY_PART)
})

test('sanitizeFilename neutralises # and ? (silent key truncation)', () => {
  expect(sanitizeFilename('doc #2.pdf')).toBe('doc__2.pdf')
  expect(sanitizeFilename('what?.pdf')).toBe('what_.pdf')
})

test('sanitizeFilename replaces unicode and % (storage 400s)', () => {
  expect(sanitizeFilename('résumé—final.pdf')).toBe('r_sum__final.pdf')
  expect(sanitizeFilename('100%.png')).toBe('100_.png')
  expect(sanitizeFilename('zz-audit-fix résumé #2 (1).pdf')).toBe(
    'zz-audit-fix_r_sum___2__1_.pdf'
  )
})

test('sanitizeFilename replaces leading/trailing spaces (storage trims them)', () => {
  expect(sanitizeFilename(' padded.txt ')).toBe('_padded.txt_')
})

test('sanitizeFilename preserves long names without truncation', () => {
  const long = `${'a'.repeat(140)} copy (2).pdf`
  const out = sanitizeFilename(long)
  expect(out).toHaveLength(long.length)
  expect(out).toMatch(SAFE_KEY_PART)
})

test('sanitizeFilename keeps already-safe names untouched', () => {
  expect(sanitizeFilename('IMG_2041.heic')).toBe('IMG_2041.heic')
})

test('buildStorageKey produces {prefix}/{uuid}-{sanitized}', () => {
  const key = buildStorageKey('job/abc-123', 'site photo #4.jpg')
  const m = key.match(
    /^job\/abc-123\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/
  )
  expect(m).not.toBeNull()
  expect(m![2]).toBe('site_photo__4.jpg')
})

test('safeContentType falls back to application/octet-stream', () => {
  expect(safeContentType('')).toBe('application/octet-stream')
  expect(safeContentType(null)).toBe('application/octet-stream')
  expect(safeContentType(undefined)).toBe('application/octet-stream')
  expect(safeContentType('image/jpeg')).toBe('image/jpeg')
})

test('validateUploadFile rejects zero-byte files with a clear message', () => {
  const msg = validateUploadFile({ name: 'placeholder.jpg', size: 0 })
  expect(msg).toContain('placeholder.jpg')
  expect(msg).toContain('empty')
})

test('validateUploadFile rejects files above 25 MB', () => {
  expect(validateUploadFile({ name: 'big.mov', size: MAX_UPLOAD_SIZE + 1 })).toContain(
    '25 MB'
  )
  expect(validateUploadFile({ name: 'edge.bin', size: MAX_UPLOAD_SIZE })).toBeNull()
})

test('validateUploadFile accepts normal files', () => {
  expect(validateUploadFile({ name: 'ok.pdf', size: 1234 })).toBeNull()
})
