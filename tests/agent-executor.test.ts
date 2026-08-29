import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { FILTER_OPS } from '@/lib/agent-api'
import { AgentApiError, executeAgentAction } from '@/lib/agent-executor'

/**
 * Executor tests — the dispatch layer the pure schema tests can't reach.
 * A fake thenable query-builder stands in for the Supabase client so we can
 * assert filter dispatch, the count/rows fallback, and the storage guards
 * without a live database.
 */

type Canned = { data?: unknown; error?: { message: string } | null; count?: number | null }

function makeAdmin(canned: Canned) {
  const calls = {
    table: '' as string,
    filters: [] as Array<[string, string, unknown]>,
    select: undefined as string | undefined,
    insert: undefined as unknown,
    update: undefined as unknown,
    deleted: false,
    uploadBucket: undefined as string | undefined,
  }
  const result = {
    data: canned.data ?? null,
    error: canned.error ?? null,
    count: canned.count ?? null,
  }
  const qb: Record<string, unknown> = {}
  const chain = () => qb
  Object.assign(qb, {
    insert(rows: unknown) {
      calls.insert = rows
      return qb
    },
    update(values: unknown) {
      calls.update = values
      return qb
    },
    delete() {
      calls.deleted = true
      return qb
    },
    select(sel: string) {
      calls.select = sel
      return qb
    },
    in(c: string, v: unknown) {
      calls.filters.push(['in', c, v])
      return qb
    },
    is(c: string, v: unknown) {
      calls.filters.push(['is', c, v])
      return qb
    },
    // thenable so `await base` / `await base.select('*')` resolve
    then(resolve: (r: typeof result) => void) {
      resolve(result)
    },
  })
  // scalar filter ops all share the same shape
  for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike']) {
    qb[op] = (c: string, v: unknown) => {
      calls.filters.push([op, c, v])
      return chain()
    }
  }
  const admin = {
    _calls: calls,
    from(table: string) {
      calls.table = table
      return qb
    },
    storage: {
      from(bucket: string) {
        calls.uploadBucket = bucket
        return {
          upload: async () => ({ error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: 'https://x/y' }, error: null }),
          list: async () => ({ data: [], error: null }),
        }
      },
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any
}

describe('FILTER_OPS ↔ PostgREST builder', () => {
  it('every op maps to a real method on the query builder', () => {
    const builder = createClient('http://localhost:54321', 'test-anon-key')
      .from('x')
      .select('*')
    for (const op of FILTER_OPS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (builder as any)[op], op).toBe('function')
    }
  })
})

describe('executeAgentAction — filter dispatch', () => {
  it('routes each op through the matching builder method', async () => {
    const admin = makeAdmin({ data: [], count: 0 })
    await executeAgentAction(admin, {
      action: 'update',
      table: 'jobs',
      filters: [
        { column: 'id', op: 'eq', value: '1' },
        { column: 'n', op: 'gt', value: 5 },
        { column: 'tags', op: 'in', value: ['a', 'b'] },
        { column: 'archived', op: 'is', value: false },
      ],
      values: { status: 'scheduled' },
    })
    expect(admin._calls.table).toBe('jobs')
    expect(admin._calls.filters).toEqual([
      ['eq', 'id', '1'],
      ['gt', 'n', 5],
      ['in', 'tags', ['a', 'b']],
      ['is', 'archived', false],
    ])
  })
})

describe('executeAgentAction — count/rows fallback', () => {
  it('reports count on the returning:false path', async () => {
    const admin = makeAdmin({ data: null, count: 5 })
    const out = await executeAgentAction(admin, {
      action: 'insert',
      table: 'clients',
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }],
      returning: false,
    })
    expect(out.result.inserted).toBe(5)
    expect(out.rowCount).toBe(5)
  })

  it('preserves a legitimate 0 count (nullish, not falsy)', async () => {
    const admin = makeAdmin({ data: [], count: 0 })
    const out = await executeAgentAction(admin, {
      action: 'update',
      table: 'clients',
      filters: [{ column: 'id', op: 'eq', value: 'nope' }],
      values: { name: 'x' },
    })
    expect(out.result.updated).toBe(0)
  })
})

describe('executeAgentAction — write-protected tables', () => {
  it('refuses inserts into agent_keys / agent_audit', async () => {
    const admin = makeAdmin({ data: [] })
    for (const table of ['agent_keys', 'agent_audit']) {
      await expect(
        executeAgentAction(admin, { action: 'insert', table, rows: [{ x: 1 }] })
      ).rejects.toBeInstanceOf(AgentApiError)
    }
  })
})

describe('executeAgentAction — storage guards', () => {
  it('rejects buckets outside the allowlist', async () => {
    const admin = makeAdmin({})
    await expect(
      executeAgentAction(admin, {
        action: 'storage_upload',
        bucket: 'secret-bucket',
        path: 'x.bin',
        content_base64: 'AAAA',
      })
    ).rejects.toThrow(/not accessible/)
  })

  it('rejects malformed base64 rather than uploading truncated bytes', async () => {
    const admin = makeAdmin({})
    await expect(
      executeAgentAction(admin, {
        action: 'storage_upload',
        bucket: 'attachments',
        path: 'x.bin',
        content_base64: '!!!!notbase64####',
      })
    ).rejects.toThrow(/not valid base64/)
  })

  it('accepts a valid base64 upload to an allowed bucket', async () => {
    const admin = makeAdmin({})
    const out = await executeAgentAction(admin, {
      action: 'storage_upload',
      bucket: 'attachments',
      path: 'zz/test.txt',
      content_base64: Buffer.from('hello').toString('base64'),
    })
    expect(out.result.uploaded).toBe('attachments/zz/test.txt')
    expect(out.result.bytes).toBe(5)
  })
})
