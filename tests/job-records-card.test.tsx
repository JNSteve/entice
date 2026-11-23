// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

type Result = { id?: string; error?: string }

const JOB = '11111111-1111-4111-8111-111111111111'
const OLD_ATT = '22222222-2222-4222-8222-222222222222'
const NEW_ATT = '33333333-3333-4333-8333-333333333333'
const INSTANCE = '44444444-4444-4444-8444-444444444444'

const createDocumentSwmsInstance = vi.fn(async (...args: unknown[]): Promise<Result> => {
  void args
  return {}
})
const reviseDocumentSwmsInstance = vi.fn(async (...args: unknown[]): Promise<Result> => {
  void args
  return {}
})
const recordAttachment = vi.fn(async (...args: unknown[]): Promise<Result> => {
  void args
  return { id: NEW_ATT }
})
const storageUpload = vi.fn(async (...args: unknown[]) => {
  void args
  return { error: null }
})
const storageRemove = vi.fn(async (...args: unknown[]) => {
  void args
  return { data: [{}], error: null }
})
const toastSuccess = vi.fn()
const toastWarning = vi.fn()
const toastError = vi.fn()

vi.mock('@/lib/swms-actions', () => ({
  createDocumentSwmsInstance: (...args: unknown[]) => createDocumentSwmsInstance(...args),
  reviseDocumentSwmsInstance: (...args: unknown[]) => reviseDocumentSwmsInstance(...args),
}))
vi.mock('@/lib/attachments', () => ({
  recordAttachment: (...args: unknown[]) => recordAttachment(...args),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => storageUpload(...args),
        remove: (...args: unknown[]) => storageRemove(...args),
      }),
    },
  }),
}))
vi.mock('@/app/(office)/jobs/actions', () => ({
  updateJobRecordProfile: vi.fn(async () => ({})),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    warning: (m: string) => toastWarning(m),
    error: (m: string) => toastError(m),
  },
}))

import { JobRecordsCard, type JobRecordFile } from '@/app/(office)/jobs/[id]/job-records-card'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const filedSwms: JobRecordFile = {
  id: OLD_ATT,
  filename: 'RJ26038-SWMS-01 SWMS.pdf',
  caption: '4 Health and safety',
  kind: 'document',
  url: 'https://files.example/swms.pdf',
  swms: 'not_issued',
}

function card(overrides: Partial<React.ComponentProps<typeof JobRecordsCard>> = {}) {
  return (
    <JobRecordsCard
      jobId={JOB}
      jobNumber="RJ26038"
      scheduledStart="2026-11-23"
      scheduledEnd={null}
      lastShift="2026-11-23"
      licensedRemoval="class_b"
      regulatedWaste={false}
      files={[]}
      today="2026-11-23"
      canManage
      canIssueSwms
      swmsTargets={[]}
      {...overrides}
    />
  )
}

const pdf = () => new File(['%PDF-1.4 test'], 'my swms.pdf', { type: 'application/pdf' })

