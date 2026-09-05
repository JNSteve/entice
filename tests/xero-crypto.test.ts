import { describe, expect, test } from 'vitest'
import { decryptSecret, encryptSecret, newTokenKey } from '../src/lib/xero/crypto'

describe('xero token crypto', () => {
  const key = newTokenKey()

  test('newTokenKey is 32 bytes of base64', () => {
    expect(Buffer.from(key, 'base64')).toHaveLength(32)
  })

  test('round trip', () => {
    const blob = encryptSecret('refresh-token-abc', key)
    expect(blob.split('.')).toHaveLength(3)
    expect(blob).not.toContain('refresh-token-abc')
    expect(decryptSecret(blob, key)).toBe('refresh-token-abc')
  })

  test('two encryptions of the same value differ (random IV)', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key))
  })

  test('tampered ciphertext is rejected', () => {
    const [iv, ct, tag] = encryptSecret('secret', key).split('.')
    const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)
    expect(() => decryptSecret(`${iv}.${flipped}.${tag}`, key)).toThrow()
  })

  test('wrong key is rejected', () => {
    const blob = encryptSecret('secret', key)
    expect(() => decryptSecret(blob, newTokenKey())).toThrow()
  })

  test('a key that is not 32 bytes is rejected up front', () => {
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow(
      /32 bytes/
    )
  })
})
