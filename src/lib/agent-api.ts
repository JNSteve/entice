import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * Agent API — pure layer (validation, envelope schemas, self-documentation).
 *
 * The agent API lets the owner's Claude sessions (Cowork, claude.ai, Claude
 * Code) read and write portal data remotely over two surfaces that share this
 * core: REST at POST /api/agent and MCP at /api/agent/mcp. The bearer key is
 * the perimeter — it holds full data-plane read/write via the service role —
 * so the guardrails here exist to stop agent *mistakes* (filterless updates,
 * DDL, writes to the key/audit tables), not to constrain the key holder.
 * Design: docs/superpowers/specs/2026-08-29-agent-api-design.md
 */

/** SHA-256 hex of a bearer token — the only form a key is stored in. */
export function hashAgentKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Tables the write actions must never touch (key minting / audit tamper). */
export const FORBIDDEN_WRITE_TABLES = new Set(['agent_keys', 'agent_audit'])

/** Buckets the storage actions may touch — the app's only three buckets. */
export const STORAGE_BUCKETS = new Set(['attachments', 'branding', 'backups'])

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/
const BUCKET = /^[a-zA-Z0-9_-]{1,100}$/

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER.test(name)
}

/**
 * Max decoded bytes for storage_upload. Vercel caps a serverless request body
 * at ~4.5 MB, and base64 inflates ~33%, so a 3 MB decoded ceiling keeps the
 * request under the platform limit (bigger uploads should use a signed URL).
 */
export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024

/**
 * Client-side mirror of the agent_select() checks so obvious mistakes fail
 * fast with a clear message. The real wall is in the database: the query is
 * executed wrapped in `select … from (<q>) limit N`, which makes DDL/DML
 * syntactically impossible, and Postgres rejects data-modifying CTEs below
 * the top level.
 */
export function validateSelectSql(q: string): { ok: true; cleaned: string } | { ok: false; error: string } {
  let cleaned = q.trim().replace(/;\s*$/, '')
  cleaned = cleaned.trim()
  if (cleaned === '') return { ok: false, error: 'sql: empty query' }
  if (cleaned.includes(';'))
    return { ok: false, error: 'sql: only a single statement is allowed' }
  if (!/^(select|with)\b/i.test(cleaned))
    return { ok: false, error: 'sql: only SELECT queries are allowed (writes go through insert/update/delete)' }
  return { ok: true, cleaned }
}

export const FILTER_OPS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is',
] as const
export type FilterOp = (typeof FILTER_OPS)[number]

const scalar = z.union([z.string(), z.number(), z.boolean()])

const filterSchema = z
  .object({
    column: z.string().regex(IDENTIFIER, 'invalid column name'),
    op: z.enum(FILTER_OPS),
    value: z.unknown().optional(),
  })
  .superRefine((f, ctx) => {
    if (f.op === 'in') {
      if (!Array.isArray(f.value) || f.value.length === 0)
        ctx.addIssue({ code: 'custom', message: "op 'in' needs a non-empty array value" })
      else if (!f.value.every((v) => scalar.safeParse(v).success))
        ctx.addIssue({ code: 'custom', message: "op 'in' array elements must be string/number/boolean" })
    } else if (f.op === 'is') {
      if (f.value !== null && typeof f.value !== 'boolean')
        ctx.addIssue({ code: 'custom', message: "op 'is' takes null, true or false" })
    } else if (!scalar.safeParse(f.value).success) {
      ctx.addIssue({ code: 'custom', message: `op '${f.op}' needs a string/number/boolean value` })
    }
  })
export type AgentFilter = z.infer<typeof filterSchema>

const tableName = z.string().regex(IDENTIFIER, 'invalid table name')
const rowObject = z.record(z.string(), z.unknown())
/** A row/patch that actually sets at least one column (an empty {} 500s). */
const nonEmptyRow = rowObject.refine(
  (r) => Object.keys(r).length > 0,
  'must set at least one column'
)

