'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CheckIcon, UploadIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { recordAttachment } from '@/lib/attachments'
import { createDocumentSwmsInstance, reviseDocumentSwmsInstance } from '@/lib/swms-actions'
import { isPdfFile, titleFromFilename, type SwmsIssueState } from '@/lib/swms-document'
import {
  buildStorageKey,
  removeUploadedObject,
  safeContentType,
  validateUploadFile,
} from '@/lib/storage-keys'
import { fmtDate } from '@/lib/format'
import { todayAUClient } from '@/lib/tz-client'
import {
  FILING_DAYS,
  JOB_FOLDERS,
  filingDueDate,
  isMultiDay,
  jobRecordStatus,
  missingRecords,
  nextRecordSeq,
  recordFileName,
  type JobFolder,
  type JobRecordSlot,
  type LicensedRemoval,
  type SlotStatus,
} from '@/lib/job-records'
import { updateJobRecordProfile } from '../actions'

export interface JobRecordFile {
  /** The attachment id — set for uploaded files, not for portal records. */
  id?: string
  filename: string
  caption: string | null
  kind: string
  url: string | null
  /** For a file filed under the SWMS code: where it stands with the crew. */
  swms?: SwmsIssueState
}

/** An uploaded SWMS in force on the job — a revised PDF can replace its file. */
export interface SwmsReviseTarget {
  id: string
  title: string
}

const SWMS_STATE_LABELS: Record<SwmsIssueState, { text: string; className: string }> = {
  issued: { text: 'Issued to crew', className: 'text-green-700 dark:text-green-400' },
  not_issued: {
    text: 'Not issued to crew',
    className: 'font-medium text-amber-600 dark:text-amber-400',
  },
  not_pdf: {
    text: 'Not a PDF — cannot be issued to the crew',
    className: 'text-amber-600 dark:text-amber-400',
  },
  superseded: { text: 'Superseded', className: 'text-muted-foreground' },
  replaced: { text: 'Replaced by a newer revision', className: 'text-muted-foreground' },
}

const LICENSED_LABELS: Record<LicensedRemoval, string> = {
  none: 'None',
  class_b: 'Class B',
  class_a: 'Class A',
}

/** Titles for each code of a slot that takes more than one (RA or SWMS). */
const CODE_TITLES: Record<string, string> = {
  RA: 'Risk assessment',
  SWMS: 'SWMS',
}

function defaultTitle(slot: JobRecordSlot, code: string): string {
  return (slot.codes?.length ?? 0) > 1 ? (CODE_TITLES[code] ?? slot.label) : slot.label
}

/** The picked file's extension without the dot ('' when it has none). */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

/**
 * The job folder under SMS-02: the records this job must hold (from its
 * length, licensed removal class and regulated waste), what is already filed,
 * and the seven-day filing clock from the last shift (CAR-2026-06). Admin and
 * office file records from here under their SMS-02 names. A PDF filed under
 * the SWMS code is issued to the crew for sign-on as part of the upload; one
 * filed before that (or whose issue failed) shows as not issued, with a
 * one-click Issue to crew.
 */
