import { expect, test } from 'vitest'
import {
  MAX_MESSAGE_CHARS,
  MAX_PATH_CHARS,
  MAX_STACK_CHARS,
  trimErrorText,
} from '../src/lib/error-log'

test('null/undefined/empty/whitespace collapse to null', () => {
  expect(trimErrorText(null, 100)).toBeNull()
  expect(trimErrorText(undefined, 100)).toBeNull()
  expect(trimErrorText('', 100)).toBeNull()
  expect(trimErrorText('   \n\t ', 100)).toBeNull()
})

test('short text passes through trimmed', () => {
  expect(trimErrorText('  boom  ', 100)).toBe('boom')
})

test('long stacks are hard-capped at the limit', () => {
  const stack = 'x'.repeat(5000)
  const trimmed = trimErrorText(stack, MAX_STACK_CHARS)
  expect(trimmed).toHaveLength(4000)
  expect(MAX_STACK_CHARS).toBe(4000)
})

test('text exactly at the limit is untouched', () => {
  const exact = 'y'.repeat(MAX_MESSAGE_CHARS)
  expect(trimErrorText(exact, MAX_MESSAGE_CHARS)).toBe(exact)
})

test('trim happens before the cap (whitespace does not count)', () => {
  const padded = `  ${'z'.repeat(MAX_PATH_CHARS)}  `
  expect(trimErrorText(padded, MAX_PATH_CHARS)).toHaveLength(MAX_PATH_CHARS)
})