export const agentEnvelopeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('help') }),
  z.object({
    action: z.literal('schema'),
    table: tableName.optional(),
  }),
  z.object({
    action: z.literal('sql'),
    query: z.string().min(1),
  }),
  z.object({
    action: z.literal('insert'),
    table: tableName,
    rows: z.array(nonEmptyRow).min(1).max(500),
    returning: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('update'),
    table: tableName,
    filters: z.array(filterSchema).min(1, 'update requires at least one filter'),
    values: nonEmptyRow,
    returning: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('delete'),
    table: tableName,
    filters: z.array(filterSchema).min(1, 'delete requires at least one filter'),
    confirm: z.literal(true, "delete requires confirm: true"),
  }),
  z.object({
    action: z.literal('rpc'),
    fn: z.string().regex(IDENTIFIER, 'invalid function name'),
    args: rowObject.optional(),
  }),
  z.object({
    action: z.literal('storage_list'),
    bucket: z.string().regex(BUCKET, 'invalid bucket name'),
    prefix: z.string().max(1024).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  z.object({
    action: z.literal('storage_sign'),
    bucket: z.string().regex(BUCKET, 'invalid bucket name'),
    path: z.string().min(1).max(1024),
    expires_in: z.number().int().min(60).max(604800).optional(),
  }),
  z.object({
    action: z.literal('storage_upload'),
    bucket: z.string().regex(BUCKET, 'invalid bucket name'),
    path: z.string().min(1).max(1024),
    content_base64: z.string().min(1),
    content_type: z.string().max(255).optional(),
    upsert: z.boolean().optional(),
  }),
])
export type AgentEnvelope = z.infer<typeof agentEnvelopeSchema>
export type AgentAction = AgentEnvelope['action']

/** Storage paths may not traverse. */
export function isValidStoragePath(path: string): boolean {
  return !path.includes('..') && !path.startsWith('/') && path.trim() === path
}

/** Decoded byte length of a base64 string, accounting for `=` padding. */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

/**
 * Drop any unpaired UTF-16 surrogate. A lone surrogate survives JSON.stringify
 * as a \udXXX escape that Postgres jsonb rejects — which would make the audit
 * insert fail and the call go unlogged. Slicing a preview can create one, so
 * this runs after truncation.
 */
function stripLoneSurrogates(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
}

/**
 * Audit-safe copy of an envelope: base64 payloads replaced with their size,
 * and anything huge truncated so agent_audit rows stay small.
 */
export function auditParams(envelope: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...envelope }
  delete copy.action
  if (typeof copy.content_base64 === 'string') {
    copy.content_base64 = `<${base64Bytes(copy.content_base64)} bytes>`
  }
  const serialized = JSON.stringify(copy)
  if (serialized.length > 8000) {
    return { _truncated: true, preview: stripLoneSurrogates(serialized.slice(0, 8000)) }
  }
  return copy
}

/** Compact one-line rendering of zod issues for an error response/audit. */
export function formatEnvelopeIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
}

// ── Self-documentation (help action / GET, and the MCP tool list) ─────────

