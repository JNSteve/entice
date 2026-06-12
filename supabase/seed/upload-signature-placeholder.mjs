// Uploads the shared seed signature placeholder PNG to the attachments bucket
// at seed/sig-placeholder.png (referenced by all seeded SWMS signatures).
//
// Run from the repo root (after seed.sql, which creates no storage objects):
//   node supabase/seed/upload-signature-placeholder.mjs
//
// Signs in as the admin user with the anon key — no service-role key needed.
// On this machine you may need: NODE_EXTRA_CA_CERTS=C:\Users\nickj\norton-ssl-root-ca.pem

import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function loadEnv() {
  const env = {}
  for (const line of readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

// ─── Minimal PNG writer: 160×48 RGBA squiggle that looks like a signature ───
function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function buildSignaturePng() {
  const w = 160
  const h = 48
  // RGBA, transparent background
  const px = new Uint8Array(w * h * 4)
  const set = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return
    const i = (y * w + x) * 4
    px[i] = 30 // dark ink
    px[i + 1] = 30
    px[i + 2] = 60
    px[i + 3] = 255
  }
  // A looping cursive-ish stroke: two overlapping sine waves
  for (let t = 0; t <= 1; t += 0.0005) {
    const x = Math.round(8 + t * (w - 16))
    const y = Math.round(
      24 + 10 * Math.sin(t * Math.PI * 4) + 6 * Math.sin(t * Math.PI * 9 + 1.2)
    )
    for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) set(x + dx, y + dy)
  }
  // Raw scanlines with filter byte 0
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PATH = 'seed/sig-placeholder.png'

async function main() {
  const env = loadEnv()
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: 'admin@entice.local',
    password: 'EnticeAdmin!1',
  })
  if (authError) throw new Error(`Sign-in failed: ${authError.message}`)

  const png = buildSignaturePng()
  let { error } = await supabase.storage
    .from('attachments')
    .upload(PATH, png, { contentType: 'image/png' })
  if (error && /exists|duplicate/i.test(error.message)) {
    // No storage UPDATE policy — delete (admin may) and re-upload.
    await supabase.storage.from('attachments').remove([PATH])
    ;({ error } = await supabase.storage
      .from('attachments')
      .upload(PATH, png, { contentType: 'image/png' }))
  }
  if (error) throw new Error(`Upload failed: ${error.message}`)

  const { data } = await supabase.storage.from('attachments').createSignedUrl(PATH, 60)
  console.log(`Uploaded attachments/${PATH} (${png.length} bytes)`)
  console.log(`Verified signed URL: ${data?.signedUrl ? 'OK' : 'FAILED'}`)
  await supabase.auth.signOut()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
