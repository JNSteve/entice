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
  filename: string
  caption: string | null
  kind: string
  url: string | null
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
 * office file records from here under their SMS-02 names.
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
}: {
  jobId: string
  jobNumber: string
  status: SlotStatus
  filenames: string[]
  canManage: boolean
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
                  {f.url ? (
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
          />
        )}
      </div>
    </div>
  )
}

// ─── Upload a record under its SMS-02 name ────────────────────────────────────

function UploadRecordDialog({
  jobId,
  jobNumber,
  slot,
  filenames,
}: {
  jobId: string
  jobNumber: string
  slot: JobRecordSlot
  filenames: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const codes = slot.codes ?? []
  const [code, setCode] = useState(codes[0] ?? '')
  const [title, setTitle] = useState(slot.label)
  const [date, setDate] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const coded = slot.naming === 'coded'
  const dated = slot.naming === 'dated'
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast.error('Choose a file to upload')
      return
    }
    const upload = file
    const filename = finalName
    startTransition(async () => {
      const supabase = createClient()
      // Uploaded as-is (no image downscale): records are filed as received.
      const path = buildStorageKey(`job/${jobId}`, filename)
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

        toast.success(`Filed as ${filename}`)
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
      <Button type="button" variant="outline" size="sm" onClick={openDialog}>
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