export const AGENT_HELP = {
  name: 'ECR portal agent API',
  what: 'Read/write access to the live Entice/ECR portal database and storage for authorised Claude agents. One envelope: POST /api/agent {"action": …}. Same capabilities as MCP tools at /api/agent/mcp.',
  auth: 'Authorization: Bearer <agent key>. Keys are stored hashed and revocable; every call is audited to agent_audit.',
  actions: {
    help: 'This document.',
    schema: 'List all public tables with their columns; pass {table} for one table with types/nullability/defaults.',
    sql: '{query} — any single read-only SELECT/WITH (joins, aggregates, anything). Capped at 1000 rows (result.truncated=true when cut). Runs in a read-only transaction, so it cannot write even via a function call — use insert/update/delete/rpc to write.',
    insert: '{table, rows: [{…}, …], returning?} — insert up to 500 rows. Returns inserted rows unless returning=false.',
    update: '{table, filters: [{column, op, value}, …], values: {…}, returning?} — at least one filter is mandatory (no accidental whole-table updates).',
    delete: '{table, filters: […], confirm: true} — filters AND confirm:true are mandatory. Returns deleted rows.',
    rpc: '{fn, args?} — call a public Postgres function (portal RPCs, next_number, …).',
    storage_list: '{bucket, prefix?, limit?} — list storage objects. Buckets: attachments, branding, backups.',
    storage_sign: '{bucket, path, expires_in?} — signed download URL (default 1h, max 7d).',
    storage_upload: '{bucket, path, content_base64, content_type?, upsert?} — upload a file, max 3 MB decoded (Vercel body limit; use storage_sign for larger).',
  },
  filter_ops: FILTER_OPS,
  guardrails: [
    'sql runs in a read-only transaction; use insert/update/delete/rpc to write.',
    'update/delete require filters; delete also requires confirm:true.',
    `agent_keys and agent_audit are write-protected. No DDL anywhere — schema changes go through migrations, not this API.`,
    'Existing DB rules still apply: audit_log and agent_audit are append-only, storage deletes are trigger-guarded, CHECK constraints enforce status values.',
  ],
  house_rules: [
    'This is LIVE production data for Entice Civil & Remediation — no experimental writes.',
    'Any test record must have a name/title starting with "zz" and must be deleted afterwards.',
    'Timestamps are stored UTC; the business runs on Australia/Brisbane (+10:00, no DST).',
    'Ask the owner before deleting anything you did not create.',
  ],
} as const

type ToolDef = {
  name: AgentAction
  description: string
  inputSchema: Record<string, unknown>
}

const filterJsonSchema = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      column: { type: 'string' },
      op: { type: 'string', enum: [...FILTER_OPS] },
      value: {},
    },
    required: ['column', 'op'],
  },
} as const

/** MCP tools — same names as REST actions; arguments = envelope minus action. */
export const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'help',
    description: 'Usage guide, guardrails and house rules for the ECR portal agent API. Call this first in a fresh session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'schema',
    description: 'List all public tables and their columns, or pass table for one table with types/nullability/defaults.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Optional table name for column detail' } },
    },
  },
  {
    name: 'sql',
    description: 'Run any single read-only SELECT/WITH query against the live portal DB (joins/aggregates fine). 1000-row cap. Runs in a read-only transaction (cannot write, even via a function) — use insert/update/delete/rpc to write.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'insert',
    description: 'Insert up to 500 rows into a public table. Returns the inserted rows.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        rows: { type: 'array', items: { type: 'object' }, minItems: 1, maxItems: 500 },
        returning: { type: 'boolean' },
      },
      required: ['table', 'rows'],
    },
  },
  {
    name: 'update',
    description: 'Update rows matching ALL filters (at least one filter is mandatory). Returns the updated rows.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        filters: filterJsonSchema,
        values: { type: 'object' },
        returning: { type: 'boolean' },
      },
      required: ['table', 'filters', 'values'],
    },
  },
  {
    name: 'delete',
    description: 'Delete rows matching ALL filters. Requires filters AND confirm:true. Returns the deleted rows.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        filters: filterJsonSchema,
        confirm: { type: 'boolean', enum: [true] },
      },
      required: ['table', 'filters', 'confirm'],
    },
  },
  {
    name: 'rpc',
    description: 'Call a public Postgres function (portal RPCs, sequences, reports).',
    inputSchema: {
      type: 'object',
      properties: { fn: { type: 'string' }, args: { type: 'object' } },
      required: ['fn'],
    },
  },
  {
    name: 'storage_list',
    description: 'List objects in a storage bucket (attachments, branding, backups).',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string' },
        prefix: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['bucket'],
    },
  },
  {
    name: 'storage_sign',
    description: 'Create a signed download URL for a storage object (default 1h, max 7d).',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string' },
        path: { type: 'string' },
        expires_in: { type: 'number' },
      },
      required: ['bucket', 'path'],
    },
  },
  {
    name: 'storage_upload',
    description: 'Upload a file to storage (base64, max 3 MB decoded; use storage_sign for larger).',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string' },
        path: { type: 'string' },
        content_base64: { type: 'string' },
        content_type: { type: 'string' },
        upsert: { type: 'boolean' },
      },
      required: ['bucket', 'path', 'content_base64'],
    },
  },
]
