import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCarNumber, nextCarNumber } from '@/lib/numbering'
import { ncrCreateSchema } from '@/lib/zod'

function rpcStub(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { rpc, supabase: { rpc } as unknown as SupabaseClient }
}

describe('formatCarNumber', () => {
  it('pads to two digits', () => {
    expect(formatCarNumber('2026', 1)).toBe('CAR-2026-01')
    expect(formatCarNumber('2026', 11)).toBe('CAR-2026-11')
  })

  it('passes three or more digits through', () => {
    expect(formatCarNumber('2026', 100)).toBe('CAR-2026-100')
    expect(formatCarNumber('2026', 1234)).toBe('CAR-2026-1234')
  })
})

describe('nextCarNumber', () => {
  it('draws from the car:<year> sequence', async () => {
    const { rpc, supabase } = rpcStub({ data: 11, error: null })
    await expect(nextCarNumber(supabase, new Date('2026-10-07T02:00:00Z'))).resolves.toBe(
      'CAR-2026-11'
    )
    expect(rpc).toHaveBeenCalledWith('next_number', { seq_key: 'car:2026' })
  })

  it('uses the Brisbane year: 31 Dec 23:30 UTC is already next year', async () => {
    // 2026-12-31 23:30 UTC = 2027-01-01 09:30 Brisbane (+10)
    const { rpc, supabase } = rpcStub({ data: 1, error: null })
    await expect(nextCarNumber(supabase, new Date('2026-12-31T23:30:00Z'))).resolves.toBe(
      'CAR-2027-01'
    )
    expect(rpc).toHaveBeenCalledWith('next_number', { seq_key: 'car:2027' })
  })

  it('throws when the sequence errors or returns nothing', async () => {
    const failed = rpcStub({ data: null, error: { message: 'permission denied' } })
    await expect(nextCarNumber(failed.supabase)).rejects.toThrow(/permission denied/)
    const empty = rpcStub({ data: null, error: null })
    await expect(nextCarNumber(empty.supabase)).rejects.toThrow(/no value returned/)
  })
})

describe('ncrCreateSchema severity from classification', () => {
  const base = { source: 'quality', title: 'Torn bag at gate', description: 'Bag split on handling' }

  it('derives severity when only a classification is chosen', () => {
    const severity = (classification: string) =>
      ncrCreateSchema.parse({ ...base, classification, severity: null }).severity
    expect(severity('Major')).toBe(4)
    expect(severity('Minor')).toBe(2)
    expect(severity('OFI')).toBe(1)
  })

  it('keeps an explicitly picked severity', () => {
    const parsed = ncrCreateSchema.parse({ ...base, classification: 'OFI', severity: '5' })
    expect(parsed.severity).toBe(5)
    expect(parsed.classification).toBe('OFI')
  })

  it('needs a classification or a severity', () => {
    const result = ncrCreateSchema.safeParse({ ...base, classification: null, severity: null })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Choose a classification or a severity')
  })

  it('rejects an unknown classification', () => {
    const result = ncrCreateSchema.safeParse({ ...base, classification: 'Critical', severity: '3' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Classification must be Major, Minor or OFI')
  })

  it('blanks the optional register fields to null', () => {
    const parsed = ncrCreateSchema.parse({
      ...base,
      severity: '3',
      source_detail: '  ',
      assigned_to_text: '',
      due_date: '',
    })
    expect(parsed).toMatchObject({
      classification: null,
      source_detail: null,
      assigned_to_text: null,
      due_date: null,
    })
  })
})
