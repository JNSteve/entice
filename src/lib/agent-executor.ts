import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AGENT_HELP,
  FORBIDDEN_WRITE_TABLES,
  STORAGE_BUCKETS,
  UPLOAD_MAX_BYTES,
  UPLOAD_STAGING_BUCKET,
  UPLOAD_TOTAL_MAX_BYTES,
  agentEnvelopeSchema,
  auditParams,
  formatEnvelopeIssues,
  hashAgentKey,
  isValidStoragePath,
  validateSelectSql,
  type AgentEnvelope,
  type AgentFilter,
} from '@/lib/agent-api'
import { PARENT_TABLE } from '@/lib/attachment-parents'

/**
 * Agent API — server executor. Runs a validated envelope against the service
 * role client (bypasses RLS by design: the bearer key IS the permission).
 * Shared by the REST route (/api/agent) and the MCP route (/api/agent/mcp).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>

export type AgentKeyRow = { id: string; name: string }

export type AgentResult = {
  /** JSON payload returned to the caller. */
  result: Record<string, unknown>
  /** Row count recorded in the audit log (null when not row-shaped). */
  rowCount: number | null
  /** Audit target — table, function or bucket/path. */
  target: string | null
}

export class AgentApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * Auth outcome. `unknown_key` is a definitive 401 (bad/revoked/absent key);
 * `db_error` is a transient backend failure that must NOT read as revocation,
 * so the caller returns 503 and the human doesn't discard a good key.
 */
export type AuthResult =
  | { outcome: 'authenticated'; key: AgentKeyRow }
  | { outcome: 'unknown_key' }
  | { outcome: 'db_error'; message: string }

/**
 * Resolve the bearer token to an active key. Looked up by SHA-256 hash — the
 * plaintext never touches the database — and stamped in the same round-trip:
 * a single UPDATE … WHERE key_hash=? AND revoked_at IS NULL RETURNING both
 * authenticates and refreshes last_used_at (no separate SELECT+UPDATE, and no
 * write on the hot path when the key doesn't match).
 */
export async function authenticateAgentKey(
  admin: Admin,
  request: Request
): Promise<AuthResult> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) return { outcome: 'unknown_key' }
  const hash = hashAgentKey(match[1].trim())
  const { data, error } = await admin
    .from('agent_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', hash)
    .is('revoked_at', null)
    // OAuth access tokens are agent_keys rows with an expiry; static keys have
    // expires_at NULL and never age out.
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .select('id, name')
    .maybeSingle()
  if (error) return { outcome: 'db_error', message: error.message }
  if (!data) return { outcome: 'unknown_key' }
  return { outcome: 'authenticated', key: data as AgentKeyRow }
}

/** Append the call to agent_audit. Best-effort: log loudly, never throw. */
export async function auditAgentCall(
  admin: Admin,
  entry: {
    keyId: string | null
    action: string
    target: string | null
    envelope: Record<string, unknown> | null
    rowCount: number | null
    ok: boolean
    error: string | null
    request: Request
    startedAt: number
  }
): Promise<void> {
  const { error } = await admin.from('agent_audit').insert({
    key_id: entry.keyId,
    action: entry.action,
    target: entry.target,
    params: entry.envelope ? auditParams(entry.envelope) : null,
    row_count: entry.rowCount,
    ok: entry.ok,
    error: entry.error ? entry.error.slice(0, 2000) : null,
    ip: entry.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    user_agent: entry.request.headers.get('user-agent')?.slice(0, 500) ?? null,
    duration_ms: Math.round(performance.now() - entry.startedAt),
  })
  if (error) {
    // The action has already committed; this row is its only trace, so log
    // enough to reconstruct it from the server console if the insert failed.
    console.error(
      `[agent] AUDIT INSERT FAILED — unlogged ${entry.ok ? 'ok' : 'failed'} ` +
        `action=${entry.action} target=${entry.target ?? '-'} key=${entry.keyId ?? '-'} ` +
        `rows=${entry.rowCount ?? '-'}: ${error.message}`
    )
  }
}

function requireWritableTable(table: string): void {
  if (FORBIDDEN_WRITE_TABLES.has(table)) {
    throw new AgentApiError(`table '${table}' is write-protected on this API`)
  }
}