/** Opens a slot's upload dialog, picks the file and submits. */
async function uploadTo(slotLabel: string, file: File, before?: () => Promise<void>) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Upload ${slotLabel}` }))
  const input = screen.getByLabelText('File (max 25 MB)')
  await user.upload(input, file)
  if (before) await before()
  // Submitted directly: jsdom does not count a file picked through user-event
  // as filling a required file input, so a click on Upload would be blocked.
  expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy()
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(recordAttachment).toHaveBeenCalledTimes(1))
}

// ─── A SWMS already filed ─────────────────────────────────────────────────────

test('a SWMS filed but never issued can be issued to the crew in one click', async () => {
  const user = userEvent.setup()
  render(card({ files: [filedSwms] }))

  expect(screen.getByText('Not issued to crew')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Issue to crew' }))

  await waitFor(() => expect(createDocumentSwmsInstance).toHaveBeenCalledTimes(1))
  expect(createDocumentSwmsInstance).toHaveBeenCalledWith({
    title: 'RJ26038-SWMS-01 SWMS',
    attachment_id: OLD_ATT,
    job_id: JOB,
    project_id: null,
  })
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
})

test('a SWMS the crew already have says so and offers nothing to click', () => {
  render(card({ files: [{ ...filedSwms, swms: 'issued' }] }))
  expect(screen.getByText('Issued to crew')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Issue to crew' })).toBeNull()
})

test('someone who cannot issue a SWMS sees the status without the button', () => {
  render(card({ files: [filedSwms], canManage: false, canIssueSwms: false }))
  expect(screen.getByText('Not issued to crew')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Issue to crew' })).toBeNull()
})

test('a replaced revision is labelled, not offered for issue', () => {
  render(card({ files: [{ ...filedSwms, swms: 'replaced' }] }))
  expect(screen.getByText('Replaced by a newer revision')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Issue to crew' })).toBeNull()
})

// ─── Uploading ────────────────────────────────────────────────────────────────

test('uploading a SWMS files it and issues it to the crew', async () => {
  render(card())
  await uploadTo('SWMS', pdf())

  expect(recordAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      parent_type: 'job',
      parent_id: JOB,
      filename: 'RJ26038-SWMS-01 SWMS.pdf',
      kind: 'document',
    })
  )
  await waitFor(() => expect(createDocumentSwmsInstance).toHaveBeenCalledTimes(1))
  expect(createDocumentSwmsInstance).toHaveBeenCalledWith({
    title: 'RJ26038-SWMS-01 SWMS',
    attachment_id: NEW_ATT,
    job_id: JOB,
    project_id: null,
  })
  expect(reviseDocumentSwmsInstance).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('issued to the crew'))
  )
})

test('uploading a risk assessment files it without issuing anything', async () => {
  // Unlicensed job: the slot takes RA or SWMS and RA is the default code.
  render(card({ licensedRemoval: 'none' }))
  await uploadTo('Risk assessment or SWMS', pdf())

  expect(recordAttachment).toHaveBeenCalledWith(
    expect.objectContaining({ filename: 'RJ26038-RA-01 Risk assessment.pdf' })
  )
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  expect(createDocumentSwmsInstance).not.toHaveBeenCalled()
  expect(reviseDocumentSwmsInstance).not.toHaveBeenCalled()
})

test('a revised SWMS replaces the one in force, so the crew sign on again', async () => {
  const user = userEvent.setup()
  render(
    card({
      files: [{ ...filedSwms, swms: 'issued' }],
      swmsTargets: [{ id: INSTANCE, title: 'RJ26038-SWMS-01 SWMS' }],
    })
  )
  await uploadTo('SWMS', pdf(), async () => {
    await user.click(screen.getByLabelText(/Replaces RJ26038-SWMS-01 SWMS/))
  })

  await waitFor(() => expect(reviseDocumentSwmsInstance).toHaveBeenCalledTimes(1))
  expect(reviseDocumentSwmsInstance).toHaveBeenCalledWith({
    instance_id: INSTANCE,
    attachment_id: NEW_ATT,
  })
  expect(createDocumentSwmsInstance).not.toHaveBeenCalled()
  // The revision takes the next number on the job.
  expect(recordAttachment).toHaveBeenCalledWith(
    expect.objectContaining({ filename: 'RJ26038-SWMS-02 SWMS.pdf' })
  )
})

test('with a SWMS already in force, an upload is a new SWMS unless told otherwise', async () => {
  render(
    card({
      files: [{ ...filedSwms, swms: 'issued' }],
      swmsTargets: [{ id: INSTANCE, title: 'RJ26038-SWMS-01 SWMS' }],
    })
  )
  await uploadTo('SWMS', pdf())

  await waitFor(() => expect(createDocumentSwmsInstance).toHaveBeenCalledTimes(1))
  expect(reviseDocumentSwmsInstance).not.toHaveBeenCalled()
})

test('when issuing fails the file stays filed and the office is told', async () => {
  createDocumentSwmsInstance.mockResolvedValueOnce({ error: 'SWMS table is locked' })
  render(card())
  await uploadTo('SWMS', pdf())

  await waitFor(() =>
    expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('SWMS table is locked'))
  )
  expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('not issued'))
  // Filed is filed: the stored file is not rolled back.
  expect(storageRemove).not.toHaveBeenCalled()
  expect(toastSuccess).not.toHaveBeenCalled()
})

test('a SWMS that is not a PDF is filed but not issued, and says why', async () => {
  render(card())
  const doc = new File(['word'], 'my swms.docx', { type: 'application/msword' })
  await uploadTo('SWMS', doc)

  await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(expect.stringContaining('PDF')))
  expect(createDocumentSwmsInstance).not.toHaveBeenCalled()
})
