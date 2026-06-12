// RLS regression check — proves the field role cannot see or touch money data.
//
// Signs in as the seeded field user (field1@entice.local, see seed.sql) with
// the ANON key and asserts:
//   - SELECT on quotes / claims / invoices / costs / budget_lines returns 0 rows
//     (RLS-filtered, no error — anon policies simply exclude the field role)
//   - INSERT into costs is rejected
//
// Run from the repo root (reads keys from .env.local — never hardcode keys):
//   node supabase/seed/rls-check.mjs
// On this machine you may need: NODE_EXTRA_CA_CERTS=C:\Users\nickj\norton-ssl-root-ca.pem
//
// Exits 0 when every check passes, 1 otherwise.

import { readFileSync } from 'node:fs'
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

// Money tables a field user must never see.
const MONEY_TABLES = ['quotes', 'claims', 'invoices', 'costs', 'budget_lines']

// Seeded demo login (created by seed.sql — demo password lives there too).
const FIELD_EMAIL = 'field1@entice.local'
const FIELD_PASSWORD = 'Entice!234'

let failures = 0

function check(label, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL'
  if (!ok) failures++
  console.log(`${status}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const env = loadEnv()
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env.local')
  }

  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: FIELD_EMAIL,
    password: FIELD_PASSWORD,
  })
  if (authError) throw new Error(`Sign-in as ${FIELD_EMAIL} failed: ${authError.message}`)

  for (const table of MONEY_TABLES) {
    const { data, error } = await supabase.from(table).select('id').limit(10)
    if (error) {
      // An explicit permission error also proves the table is closed off.
      check(`select ${table}`, true, `blocked with error: ${error.message}`)
    } else {
      check(
        `select ${table}`,
        (data ?? []).length === 0,
        `${(data ?? []).length} rows visible`
      )
    }
  }

  // INSERT into costs must be rejected by RLS.
  const { data: inserted, error: insertError } = await supabase
    .from('costs')
    .insert({
      parent_type: 'project',
      parent_id: '00000000-0000-4000-a000-000000000000',
      description: 'rls-check probe — must never be inserted',
      amount: 1,
      date: '2026-01-01',
    })
    .select()
  if (insertError) {
    check('insert costs rejected', true, insertError.message)
  } else {
    check('insert costs rejected', false, `insert SUCCEEDED: ${JSON.stringify(inserted)}`)
  }

  await supabase.auth.signOut()

  if (failures > 0) {
    console.error(`\n${failures} RLS check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll RLS checks passed')
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