function requireAllowedBucket(bucket: string): void {
  if (!STORAGE_BUCKETS.has(bucket)) {
    throw new AgentApiError(
      `bucket '${bucket}' is not accessible; allowed: ${[...STORAGE_BUCKETS].join(', ')}`
    )
  }
}

/** Staging object key for one part — zero-padded so listings sort naturally. */
function partKey(uploadId: string, partNumber: number): string {
  return `${uploadId}/${String(partNumber).padStart(5, '0')}.part`
}

/**
 * Decode base64 strictly. Buffer.from is lenient (it drops invalid characters
 * instead of throwing), which would stage silently truncated bytes.
 */
function decodeBase64Strict(value: string, label: string): Buffer {
  const normalized = value.replace(/\s/g, '')
  const bytes = Buffer.from(normalized, 'base64')
  if (bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, ''))
    throw new AgentApiError(`${label}: content_base64 is not valid base64`)
  if (bytes.byteLength === 0) throw new AgentApiError(`${label}: empty content`)
  return bytes
}

type UploadRow = {
  id: string
  bucket: string
  path: string
  content_type: string | null
  upsert: boolean
  parent_type: string | null
  parent_id: string | null
  kind: string | null
  caption: string | null
  client_visible: boolean
  status: string
  bytes_received: number
  expires_at: string
}

/** Fetch an upload session that is still open and unexpired. */
async function openUpload(admin: Admin, uploadId: string): Promise<UploadRow> {
  const { data, error } = await admin
    .from('agent_uploads')
    .select(
      'id, bucket, path, content_type, upsert, parent_type, parent_id, kind, caption, client_visible, status, bytes_received, expires_at'
    )
    .eq('id', uploadId)
    .maybeSingle()
  if (error) throwDb('upload lookup', error.message)
  if (!data) throw new AgentApiError('unknown upload_id')
  const row = data as UploadRow
  if (row.status !== 'open')
    throw new AgentApiError(`upload is already ${row.status}`)
  if (new Date(row.expires_at).getTime() < Date.now())
    throw new AgentApiError('upload session has expired — start a new one')
  return row
}