export function JobRecordsCard({
  jobId,
  jobNumber,
  scheduledStart,
  scheduledEnd,
  lastShift,
  licensedRemoval,
  regulatedWaste,
  files,
  today,
  canManage,
  canIssueSwms,
  swmsTargets,
}: {
  jobId: string
  jobNumber: string
  scheduledStart: string | null
  scheduledEnd: string | null
  /** The scheduled end, else the Brisbane day the job was completed. */
  lastShift: string | null
  licensedRemoval: LicensedRemoval
  regulatedWaste: boolean
  files: JobRecordFile[]
  /** Brisbane today (todayAU), from the server. */
  today: string
  canManage: boolean
  /** admin/office/supervisor — the roles that may issue a SWMS. */
  canIssueSwms: boolean
  /** Uploaded SWMS in force on the job, offered as "replaces" on a new upload. */
  swmsTargets: SwmsReviseTarget[]
}) {
  const [pending, startTransition] = useTransition()
  // Held locally so the list follows a change at once; reverted if the save fails.
  const [licensed, setLicensed] = useState(licensedRemoval)
  const [waste, setWaste] = useState(regulatedWaste)

  const multiDay = isMultiDay(scheduledStart, scheduledEnd)
  const statuses = jobRecordStatus(jobNumber, { licensed, multiDay, regulatedWaste: waste }, files)
  const missing = missingRecords(statuses)
  const due = lastShift ? filingDueDate(lastShift) : null
  const filenames = files.map((f) => f.filename)

  const folders = (Object.keys(JOB_FOLDERS).map(Number) as JobFolder[])
    .map((folder) => ({ folder, rows: statuses.filter((s) => s.slot.folder === folder) }))
    .filter((g) => g.rows.length > 0)

  const jobLength = !scheduledStart
    ? 'Dates not set — treated as a one-day job'
    : multiDay
      ? 'Job over one day'
      : 'One-day job'

  function saveProfile(next: { licensed: LicensedRemoval; waste: boolean }) {
    const prev = { licensed, waste }
    setLicensed(next.licensed)
    setWaste(next.waste)
    startTransition(async () => {
      const result = await updateJobRecordProfile(jobId, {
        licensed_removal: next.licensed,
        regulated_waste: next.waste,
      })
      if (result.error) {
        toast.error(result.error)
        setLicensed(prev.licensed)
        setWaste(prev.waste)
      }
    })
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Job records</h2>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="text-muted-foreground">{jobLength}</span>
        {canManage ? (
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="jr-licensed" className="font-normal text-muted-foreground">
                Licensed removal
              </Label>
              <Select
                value={licensed}
                onValueChange={(v) => {
                  if (v && v !== licensed) saveProfile({ licensed: v as LicensedRemoval, waste })
                }}
                disabled={pending}
              >
                <SelectTrigger id="jr-licensed" size="sm" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LICENSED_LABELS) as LicensedRemoval[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {LICENSED_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="jr-waste"
                checked={waste}
                onCheckedChange={(checked) => saveProfile({ licensed, waste: checked })}
                disabled={pending}
              />
              <Label htmlFor="jr-waste" className="font-normal">
                Regulated waste
              </Label>
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">
            {`Licensed removal: ${LICENSED_LABELS[licensed]} · Regulated waste: ${waste ? 'Yes' : 'No'}`}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {folders.map(({ folder, rows }) => (
          <div key={folder} className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold text-muted-foreground">{JOB_FOLDERS[folder]}</h3>
            <div className="rounded-xl border divide-y">
              {rows.map((status) => (
                <RecordRow
                  key={status.slot.key}
                  jobId={jobId}
                  jobNumber={jobNumber}
                  status={status}
                  filenames={filenames}
                  canManage={canManage}
                  canIssueSwms={canIssueSwms}
                  swmsTargets={swmsTargets}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {due && (
        <p className="text-sm text-muted-foreground">
          {`File within ${FILING_DAYS} days of the last shift — `}
          {missing.length === 0 ? (
            `due ${fmtDate(due)}`
          ) : today >= due ? (
            <>
              {`due ${fmtDate(due)} · `}
              <span className="font-medium text-red-600 dark:text-red-400">Overdue</span>
            </>
          ) : (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {`due ${fmtDate(due)}`}
            </span>
          )}
        </p>
      )}
    </section>
  )
}

// ─── One record slot ──────────────────────────────────────────────────────────

function RecordRow({
  jobId,
  jobNumber,
  status,
  filenames,
  canManage,
  canIssueSwms,
  swmsTargets,
}: {
  jobId: string
  jobNumber: string
  status: SlotStatus
  filenames: string[]
  canManage: boolean
  canIssueSwms: boolean
  swmsTargets: SwmsReviseTarget[]
}) {
  const { slot, filed } = status
  // filesForSlot returns a subset of the card's own files, so each keeps its url.
  const matched = status.files as JobRecordFile[]

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{slot.label}</p>
        <p className="text-xs text-muted-foreground">{slot.form}</p>
        {slot.note && <p className="text-xs text-muted-foreground">{slot.note}</p>}
        {filed &&
          (slot.naming === 'photo' ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs">
              <CheckIcon className="size-3.5 shrink-0 text-green-600" />
              {`${matched.length} photo${matched.length === 1 ? '' : 's'}`}
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {matched.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <CheckIcon className="mt-px size-3.5 shrink-0 text-green-600" />
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {f.kind === 'swms' || f.kind === 'quote' ? (
                      // Held in the portal (SWMS builder / quote module), not as a file.
                      <a
                        href={f.url ?? '#swms'}
                        className="min-w-0 break-words underline underline-offset-2 hover:text-muted-foreground"
                      >
                        {`${f.filename} (${f.kind === 'swms' ? 'portal SWMS' : 'quote module'})`}
                      </a>
                    ) : f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 break-words underline underline-offset-2 hover:text-muted-foreground"
                      >
                        {f.filename}
                      </a>
                    ) : (
                      <span className="min-w-0 break-words">{f.filename}</span>
                    )}
                    {f.swms && (
                      <span className={SWMS_STATE_LABELS[f.swms].className}>
                        {SWMS_STATE_LABELS[f.swms].text}
                      </span>
                    )}
                    {f.swms === 'not_issued' && canIssueSwms && f.id && (
                      <IssueSwmsButton jobId={jobId} attachmentId={f.id} filename={f.filename} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {slot.naming === 'register' ? (
          <span className="text-xs text-muted-foreground">Record in IMS-R-04</span>
        ) : (
          !filed && <span className="text-xs text-muted-foreground">To file</span>
        )}
        {slot.naming === 'photo' && (
          <a href="#photos" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
            Add photos
          </a>
        )}
        {canManage && (slot.naming === 'coded' || slot.naming === 'dated') && (
          <UploadRecordDialog
            jobId={jobId}
            jobNumber={jobNumber}
            slot={slot}
            filenames={filenames}
            swmsTargets={swmsTargets}
          />
        )}
      </div>
    </div>
  )
}

// ─── Issue a SWMS that is filed but not yet with the crew ─────────────────────

function IssueSwmsButton({
  jobId,
  attachmentId,
  filename,
}: {
  jobId: string
  attachmentId: string
  filename: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function issue() {
    startTransition(async () => {
      try {
        const result = await createDocumentSwmsInstance({
          title: titleFromFilename(filename),
          attachment_id: attachmentId,
          job_id: jobId,
          project_id: null,
        })
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Issued to the crew — it is now on this job’s SWMS tab in the field view')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not issue the SWMS')
      }
    })
  }

  return (
    <Button type="button" variant="outline" size="xs" disabled={pending} onClick={issue}>
      {pending ? 'Issuing…' : 'Issue to crew'}
    </Button>
  )
}

// ─── Upload a record under its SMS-02 name ────────────────────────────────────

function UploadRecordDialog({
  jobId,
  jobNumber,
  slot,
  filenames,
  swmsTargets,
}: {
  jobId: string
  jobNumber: string
  slot: JobRecordSlot
  filenames: string[]
  swmsTargets: SwmsReviseTarget[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const codes = slot.codes ?? []
  const [code, setCode] = useState(codes[0] ?? '')
  const [title, setTitle] = useState(slot.label)
  const [date, setDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // The SWMS this upload replaces; '' files it as a new SWMS.
  const [replaceId, setReplaceId] = useState('')

  const coded = slot.naming === 'coded'
  const dated = slot.naming === 'dated'
  // A file under the SWMS code goes to the crew for sign-on as it is filed.
  const issuesSwms = coded && code === 'SWMS'
  const notPdf = issuesSwms && !!file && !isPdfFile(file.type, file.name)
  const caption = JOB_FOLDERS[slot.folder]
  const finalName = recordFileName(jobNumber, slot, {
    ext: file ? extOf(file.name) : '',
    code: coded ? code : undefined,
    seq: coded ? nextRecordSeq(jobNumber, code, filenames) : undefined,
    date: dated ? date : undefined,
    title: title.trim() || undefined,
  })
  // Dated records are recognised by their wording, not a code.
  const unrecognised = dated && !!slot.match && !slot.match.test(`${finalName} ${caption}`)

  function openDialog() {
    const first = codes[0] ?? ''
    setCode(first)
    setTitle(defaultTitle(slot, first))
    setDate(todayAUClient())
    setFile(null)
    setReplaceId('')
    setOpen(true)
  }

  function handleCodeChange(next: string) {
    // The title follows the code until it has been edited.
    if (title === defaultTitle(slot, code)) setTitle(defaultTitle(slot, next))
    setCode(next)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    const problem = picked ? validateUploadFile(picked) : null
    if (problem) {
      toast.error(problem)
      // Reset so the same file can be re-selected
      e.target.value = ''
      setFile(null)
      return
    }
    setFile(picked)
  }

  /**
   * Issues the filed PDF as a new SWMS, or as the next revision of one in
   * force. Returns the problem, or null — it never throws, because by now the
   * record is filed and the caller must not roll the upload back.
   */
  async function issueSwms(
    attachmentId: string,
    filename: string,
    replaces: SwmsReviseTarget | null
  ): Promise<string | null> {
    try {
      const result = replaces
        ? await reviseDocumentSwmsInstance({ instance_id: replaces.id, attachment_id: attachmentId })
        : await createDocumentSwmsInstance({
            title: titleFromFilename(filename),
            attachment_id: attachmentId,
            job_id: jobId,
            project_id: null,
          })
      return result.error ?? null
    } catch (err) {
      return err instanceof Error ? err.message : 'the server could not be reached'
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast.error('Choose a file to upload')
      return
    }
    const upload = file
    const filename = finalName
    const issue = issuesSwms
    const replaces = swmsTargets.find((t) => t.id === replaceId) ?? null
    startTransition(async () => {
      const supabase = createClient()
      // Uploaded as-is (no image downscale): records are filed as received.
      const path = buildStorageKey(`job/${jobId}`, filename)
      // True while the stored object has no attachment row pointing at it.
      let uploaded = false

      try {
        const { error: storageError } = await supabase.storage
          .from('attachments')
          .upload(path, upload, {
            contentType: safeContentType(upload.type),
            upsert: false,
          })

        if (storageError) {
          toast.error(storageError.message)
          return
        }
        uploaded = true

        const result = await recordAttachment({
          parent_type: 'job',
          parent_id: jobId,
          path,
          filename,
          content_type: safeContentType(upload.type),
          size: upload.size,
          kind: 'document',
          caption,
          meta: null,
        })

        if (result.error) {
          // Row failed — clean up storage object best-effort
          await removeUploadedObject(supabase, path)
          toast.error(result.error)
          return
        }
        // Filed. From here nothing may remove the stored file: a failed issue
        // leaves the record in place, showing as not issued.
        uploaded = false

        if (!issue) {
          toast.success(`Filed as ${filename}`)
        } else if (!isPdfFile(upload.type, upload.name)) {
          toast.warning(
            `Filed as ${filename}, but not issued to the crew — only a PDF can be issued for sign-on`
          )
        } else {
          const problem = result.id
            ? await issueSwms(result.id, filename, replaces)
            : 'the filed record could not be read back'
          if (problem) {
            toast.warning(
              replaces
                ? `Filed as ${filename}, but not issued to the crew: ${problem}. Revise ${replaces.title} in the SWMS section to use this file.`
                : `Filed as ${filename}, but not issued to the crew: ${problem}. Use Issue to crew beside the file.`
            )
          } else if (replaces) {
            toast.success(
              `Filed as ${filename} and issued to the crew as a revision — everyone signs on again`
            )
          } else {
            toast.success(`Filed as ${filename} and issued to the crew`)
          }
        }
        setOpen(false)
        router.refresh()
      } catch (err) {
        // recordAttachment threw (network drop / server 500) — the object may
        // already exist, so run the same compensating cleanup as the error path.
        if (uploaded) await removeUploadedObject(supabase, path)
        toast.error(err instanceof Error ? err.message : 'Upload failed')
      }
    })
  }

  const idPrefix = `jr-${slot.key}`

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Upload ${slot.label}`}
        onClick={openDialog}
      >
        <UploadIcon className="size-4" />
        Upload
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{slot.label}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {codes.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-code`}>Code</Label>
                <Select
                  value={code}
                  onValueChange={(v) => {
                    if (v) handleCodeChange(v)
                  }}
                >
                  <SelectTrigger id={`${idPrefix}-code`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {codes.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-title`}>Title</Label>
              <Input
                id={`${idPrefix}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            {dated && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-date`}>Date</Label>
                <Input
                  id={`${idPrefix}-date`}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-40"
                  required
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-file`}>File (max 25 MB)</Label>
              <Input id={`${idPrefix}-file`} type="file" onChange={handleFileChange} required />
            </div>
            {issuesSwms && (
              <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
                <p className="text-sm font-medium">Issued to the crew on upload</p>
                <p className="text-xs text-muted-foreground">
                  It shows on this job&apos;s SWMS tab in the field view, ready for sign-on.
                </p>
                {swmsTargets.length > 0 && (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1 text-xs font-medium">This file is</legend>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${idPrefix}-issue-as`}
                        className="mt-1 accent-primary"
                        checked={replaceId === ''}
                        onChange={() => setReplaceId('')}
                      />
                      <span>A new SWMS</span>
                    </label>
                    {swmsTargets.map((t) => (
                      <label key={t.id} className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name={`${idPrefix}-issue-as`}
                          className="mt-1 accent-primary"
                          checked={replaceId === t.id}
                          onChange={() => setReplaceId(t.id)}
                        />
                        <span className="min-w-0 break-words">
                          {`Replaces ${t.title} — crew sign on again`}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {notPdf && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Only a PDF can be issued to the crew. This file will be filed but not issued.
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{`Filed in ${caption} as`}</p>
              <p className="rounded-lg bg-muted px-2.5 py-2 font-mono text-xs break-all">{finalName}</p>
              {unrecognised && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {`This title won't show as the ${slot.label.toLowerCase()} — keep “${slot.label}” in it.`}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !file}>
                {pending ? 'Uploading…' : 'Upload'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
