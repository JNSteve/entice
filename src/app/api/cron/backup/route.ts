import { NextResponse } from 'next/server'
import { gzipSync } from 'node:zlib'
import { timingSafeEqual } from 'node:crypto'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import {
  BACKUP_BUCKET,
  EXPORT_PREFIX,
  MANIFEST_KEY,
  MIRROR_CAP_BYTES,
  RETENTION_DAYS,
  backupExportKey,
  isExpiredExport,
  manifestDiff,
  mirrorKey,
  planMirror,
  type StorageManifestObject,
} from '@/lib/backup'

export const runtime = 'nodejs'
// Fluid compute allows long invocations on Hobby; the export of the current
// dataset takes seconds, but the storage mirror can take longer on big days.
export const maxDuration = 300

/**
 * Daily off-DB backup (ISO 7.5.3.2 — records protected from loss).
 *
 * GET  — Vercel cron (vercel.json, 0 17 * * * UTC = 3 am Brisbane). Vercel
 *        sends `Authorization: Bearer ${CRON_SECRET}` automatically when the
 *        CRON_SECRET env var exists on the project.
 * POST — "Run backup now" from an authenticated ADMIN session (Settings →
 *        Backups), or the same bearer secret for scripted manual runs.
 *
 * The job (service role — SUPABASE_SERVICE_ROLE_KEY, server-only):
 *   1. Export EVERY public table (discovered at runtime via the
 *      backup_list_tables RPC, paginated 1000 rows a page) plus a manifest
 *      of all attachments/branding storage objects into one gzipped JSON at
 *      backups/db/YYYY-MM-DD-HHmm.json.gz (Brisbane stamp).
 *   2. Mirror storage blobs new/changed vs the last manifest into
 *      backups/storage/<bucket>/<path> (capped at 500 MB per run — skips
 *      are recorded in the export and the run row).
 *   3. Prune exports older than 35 days.
 *   4. Record the run in backup_runs (success or failed + error).
 *
 * /api/* is excluded from the auth proxy, so this route enforces its own
 * auth (same pattern as /api/kpi/refresh).
 */

const PAGE_SIZE = 1000

function bearerOk(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!bearerOk(request)) return new Response('Unauthorized', { status: 401 })
  return runBackup('cron', null)
}

export async function POST(request: Request) {
  if (bearerOk(request)) return runBackup('manual', null)

  const profile = await getProfile()
  if (!profile) return new Response('Unauthorized', { status: 401 })
  if (profile.role !== 'admin') return new Response('Forbidden', { status: 403 })
  return runBackup('manual', profile.id)
}