/**
 * Apply the validated filter list to a PostgREST filter builder. The builder
 * generics fight structural typing on a schemaless client, so this works on
 * the method surface dynamically — every op name was validated by zod.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(builder: any, filters: AgentFilter[]): any {
  let q = builder
  for (const f of filters) {
    switch (f.op) {
      case 'in':
        q = q.in(f.column, f.value as unknown[])
        break
      case 'is':
        q = q.is(f.column, f.value as boolean | null)
        break
      default:
        q = q[f.op](f.column, f.value)
    }
  }
  return q
}

function throwDb(prefix: string, message: string): never {
  throw new AgentApiError(`${prefix}: ${message}`, 500)
}

const SCHEMA_ALL_SQL = `
  select c.table_name, jsonb_agg(c.column_name order by c.ordinal_position) as columns
  from information_schema.columns c
  where c.table_schema = 'public'
  group by c.table_name
  order by c.table_name`

function schemaTableSql(table: string): string {
  // table already validated against the identifier regex — no quoting risk.
  return `
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = '${table}'
    order by ordinal_position`
}

async function runAgentSelect(
  admin: Admin,
  query: string
): Promise<{ rows: unknown[]; truncated: boolean }> {
  const { data, error } = await admin.rpc('agent_select', { q: query })
  if (error) throwDb('sql', error.message)
  return data as { rows: unknown[]; truncated: boolean }
}

/** Execute one validated envelope. Throws AgentApiError on failure. */
export async function executeAgentAction(
  admin: Admin,
  envelope: AgentEnvelope
): Promise<AgentResult> {
  switch (envelope.action) {
    case 'help':
      return { result: { help: AGENT_HELP }, rowCount: null, target: null }

    case 'schema': {
      if (envelope.table) {
        const { rows } = await runAgentSelect(admin, schemaTableSql(envelope.table))
        if (rows.length === 0)
          throw new AgentApiError(`schema: table '${envelope.table}' not found`)
        return {
          result: { table: envelope.table, columns: rows },
          rowCount: rows.length,
          target: envelope.table,
        }
      }
      const { rows } = await runAgentSelect(admin, SCHEMA_ALL_SQL)
      return { result: { tables: rows }, rowCount: rows.length, target: null }
    }

    case 'sql': {
      const checked = validateSelectSql(envelope.query)
      if (!checked.ok) throw new AgentApiError(checked.error)
      const { rows, truncated } = await runAgentSelect(admin, checked.cleaned)
      return {
        result: { rows, truncated, row_count: rows.length },
        rowCount: rows.length,
        target: null,
      }
    }

    case 'insert': {
      requireWritableTable(envelope.table)
      const wantRows = envelope.returning !== false
      const base = admin
        .from(envelope.table)
        .insert(envelope.rows, { count: 'exact' })
      const { data, error, count } = wantRows ? await base.select('*') : await base
      if (error) throwDb(`insert into ${envelope.table}`, error.message)
      const rows = (data ?? []) as unknown[]
      const n = count ?? rows.length
      return {
        result: wantRows ? { inserted: n, rows } : { inserted: n },
        rowCount: n,
        target: envelope.table,
      }
    }

    case 'update': {
      requireWritableTable(envelope.table)
      const wantRows = envelope.returning !== false
      const base = applyFilters(
        admin.from(envelope.table).update(envelope.values, { count: 'exact' }),
        envelope.filters
      )
      const { data, error, count } = wantRows ? await base.select('*') : await base
      if (error) throwDb(`update ${envelope.table}`, error.message)
      const rows = (data ?? []) as unknown[]
      const n = count ?? rows.length
      return {
        result: wantRows ? { updated: n, rows } : { updated: n },
        rowCount: n,
        target: envelope.table,
      }
    }

    case 'delete': {
      requireWritableTable(envelope.table)
      const base = applyFilters(
        admin.from(envelope.table).delete({ count: 'exact' }),
        envelope.filters
      )
      const { data, error, count } = await base.select('*')
      if (error) throwDb(`delete from ${envelope.table}`, error.message)
      const rows = (data ?? []) as unknown[]
      const n = count ?? rows.length
      return {
        result: { deleted: n, rows },
        rowCount: n,
        target: envelope.table,
      }
    }

    case 'rpc': {
      const { data, error } = await admin.rpc(envelope.fn, envelope.args ?? {})
      if (error) throwDb(`rpc ${envelope.fn}`, error.message)
      const rowCount = Array.isArray(data) ? data.length : data == null ? 0 : 1
      return { result: { data: data as unknown }, rowCount, target: envelope.fn }
    }

    case 'storage_list': {
      requireAllowedBucket(envelope.bucket)
      if (envelope.prefix && !isValidStoragePath(envelope.prefix))
        throw new AgentApiError('storage_list: invalid prefix')
      const { data, error } = await admin.storage
        .from(envelope.bucket)
        .list(envelope.prefix ?? '', {
          limit: envelope.limit ?? 100,
          sortBy: { column: 'name', order: 'asc' },
        })
      if (error) throwDb(`storage_list ${envelope.bucket}`, error.message)
      const objects = (data ?? []).map((o) => ({
        name: o.name,
        size: o.metadata?.size ?? null,
        updated_at: o.updated_at ?? null,
      }))
      return {
        result: { objects },
        rowCount: objects.length,
        target: `${envelope.bucket}/${envelope.prefix ?? ''}`,
      }
    }

    case 'storage_sign': {
      requireAllowedBucket(envelope.bucket)
      if (!isValidStoragePath(envelope.path))
        throw new AgentApiError('storage_sign: invalid path')
      const expiresIn = envelope.expires_in ?? 3600
      const { data, error } = await admin.storage
        .from(envelope.bucket)
        .createSignedUrl(envelope.path, expiresIn)
      if (error) throwDb(`storage_sign ${envelope.bucket}/${envelope.path}`, error.message)
      return {
        result: { url: data.signedUrl, expires_in: expiresIn },
        rowCount: 1,
        target: `${envelope.bucket}/${envelope.path}`,
      }
    }

    case 'storage_upload': {
      requireAllowedBucket(envelope.bucket)
      if (!isValidStoragePath(envelope.path))
        throw new AgentApiError('storage_upload: invalid path')
      // Buffer.from(base64) is lenient — it silently drops invalid characters
      // rather than throwing, which would upload a truncated file under a
      // "success". Reject anything that doesn't round-trip cleanly.
      const normalized = envelope.content_base64.replace(/\s/g, '')
      const bytes = Buffer.from(normalized, 'base64')
      if (bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, ''))
        throw new AgentApiError('storage_upload: content_base64 is not valid base64')
      if (bytes.byteLength === 0)
        throw new AgentApiError('storage_upload: empty content')
      if (bytes.byteLength > UPLOAD_MAX_BYTES)
        throw new AgentApiError(
          `storage_upload: ${bytes.byteLength} bytes exceeds the ${UPLOAD_MAX_BYTES} byte cap`
        )
      const { error } = await admin.storage
        .from(envelope.bucket)
        .upload(envelope.path, bytes, {
          contentType: envelope.content_type ?? 'application/octet-stream',
          upsert: envelope.upsert ?? false,
        })
      if (error) throwDb(`storage_upload ${envelope.bucket}/${envelope.path}`, error.message)
      return {
        result: { uploaded: `${envelope.bucket}/${envelope.path}`, bytes: bytes.byteLength },
        rowCount: 1,
        target: `${envelope.bucket}/${envelope.path}`,
      }
    }

    case 'storage_upload_begin': {
      requireAllowedBucket(envelope.bucket)
      if (!isValidStoragePath(envelope.path))
        throw new AgentApiError('storage_upload_begin: invalid path')
      if ((envelope.parent_type && !envelope.parent_id) || (!envelope.parent_type && envelope.parent_id))
        throw new AgentApiError(
          'storage_upload_begin: parent_type and parent_id must be given together'
        )
      if (envelope.parent_type && envelope.parent_id) {
        // Same guarantee recordAttachment gives: never file against a parent
        // that does not exist.
        const table = PARENT_TABLE[envelope.parent_type]
        const { data: parent, error: parentError } = await admin
          .from(table)
          .select('id')
          .eq('id', envelope.parent_id)
          .maybeSingle()
        if (parentError) throwDb('storage_upload_begin', parentError.message)
        if (!parent)
          throw new AgentApiError(
            `storage_upload_begin: no ${envelope.parent_type} with id ${envelope.parent_id}`
          )
      }

      // Opportunistic sweep of abandoned sessions (cheap, keeps staging tidy).
      await admin
        .from('agent_uploads')
        .update({ status: 'aborted' })
        .eq('status', 'open')
        .lt('expires_at', new Date().toISOString())

      const { data, error } = await admin
        .from('agent_uploads')
        .insert({
          bucket: envelope.bucket,
          path: envelope.path,
          content_type: envelope.content_type ?? null,
          upsert: envelope.upsert ?? false,
          parent_type: envelope.parent_type ?? null,
          parent_id: envelope.parent_id ?? null,
          kind: envelope.kind ?? null,
          caption: envelope.caption ?? null,
          client_visible: envelope.client_visible ?? false,
        })
        .select('id, expires_at')
        .single()
      if (error) throwDb('storage_upload_begin', error.message)

      return {
        result: {
          upload_id: data.id,
          part_max_bytes: UPLOAD_MAX_BYTES,
          total_max_bytes: UPLOAD_TOTAL_MAX_BYTES,
          expires_at: data.expires_at,
          next: 'Send parts with storage_upload_part, then storage_upload_finish.',
        },
        rowCount: 1,
        target: `${envelope.bucket}/${envelope.path}`,
      }
    }

    case 'storage_upload_part': {
      const upload = await openUpload(admin, envelope.upload_id)
      const bytes = decodeBase64Strict(envelope.content_base64, 'storage_upload_part')
      if (bytes.byteLength > UPLOAD_MAX_BYTES)
        throw new AgentApiError(
          `storage_upload_part: part is ${bytes.byteLength} bytes, over the ${UPLOAD_MAX_BYTES} byte part limit`
        )
      if (Number(upload.bytes_received) + bytes.byteLength > UPLOAD_TOTAL_MAX_BYTES)
        throw new AgentApiError(
          `storage_upload_part: upload would exceed the ${UPLOAD_TOTAL_MAX_BYTES} byte total limit`
        )

      const key = partKey(envelope.upload_id, envelope.part_number)
      const { error: upErr } = await admin.storage
        .from(UPLOAD_STAGING_BUCKET)
        .upload(key, bytes, { contentType: 'application/octet-stream', upsert: true })
      if (upErr) throwDb('storage_upload_part', upErr.message)

      // Upsert the part row so a retried part replaces rather than duplicates.
      const { error: partErr } = await admin
        .from('agent_upload_parts')
        .upsert(
          {
            upload_id: envelope.upload_id,
            part_number: envelope.part_number,
            size_bytes: bytes.byteLength,
          },
          { onConflict: 'upload_id,part_number' }
        )
      if (partErr) throwDb('storage_upload_part', partErr.message)

      // Recompute from the parts table rather than incrementing, so a resent
      // part cannot double-count the total.
      const { data: parts, error: sumErr } = await admin
        .from('agent_upload_parts')
        .select('size_bytes')
        .eq('upload_id', envelope.upload_id)
      if (sumErr) throwDb('storage_upload_part', sumErr.message)
      const received = (parts ?? []).reduce(
        (n: number, p: { size_bytes: number }) => n + p.size_bytes,
        0
      )
      await admin
        .from('agent_uploads')
        .update({ bytes_received: received })
        .eq('id', envelope.upload_id)

      return {
        result: {
          upload_id: envelope.upload_id,
          part_number: envelope.part_number,
          part_bytes: bytes.byteLength,
          parts_received: (parts ?? []).length,
          bytes_received: received,
        },
        rowCount: 1,
        target: `${upload.bucket}/${upload.path}`,
      }
    }

    case 'storage_upload_finish': {
      const upload = await openUpload(admin, envelope.upload_id)

      const { data: parts, error: partsErr } = await admin
        .from('agent_upload_parts')
        .select('part_number, size_bytes')
        .eq('upload_id', envelope.upload_id)
        .order('part_number', { ascending: true })
      if (partsErr) throwDb('storage_upload_finish', partsErr.message)
      const list = (parts ?? []) as { part_number: number; size_bytes: number }[]

      if (list.length !== envelope.total_parts)
        throw new AgentApiError(
          `storage_upload_finish: expected ${envelope.total_parts} parts, have ${list.length}`
        )
      // Contiguity: 1..N with no gaps (the PK already rules out duplicates).
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].part_number !== i + 1)
          throw new AgentApiError(
            `storage_upload_finish: missing part ${i + 1} (parts must be 1..${envelope.total_parts})`
          )
      }

      // Reassemble in order.
      const chunks: Buffer[] = []
      for (const p of list) {
        const { data: blob, error: dlErr } = await admin.storage
          .from(UPLOAD_STAGING_BUCKET)
          .download(partKey(envelope.upload_id, p.part_number))
        if (dlErr || !blob)
          throwDb('storage_upload_finish', `part ${p.part_number}: ${dlErr?.message ?? 'missing'}`)
        chunks.push(Buffer.from(await blob.arrayBuffer()))
      }
      const assembled = Buffer.concat(chunks)

      if (envelope.sha256) {
        const actual = createHash('sha256').update(assembled).digest('hex')
        if (actual.toLowerCase() !== envelope.sha256.toLowerCase()) {
          throw new AgentApiError(
            `storage_upload_finish: sha256 mismatch — expected ${envelope.sha256.toLowerCase()}, assembled ${actual}. Nothing was published.`
          )
        }
      }

      const { error: pubErr } = await admin.storage
        .from(upload.bucket)
        .upload(upload.path, assembled, {
          contentType: upload.content_type ?? 'application/octet-stream',
          upsert: upload.upsert,
        })
      if (pubErr) throwDb(`storage_upload_finish ${upload.bucket}/${upload.path}`, pubErr.message)

      // Optionally file it so it shows up in the record's Documents.
      let attachmentId: string | null = null
      if (upload.parent_type && upload.parent_id) {
        const filename = upload.path.split('/').pop() ?? upload.path
        const { data: att, error: attErr } = await admin
          .from('attachments')
          .insert({
            parent_type: upload.parent_type,
            parent_id: upload.parent_id,
            bucket: upload.bucket,
            path: upload.path,
            filename,
            content_type: upload.content_type ?? 'application/octet-stream',
            size: assembled.byteLength,
            kind: upload.kind ?? 'document',
            caption: upload.caption,
            client_visible: upload.client_visible,
          })
          .select('id')
          .single()
        if (attErr) throwDb('storage_upload_finish (attachment)', attErr.message)
        attachmentId = att.id as string
      }

      // Clear staging, then close the session.
      await admin.storage
        .from(UPLOAD_STAGING_BUCKET)
        .remove(list.map((p) => partKey(envelope.upload_id, p.part_number)))
      await admin
        .from('agent_uploads')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          final_bytes: assembled.byteLength,
        })
        .eq('id', envelope.upload_id)

      return {
        result: {
          uploaded: `${upload.bucket}/${upload.path}`,
          bytes: assembled.byteLength,
          parts: list.length,
          sha256_verified: Boolean(envelope.sha256),
          attachment_id: attachmentId,
          filed_against: upload.parent_type ? `${upload.parent_type}:${upload.parent_id}` : null,
        },
        rowCount: 1,
        target: `${upload.bucket}/${upload.path}`,
      }
    }

    case 'storage_upload_abort': {
      const { data: upload, error } = await admin
        .from('agent_uploads')
        .select('id, bucket, path, status')
        .eq('id', envelope.upload_id)
        .maybeSingle()
      if (error) throwDb('storage_upload_abort', error.message)
      if (!upload) throw new AgentApiError('storage_upload_abort: unknown upload_id')

      const { data: parts } = await admin
        .from('agent_upload_parts')
        .select('part_number')
        .eq('upload_id', envelope.upload_id)
      const keys = ((parts ?? []) as { part_number: number }[]).map((p) =>
        partKey(envelope.upload_id, p.part_number)
      )
      if (keys.length > 0)
        await admin.storage.from(UPLOAD_STAGING_BUCKET).remove(keys)
      await admin
        .from('agent_uploads')
        .update({ status: 'aborted' })
        .eq('id', envelope.upload_id)

      return {
        result: { aborted: envelope.upload_id, parts_discarded: keys.length },
        rowCount: 1,
        target: `${upload.bucket}/${upload.path}`,
      }
    }
  }
}

