import { describe, expect, it } from 'vitest'
import {
  AGENT_TOOLS,
  FORBIDDEN_WRITE_TABLES,
  agentEnvelopeSchema,
  auditParams,
  hashAgentKey,
  isValidIdentifier,
  isValidStoragePath,
  validateSelectSql,
} from '@/lib/agent-api'

describe('hashAgentKey', () => {
  it('produces the sha256 hex of the token', () => {
    expect(hashAgentKey('test')).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    )
  })

  it('is stable and case-sensitive', () => {
    expect(hashAgentKey('abc')).toBe(hashAgentKey('abc'))
    expect(hashAgentKey('abc')).not.toBe(hashAgentKey('Abc'))
  })
})

describe('validateSelectSql', () => {
  it('accepts a plain select', () => {
    const r = validateSelectSql('select * from clients')
    expect(r).toEqual({ ok: true, cleaned: 'select * from clients' })
  })

  it('accepts WITH (CTE) queries and leading whitespace', () => {
    expect(validateSelectSql('  WITH x AS (select 1) select * from x').ok).toBe(true)
  })

  it('strips one trailing semicolon', () => {
    const r = validateSelectSql('select 1;')
    expect(r).toEqual({ ok: true, cleaned: 'select 1' })
  })

  it('rejects empty input', () => {
    expect(validateSelectSql('   ').ok).toBe(false)
    expect(validateSelectSql(';').ok).toBe(false)
  })

  it('rejects multiple statements', () => {
    expect(validateSelectSql('select 1; drop table clients').ok).toBe(false)
    expect(validateSelectSql('select 1; select 2;').ok).toBe(false)
  })

  it('rejects non-select statements', () => {
    for (const q of [
      'insert into clients (name) values (1)',
      'update clients set name = 1',
      'delete from clients',
      'drop table clients',
      'truncate clients',
      'create table zz (id int)',
      'grant all on clients to anon',
    ]) {
      expect(validateSelectSql(q).ok, q).toBe(false)
    }
  })

  it('requires a word boundary (no "selection …" prefix trick)', () => {
    expect(validateSelectSql('selection from x').ok).toBe(false)
    expect(validateSelectSql('withdraw()').ok).toBe(false)
  })

  // A data-modifying CTE passes this fast-fail layer (it starts with WITH) —
  // the database rejects it: agent_select wraps the query in a FROM subquery
  // and Postgres raises "WITH clause containing a data-modifying statement
  // must be at the top level". Proven live against the entice DB 2026-08-29.
  it('documents that data-modifying CTEs are stopped by the DB wrap', () => {
    expect(
      validateSelectSql('with x as (update clients set name = name returning *) select * from x').ok
    ).toBe(true)
  })
})

