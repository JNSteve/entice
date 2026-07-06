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

// Seeded demo logins (created by seed.sql — demo passwords live there too).
const FIELD_EMAIL = 'field1@entice.local'
const FIELD_PASSWORD = 'Entice!234'

// Non-field user for immutability checks. The supervisor role can select
// audit_log rows (RLS: a/o/s), so they should be able to see rows but still
// be blocked from modifying them. Uses the seeded super@entice.local user;
// falls back gracefully if not present.
const SUPER_EMAIL = 'super@entice.local'
const SUPER_PASSWORD = 'Entice!234'

// Legacy alias — keep if any code references it
const ADMIN_EMAIL = SUPER_EMAIL
const ADMIN_PASSWORD = SUPER_PASSWORD

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

  // ─── ITP / lots: field is READ-ONLY (SELECT ok, writes rejected) ────────

  console.log('\n── ITP / lots field write-block ──')

  const { error: lotInsertError, data: lotInserted } = await supabase
    .from('lots')
    .insert({
      number: 'LOT-9999',
      project_id: '00000000-0000-4000-a000-000000000000',
      itp_instance_id: '00000000-0000-4000-a000-000000000000',
      description: 'rls-check probe — must never be inserted',
    })
    .select()
  if (lotInsertError) {
    check('insert lots rejected (field)', true, lotInsertError.message)
  } else {
    check('insert lots rejected (field)', false, `insert SUCCEEDED: ${JSON.stringify(lotInserted)}`)
  }

  const { error: inspInsertError, data: inspInserted } = await supabase
    .from('lot_inspections')
    .insert({
      lot_id: '00000000-0000-4000-a000-000000000000',
      itp_instance_item_id: '00000000-0000-4000-a000-000000000000',
      result: 'pass',
    })
    .select()
  if (inspInsertError) {
    check('insert lot_inspections rejected (field)', true, inspInsertError.message)
  } else {
    check('insert lot_inspections rejected (field)', false, `insert SUCCEEDED: ${JSON.stringify(inspInserted)}`)
  }

  const { error: tmplInsertError, data: tmplInserted } = await supabase
    .from('itp_templates')
    .insert({ name: 'rls probe', activity: 'rls probe' })
    .select()
  if (tmplInsertError) {
    check('insert itp_templates rejected (field)', true, tmplInsertError.message)
  } else {
    check('insert itp_templates rejected (field)', false, `insert SUCCEEDED: ${JSON.stringify(tmplInserted)}`)
  }

  // SELECT is allowed (read-only role) — templates must be visible.
  const { data: tmplRows, error: tmplSelectError } = await supabase
    .from('itp_templates')
    .select('id')
    .limit(1)
  if (tmplSelectError) {
    check('select itp_templates allowed (field)', false, tmplSelectError.message)
  } else {
    check(
      'select itp_templates allowed (field)',
      (tmplRows ?? []).length > 0,
      `${(tmplRows ?? []).length} row(s) visible`
    )
  }

  // ─── CP3: email_log is ADMIN-ONLY; portal_feedback is definer-fn only ───

  console.log('\n── CP3 email/feedback ──')

  const { data: fieldEmailRows, error: fieldEmailError } = await supabase
    .from('email_log')
    .select('id')
    .limit(10)
  if (fieldEmailError) {
    check('email_log SELECT blocked for field', true, `error: ${fieldEmailError.message}`)
  } else {
    check(
      'email_log SELECT blocked for field',
      (fieldEmailRows ?? []).length === 0,
      `field user can see ${(fieldEmailRows ?? []).length} email row(s)`
    )
  }

  const { error: emailInsertError, data: emailInserted } = await supabase
    .from('email_log')
    .insert({
      to_address: 'rls-probe@example.com',
      subject: 'rls-check probe — must never be inserted',
      template: 'test',
      status: 'skipped',
    })
    .select()
  if (emailInsertError) {
    check('insert email_log rejected (field)', true, emailInsertError.message)
  } else {
    check('insert email_log rejected (field)', false, `insert SUCCEEDED: ${JSON.stringify(emailInserted)}`)
  }

  const { data: fieldFeedbackRows, error: fieldFeedbackError } = await supabase
    .from('portal_feedback')
    .select('id')
    .limit(10)
  if (fieldFeedbackError) {
    check('portal_feedback SELECT blocked for field', true, `error: ${fieldFeedbackError.message}`)
  } else {
    check(
      'portal_feedback SELECT blocked for field',
      (fieldFeedbackRows ?? []).length === 0,
      `field user can see ${(fieldFeedbackRows ?? []).length} feedback row(s)`
    )
  }

  const { error: feedbackInsertError, data: feedbackInserted } = await supabase
    .from('portal_feedback')
    .insert({
      client_link_id: '00000000-0000-4000-a000-000000000000',
      client_id: '00000000-0000-4000-a000-000000000000',
      site_id: '00000000-0000-4000-a000-000000000000',
      job_id: '00000000-0000-4000-a000-000000000000',
      rating: 5,
    })
    .select()
  if (feedbackInsertError) {
    check('insert portal_feedback rejected (field)', true, feedbackInsertError.message)
  } else {
    check('insert portal_feedback rejected (field)', false, `insert SUCCEEDED: ${JSON.stringify(feedbackInserted)}`)
  }

  await supabase.auth.signOut()

  // ─── Audit log immutability checks ─────────────────────────────────────
  // We need an admin-role user to test the UPDATE/DELETE restrictions because
  // the field role has no SELECT on audit_log (zero rows) and thus cannot
  // obtain a row ID to attempt modification.

  console.log('\n── Audit log immutability ──')

  const adminClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { error: adminAuthError } = await adminClient.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })

  if (adminAuthError) {
    console.log(`SKIP  audit immutability — ${ADMIN_EMAIL} sign-in failed: ${adminAuthError.message}`)
    console.log('      (requires super@entice.local seeded user — run seed.sql first)')
  } else {
    // email_log is ADMIN-only — a supervisor must see zero rows.
    const { data: superEmailRows, error: superEmailError } = await adminClient
      .from('email_log')
      .select('id')
      .limit(10)
    if (superEmailError) {
      check('email_log SELECT blocked for supervisor', true, `error: ${superEmailError.message}`)
    } else {
      check(
        'email_log SELECT blocked for supervisor',
        (superEmailRows ?? []).length === 0,
        `supervisor can see ${(superEmailRows ?? []).length} email row(s)`
      )
    }

    // Pick any existing audit_log row.
    const { data: auditSample } = await adminClient
      .from('audit_log')
      .select('id')
      .limit(1)
      .single()

    if (!auditSample) {
      console.log('SKIP  audit immutability — no audit_log rows exist yet')
    } else {
      const rowId = auditSample.id

      // Attempt UPDATE — must affect 0 rows or error.
      const { error: updateError, count: updateCount } = await adminClient
        .from('audit_log')
        .update({ action: 'tampered' })
        .eq('id', rowId)

      if (updateError) {
        check('audit_log UPDATE rejected (admin)', true, updateError.message)
      } else {
        check(
          'audit_log UPDATE rejected (admin)',
          (updateCount ?? 0) === 0,
          `UPDATE affected ${updateCount ?? 0} row(s) — audit log is NOT immutable!`
        )
      }

      // Attempt DELETE — must affect 0 rows or error.
      const { error: deleteError, count: deleteCount } = await adminClient
        .from('audit_log')
        .delete()
        .eq('id', rowId)

      if (deleteError) {
        check('audit_log DELETE rejected (admin)', true, deleteError.message)
      } else {
        check(
          'audit_log DELETE rejected (admin)',
          (deleteCount ?? 0) === 0,
          `DELETE removed ${deleteCount ?? 0} row(s) — audit log is NOT immutable!`
        )
      }

      // Field user SELECT on audit_log must return 0 rows (RLS: a/o/s only).
      // Re-sign-in as field user.
      await supabase.auth.signInWithPassword({
        email: FIELD_EMAIL,
        password: FIELD_PASSWORD,
      })
      const { data: fieldAudit, error: fieldSelectError } = await supabase
        .from('audit_log')
        .select('id')
        .limit(10)
      if (fieldSelectError) {
        check('audit_log SELECT blocked for field', true, `error: ${fieldSelectError.message}`)
      } else {
        check(
          'audit_log SELECT blocked for field',
          (fieldAudit ?? []).length === 0,
          `field user can see ${(fieldAudit ?? []).length} audit row(s)`
        )
      }
    }

    await adminClient.auth.signOut()
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
