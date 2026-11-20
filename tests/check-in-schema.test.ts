import { describe, expect, it } from 'vitest'
import { checkInSchema, manualEntrySchema } from '@/lib/zod'

const JOB = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'

describe('checkInSchema', () => {
  it('accepts a job with no schedule link', () => {
    expect(checkInSchema.safeParse({ job_id: JOB, project_id: null }).success).toBe(true)
  })

  it('accepts a project with no schedule link', () => {
    expect(checkInSchema.safeParse({ job_id: null, project_id: PROJECT }).success).toBe(true)
  })

  it('rejects neither and both', () => {
    expect(checkInSchema.safeParse({ job_id: null, project_id: null }).success).toBe(false)
    expect(checkInSchema.safeParse({ job_id: JOB, project_id: PROJECT }).success).toBe(false)
  })

  it('ignores a schedule id sent by an older client', () => {
    const parsed = checkInSchema.safeParse({ job_id: JOB, project_id: null, assignment_id: PROJECT })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'assignment_id' in parsed.data).toBe(false)
  })
})

describe('manualEntrySchema', () => {
  const ok = { job_id: JOB, project_id: null, date: '2026-11-20', start_time: '07:00', end_time: '15:30' }

  it('accepts a job, a date and a finish after the start', () => {
    expect(manualEntrySchema.safeParse(ok).success).toBe(true)
  })

  it('rejects a finish at or before the start', () => {
    expect(manualEntrySchema.safeParse({ ...ok, end_time: '07:00' }).success).toBe(false)
    expect(manualEntrySchema.safeParse({ ...ok, end_time: '06:00' }).success).toBe(false)
  })

  it('rejects no target', () => {
    expect(manualEntrySchema.safeParse({ ...ok, job_id: null }).success).toBe(false)
  })

  it('rejects a malformed time', () => {
    expect(manualEntrySchema.safeParse({ ...ok, start_time: '7am' }).success).toBe(false)
  })
})