export type RunOutcome =
  | { ok: true; action: string; result: Record<string, unknown> }
  | { ok: false; action: string; error: string; status: number }

/**
 * Validate → dispatch → audit for one raw envelope. The single pipeline both
 * surfaces (REST and MCP) call, so their auth/validation/audit behaviour can't
 * drift; each route only adapts request/response shape. Every outcome —
 * including a validation failure — is written to agent_audit.
 */
export async function runAgentRequest(
  admin: Admin,
  key: AgentKeyRow,
  rawEnvelope: unknown,
  request: Request,
  startedAt: number
): Promise<RunOutcome> {
  const guessedAction =
    typeof rawEnvelope === 'object' && rawEnvelope !== null && 'action' in rawEnvelope
      ? String((rawEnvelope as { action: unknown }).action)
      : 'invalid'

  const parsed = agentEnvelopeSchema.safeParse(rawEnvelope)
  if (!parsed.success) {
    const detail = formatEnvelopeIssues(parsed.error)
    await auditAgentCall(admin, {
      keyId: key.id,
      action: guessedAction,
      target: null,
      envelope:
        typeof rawEnvelope === 'object' && rawEnvelope !== null
          ? (rawEnvelope as Record<string, unknown>)
          : null,
      rowCount: null,
      ok: false,
      error: detail,
      request,
      startedAt,
    })
    return { ok: false, action: guessedAction, error: detail, status: 400 }
  }

  const envelope = parsed.data
  try {
    const { result, rowCount, target } = await executeAgentAction(admin, envelope)
    await auditAgentCall(admin, {
      keyId: key.id,
      action: envelope.action,
      target,
      envelope,
      rowCount,
      ok: true,
      error: null,
      request,
      startedAt,
    })
    return { ok: true, action: envelope.action, result }
  } catch (err) {
    const status = err instanceof AgentApiError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    await auditAgentCall(admin, {
      keyId: key.id,
      action: envelope.action,
      target: null,
      envelope,
      rowCount: null,
      ok: false,
      error: message,
      request,
      startedAt,
    })
    return { ok: false, action: envelope.action, error: message, status }
  }
}