describe('agentEnvelopeSchema', () => {
  it('parses a sql envelope', () => {
    const r = agentEnvelopeSchema.safeParse({ action: 'sql', query: 'select 1' })
    expect(r.success).toBe(true)
  })

  it('rejects unknown actions', () => {
    expect(agentEnvelopeSchema.safeParse({ action: 'drop_everything' }).success).toBe(false)
  })

  it('update requires at least one filter', () => {
    expect(
      agentEnvelopeSchema.safeParse({
        action: 'update',
        table: 'clients',
        filters: [],
        values: { name: 'x' },
      }).success
    ).toBe(false)
    expect(
      agentEnvelopeSchema.safeParse({
        action: 'update',
        table: 'clients',
        filters: [{ column: 'id', op: 'eq', value: 'abc' }],
        values: { name: 'x' },
      }).success
    ).toBe(true)
  })

  it('delete requires filters AND confirm:true', () => {
    const base = {
      action: 'delete',
      table: 'clients',
      filters: [{ column: 'id', op: 'eq', value: 'abc' }],
    }
    expect(agentEnvelopeSchema.safeParse(base).success).toBe(false)
    expect(agentEnvelopeSchema.safeParse({ ...base, confirm: false }).success).toBe(false)
    expect(agentEnvelopeSchema.safeParse({ ...base, confirm: true }).success).toBe(true)
  })

  it("op 'in' needs a non-empty array, 'is' needs null/boolean", () => {
    const upd = (filter: Record<string, unknown>) =>
      agentEnvelopeSchema.safeParse({
        action: 'update',
        table: 'clients',
        filters: [filter],
        values: { name: 'x' },
      }).success
    expect(upd({ column: 'id', op: 'in', value: 'abc' })).toBe(false)
    expect(upd({ column: 'id', op: 'in', value: [] })).toBe(false)
    expect(upd({ column: 'id', op: 'in', value: ['a', 'b'] })).toBe(true)
    expect(upd({ column: 'archived', op: 'is', value: 'null' })).toBe(false)
    expect(upd({ column: 'archived', op: 'is', value: null })).toBe(true)
    expect(upd({ column: 'archived', op: 'is', value: false })).toBe(true)
  })

  it('rejects invalid table/column identifiers', () => {
    expect(
      agentEnvelopeSchema.safeParse({
        action: 'insert',
        table: 'clients; drop table clients',
        rows: [{ name: 'x' }],
      }).success
    ).toBe(false)
    expect(
      agentEnvelopeSchema.safeParse({
        action: 'update',
        table: 'clients',
        filters: [{ column: 'id=eq.x,name', op: 'eq', value: '1' }],
        values: { name: 'x' },
      }).success
    ).toBe(false)
  })

  it('caps insert batches at 500 rows', () => {
    const rows = Array.from({ length: 501 }, () => ({ name: 'x' }))
    expect(
      agentEnvelopeSchema.safeParse({ action: 'insert', table: 'clients', rows }).success
    ).toBe(false)
  })
})

describe('guardrail constants', () => {
  it('write-protects the key and audit tables', () => {
    expect(FORBIDDEN_WRITE_TABLES.has('agent_keys')).toBe(true)
    expect(FORBIDDEN_WRITE_TABLES.has('agent_audit')).toBe(true)
  })

  it('identifier validation matches Postgres naming', () => {
    expect(isValidIdentifier('quote_lines')).toBe(true)
    expect(isValidIdentifier('_private')).toBe(true)
    expect(isValidIdentifier('1clients')).toBe(false)
    expect(isValidIdentifier('clients"')).toBe(false)
    expect(isValidIdentifier('a'.repeat(64))).toBe(false)
  })

  it('storage paths cannot traverse', () => {
    expect(isValidStoragePath('attachments/portal-requests/x.png')).toBe(true)
    expect(isValidStoragePath('../secrets')).toBe(false)
    expect(isValidStoragePath('a/../b')).toBe(false)
    expect(isValidStoragePath('/absolute')).toBe(false)
    expect(isValidStoragePath(' padded ')).toBe(false)
  })
})

describe('auditParams', () => {
  it('drops action and replaces base64 payloads with their size', () => {
    const out = auditParams({
      action: 'storage_upload',
      bucket: 'attachments',
      path: 'x.png',
      content_base64: 'A'.repeat(4000),
    })
    expect(out.action).toBeUndefined()
    expect(out.bucket).toBe('attachments')
    expect(out.content_base64).toBe('<3000 bytes>')
  })

  it('truncates oversized envelopes', () => {
    const out = auditParams({ action: 'insert', blob: 'x'.repeat(20000) })
    expect(out._truncated).toBe(true)
    expect(String(out.preview).length).toBeLessThanOrEqual(8000)
  })
})

describe('MCP tool definitions', () => {
  it('tool names exactly match the envelope actions', () => {
    const actions = new Set(
      agentEnvelopeSchema.options.map(
        (o) => o.shape.action.value as string
      )
    )
    const tools = new Set(AGENT_TOOLS.map((t) => t.name))
    expect(tools).toEqual(actions)
  })

  it('every tool carries a JSON Schema object type', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.inputSchema.type, t.name).toBe('object')
      expect(t.description.length, t.name).toBeGreaterThan(10)
    }
  })
})
