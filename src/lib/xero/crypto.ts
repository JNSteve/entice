import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Refresh/access tokens at rest (xero_connection) are AES-256-GCM encrypted
 * with XERO_TOKEN_KEY — a 32-byte key that lives ONLY in the Vercel env
 * (Xero security standard: symmetric encryption, key separate from code).
 * Blob format: base64url(iv).base64url(ciphertext).base64url(tag).
 */

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12

function keyBuffer(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) {
    throw new Error('XERO_TOKEN_KEY must decode to exactly 32 bytes')
  }
  return key
}

/** Mint a new key: paste the output into Vercel as XERO_TOKEN_KEY. */
export function newTokenKey(): string {
  return randomBytes(32).toString('base64')
}

export function encryptSecret(plain: string, keyB64: string): string {
  const key = keyBuffer(keyB64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, ct, tag].map((b) => b.toString('base64url')).join('.')
}

export function decryptSecret(blob: string, keyB64: string): string {
  const key = keyBuffer(keyB64)
  const parts = blob.split('.')
  if (parts.length !== 3) throw new Error('Malformed encrypted secret')
  const [iv, ct, tag] = parts.map((p) => Buffer.from(p, 'base64url'))
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