async function runBackup(
  trigger: 'cron' | 'manual',
  createdBy: string | null
): Promise<NextResponse> {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      {
        error:
          'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment — backups cannot run until it is added to the environment.',
      },
      { status: 503 }
    )
  }

  // Open the run row first so a mid-flight crash still leaves a trace.
  const { data: run, error: runInsertError } = await admin
    .from('backup_runs')
    .insert({ trigger, created_by: createdBy })
    .select('id, started_at')
    .single()
  if (runInsertError || !run) {
    return NextResponse.json(
      { error: `Could not open backup run: ${runInsertError?.message}` },
      { status: 500 }
    )
  }

  try {
    // ── 1. Export every public table (runtime discovery, 1000-row pages) ──
    const { data: tableList, error: tablesError } = await admin.rpc(
      'backup_list_tables'
    )
    if (tablesError) throw new Error(`backup_list_tables: ${tablesError.message}`)
    const tables = (tableList ?? []) as { table_name: string; order_col: string }[]
    if (tables.length === 0) throw new Error('backup_list_tables returned no tables')

    const exportTables: Record<string, unknown[]> = {}
    const rowCounts: Record<string, number> = {}
    let rowsTotal = 0

    for (const { table_name, order_col } of tables) {
      const rows: unknown[] = []
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await admin
          .from(table_name)
          .select('*')
          .order(order_col, { ascending: true })
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(`export ${table_name}: ${error.message}`)
        rows.push(...(data ?? []))
        if (!data || data.length < PAGE_SIZE) break
      }
      exportTables[table_name] = rows
      rowCounts[table_name] = rows.length
      rowsTotal += rows.length
    }

    // ── 2. Storage manifest + incremental blob mirror ─────────────────────
    const { data: manifestRows, error: manifestError } = await admin.rpc(
      'backup_storage_manifest'
    )
    if (manifestError)
      throw new Error(`backup_storage_manifest: ${manifestError.message}`)
    const manifest: StorageManifestObject[] = (
      (manifestRows ?? []) as StorageManifestObject[]
    ).map((o) => ({ ...o, size: Number(o.size) }))

    let prevManifest: StorageManifestObject[] = []
    const { data: prevBlob } = await admin.storage
      .from(BACKUP_BUCKET)
      .download(MANIFEST_KEY)
    if (prevBlob) {
      try {
        const parsed = JSON.parse(await prevBlob.text()) as {
          objects?: StorageManifestObject[]
        }
        prevManifest = parsed.objects ?? []
      } catch {
        // Unreadable previous manifest → mirror everything again (safe).
      }
    }

    const { copy, skipped } = planMirror(
      manifestDiff(prevManifest, manifest),
      MIRROR_CAP_BYTES
    )
    let mirroredBytes = 0
    let mirroredCount = 0
    const copyFailures: string[] = []
    for (const obj of copy) {
      const dest = mirrorKey(obj)
      let { error } = await admin.storage
        .from(obj.bucket)
        .copy(obj.name, dest, { destinationBucket: BACKUP_BUCKET })
      if (error && /exist|duplicate/i.test(error.message)) {
        // Changed blob already mirrored once — replace it.
        await admin.storage.from(BACKUP_BUCKET).remove([dest])
        ;({ error } = await admin.storage
          .from(obj.bucket)
          .copy(obj.name, dest, { destinationBucket: BACKUP_BUCKET }))
      }
      if (error) {
        copyFailures.push(`${obj.bucket}/${obj.name}: ${error.message}`)
      } else {
        mirroredCount += 1
        mirroredBytes += obj.size
      }
    }
    if (skipped.length > 0) {
      console.warn(
        `[backup] mirror cap (${MIRROR_CAP_BYTES} bytes) reached — skipped ${skipped.length} object(s):`,
        skipped.map((o) => `${o.bucket}/${o.name}`).join(', ')
      )
    }

    // ── 3. Build + upload the gzipped export ──────────────────────────────
    const exportKey = backupExportKey()
    const payload = {
      app: 'entice',
      format_version: 2,
      exported_at: new Date().toISOString(),
      trigger,
      note:
        'Full service-role export of every public table (runtime discovery) ' +
        'plus a manifest of all storage objects in attachments/branding. ' +
        'Blobs new/changed since the previous run are mirrored under ' +
        'storage/<bucket>/<path> in the backups bucket (500 MB/run cap). ' +
        `Exports are pruned after ${RETENTION_DAYS} days.`,
      row_counts: rowCounts,
      storage_manifest: manifest,
      storage_mirror: {
        copied: mirroredCount,
        bytes: mirroredBytes,
        skipped_over_cap: skipped.map((o) => `${o.bucket}/${o.name}`),
        failures: copyFailures,
      },
      tables: exportTables,
    }
    const gz = gzipSync(Buffer.from(JSON.stringify(payload)))

    const { error: uploadError } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(exportKey, gz, { contentType: 'application/gzip', upsert: true })
    if (uploadError) throw new Error(`upload ${exportKey}: ${uploadError.message}`)

    const { error: manifestUploadError } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(
        MANIFEST_KEY,
        Buffer.from(
          JSON.stringify({ generated_at: new Date().toISOString(), objects: manifest })
        ),
        { contentType: 'application/json', upsert: true }
      )
    if (manifestUploadError)
      throw new Error(`upload ${MANIFEST_KEY}: ${manifestUploadError.message}`)

    // ── 4. Prune exports past retention ───────────────────────────────────
    let pruned = 0
    const { data: existing } = await admin.storage
      .from(BACKUP_BUCKET)
      .list(EXPORT_PREFIX, { limit: 1000 })
    const expired = (existing ?? [])
      .filter((f) => isExpiredExport(f.name))
      .map((f) => `${EXPORT_PREFIX}/${f.name}`)
    if (expired.length > 0) {
      const { error: pruneError } = await admin.storage
        .from(BACKUP_BUCKET)
        .remove(expired)
      if (pruneError) {
        console.warn(`[backup] prune failed: ${pruneError.message}`)
      } else {
        pruned = expired.length
      }
    }

    // ── 5. Close the run ──────────────────────────────────────────────────
    const summary = {
      tables_count: tables.length,
      rows_total: rowsTotal,
      storage_objects_count: manifest.length,
      storage_bytes_mirrored: mirroredBytes,
      export_bytes: gz.byteLength,
      path: exportKey,
    }
    const { error: closeError } = await admin
      .from('backup_runs')
      .update({
        ...summary,
        status: 'success',
        finished_at: new Date().toISOString(),
        error:
          copyFailures.length > 0
            ? `mirror failures: ${copyFailures.join('; ')}`.slice(0, 2000)
            : null,
      })
      .eq('id', run.id)
    if (closeError) throw new Error(`close run: ${closeError.message}`)

    return NextResponse.json({
      ok: true,
      run_id: run.id,
      trigger,
      ...summary,
      mirrored_objects: mirroredCount,
      mirror_skipped_over_cap: skipped.length,
      pruned_exports: pruned,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await admin
      .from('backup_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: message.slice(0, 2000),
      })
      .eq('id', run.id)
    console.error('[backup] run failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
