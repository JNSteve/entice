'use client'

import React, { useState, useRef, useTransition } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { recordAttachment } from '@/lib/attachments'
import {
  buildStorageKey,
  removeUploadedObject,
  safeContentType,
  validateUploadFile,
} from '@/lib/storage-keys'
import { Button } from '@/components/ui/button'
import {
  CameraIcon,
  FileTextIcon,
  UploadIcon,
  ImageIcon,
  Loader2Icon,
  CheckIcon,
  XIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/format'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaptureTarget = {
  id: string
  type: 'job' | 'project'
  number: string
  label: string
}

export type RecentAttachment = {
  id: string
  filename: string
  kind: 'photo' | 'docket'
  caption: string | null
  created_at: string
  signedUrl: string | null
  meta: Record<string, unknown> | null
}

interface CaptureClientProps {
  recentTargets: CaptureTarget[]
  allTargets: CaptureTarget[]
  today: string
}

type Kind = 'photo' | 'docket'

interface UploadState {
  /** Stable id — status updates target this, not an array index (a batch of
   * files would otherwise all share the same stale-closure index). */
  id: string
  file: File
  name: string
  status: 'uploading' | 'done' | 'error'
  error?: string
}

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img
      if (w <= MAX_EDGE && h <= MAX_EDGE) { resolve(file); return }
      const scale = MAX_EDGE / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) { resolve(file); return }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', JPEG_QUALITY)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// ─── Target chip / picker ─────────────────────────────────────────────────────

function TargetPicker({
  recentTargets,
  allTargets,
  selected,
  onSelect,
}: {
  recentTargets: CaptureTarget[]
  allTargets: CaptureTarget[]
  selected: CaptureTarget | null
  onSelect: (t: CaptureTarget) => void
}) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = q
    ? allTargets.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.number.toLowerCase().includes(q)
      )
    : []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Target
      </p>

      {/* Recent chips */}
      {recentTargets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recentTargets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                selected?.id === t.id
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background hover:bg-muted'
              )}
            >
              <span className="font-mono text-[10px] opacity-60">
                {t.type === 'job' ? 'J-' : 'P-'}{t.number}
              </span>
              <span className="truncate max-w-[120px]">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search for others */}
      <div className="relative">
        <input
          type="search"
          placeholder="Search jobs &amp; projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border bg-background px-3 py-2.5 text-base pr-9 pl-3 md:text-sm"
        />
      </div>

      {/* Search results */}
      {q && (
        <div className="rounded-xl border divide-y max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results.</p>
          ) : (
            filtered.slice(0, 10).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onSelect(t); setQuery('') }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-muted active:bg-muted transition-colors"
              >
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  {t.type === 'job' ? 'J-' : 'P-'}{t.number}
                </span>
                <span className="truncate">{t.label}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Selected badge */}
      {selected && (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          <span className="font-mono text-xs text-muted-foreground">
            {selected.type === 'job' ? 'J-' : 'P-'}{selected.number}
          </span>
          <span className="text-sm font-medium truncate flex-1">{selected.label}</span>
          <button
            type="button"
            onClick={() => onSelect(selected)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Kind toggle ──────────────────────────────────────────────────────────────

function KindToggle({
  kind,
  onChange,
}: {
  kind: Kind
  onChange: (k: Kind) => void
}) {
  return (
    <div className="grid grid-cols-2 rounded-xl border p-1 gap-1">
      {(['photo', 'docket'] as Kind[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
            kind === k
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {k === 'photo' ? (
            <CameraIcon className="size-4" />
          ) : (
            <FileTextIcon className="size-4" />
          )}
          {k === 'photo' ? 'Photo' : 'Docket'}
        </button>
      ))}
    </div>
  )
}

// ─── Recent uploads list ──────────────────────────────────────────────────────

function RecentList({ items }: { items: RecentAttachment[] }) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Uploaded today
      </p>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
          >
            {item.signedUrl && item.kind === 'photo' ? (
              <img
                src={item.signedUrl}
                alt={item.caption ?? item.filename}
                className="size-10 rounded-md object-cover border shrink-0"
                loading="lazy"
              />
            ) : (
              <div className="size-10 rounded-md border bg-muted flex items-center justify-center shrink-0">
                {item.kind === 'photo' ? (
                  <ImageIcon className="size-5 text-muted-foreground" />
                ) : (
                  <FileTextIcon className="size-5 text-muted-foreground" />
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.filename}</p>
              <p className="text-xs text-muted-foreground">
                {item.kind === 'docket' && item.meta?.supplier
                  ? `${item.meta.supplier}${item.meta.docket_no ? ` · ${item.meta.docket_no}` : ''}`
                  : item.caption ?? fmtDate(item.created_at)}
              </p>
            </div>
            <CheckIcon className="size-4 shrink-0 text-green-600" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main client component ────────────────────────────────────────────────────

export function CaptureClient({
  recentTargets,
  allTargets,
  today,
}: CaptureClientProps) {
  const [selectedTarget, setSelectedTarget] = useState<CaptureTarget | null>(
    recentTargets[0] ?? null
  )
  const [kind, setKind] = useState<Kind>('photo')
  const [caption, setCaption] = useState('')

  // Docket-only fields
  const [supplier, setSupplier] = useState('')
  const [docketNo, setDocketNo] = useState('')
  const [docketDate, setDocketDate] = useState(today)

  const [uploads, setUploads] = useState<UploadState[]>([])
  const [recentItems, setRecentItems] = useState<RecentAttachment[]>([])
  const [loadingRecent, startLoadRecent] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleTargetSelect(t: CaptureTarget) {
    if (selectedTarget?.id === t.id) {
      setSelectedTarget(null)
      setRecentItems([])
      return
    }
    setSelectedTarget(t)
    // Load today's uploads for this target
    startLoadRecent(async () => {
      try {
        const supabase = createClient()
        const { data: rows } = await supabase
          .from('attachments')
          .select(
            'id, filename, kind, caption, meta, created_at, path'
          )
          .eq('parent_type', t.type)
          .eq('parent_id', t.id)
          .gte('created_at', `${today}T00:00:00`)
          .in('kind', ['photo', 'docket'])
          .order('created_at', { ascending: false })

        if (!rows || rows.length === 0) { setRecentItems([]); return }

        const paths = rows.map((r) => r.path)
        const { data: signedData } = await supabase.storage
          .from('attachments')
          .createSignedUrls(paths, 3600)
        const urlMap = new Map<string, string>()
        if (signedData) {
          for (const e of signedData) {
            if (e.signedUrl && e.path) urlMap.set(e.path, e.signedUrl)
          }
        }

        setRecentItems(
          rows.map((r) => ({
            id: r.id,
            filename: r.filename,
            kind: r.kind as 'photo' | 'docket',
            caption: r.caption ?? null,
            created_at: r.created_at,
            signedUrl: urlMap.get(r.path) ?? null,
            meta: r.meta as Record<string, unknown> | null,
          }))
        )
      } catch {
        setRecentItems([])
      }
    })
  }

  function setUploadStatus(id: string, update: Partial<UploadState>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...update } : u)))
  }

  async function uploadFile(file: File) {
    if (!selectedTarget) {
      toast.error('Pick a target first')
      return
    }

    const id = crypto.randomUUID()
    setUploads((prev) => [...prev, { id, file, name: file.name, status: 'uploading' }])

    const supabase = createClient()
    let path: string | null = null
    let uploaded = false

    try {
      const isPhoto = kind === 'photo'
      const processedFile = isPhoto ? await downscaleImage(file) : file
      path = buildStorageKey(
        `${selectedTarget.type}/${selectedTarget.id}`,
        processedFile.name
      )

      const { error: storageError } = await supabase.storage
        .from('attachments')
        .upload(path, processedFile, {
          contentType: safeContentType(processedFile.type),
          upsert: false,
        })

      if (storageError) {
        setUploadStatus(id, { status: 'error', error: storageError.message })
        return
      }
      uploaded = true

      const extraMeta =
        kind === 'docket'
          ? {
              supplier: supplier.trim() || null,
              docket_no: docketNo.trim() || null,
              docket_date: docketDate || today,
            }
          : undefined

      const result = await recordAttachment({
        parent_type: selectedTarget.type,
        parent_id: selectedTarget.id,
        path,
        filename: file.name,
        content_type: safeContentType(processedFile.type),
        size: processedFile.size,
        kind,
        caption: caption.trim() || null,
        meta: extraMeta ?? null,
      })

      if (result.error) {
        await removeUploadedObject(supabase, path)
        setUploadStatus(id, { status: 'error', error: result.error })
        return
      }

      setUploadStatus(id, { status: 'done' })

      // Get signed URL for the new upload and add to recent list
      const { data: urlData } = await createClient()
        .storage.from('attachments')
        .createSignedUrls([path], 3600)
      const signedUrl = urlData?.[0]?.signedUrl ?? null

      setRecentItems((prev) => [
        {
          id: result.id ?? crypto.randomUUID(),
          filename: file.name,
          kind,
          caption: caption.trim() || null,
          created_at: new Date().toISOString(),
          signedUrl,
          meta: extraMeta ?? null,
        },
        ...prev,
      ])
    } catch (err) {
      // recordAttachment threw (network drop / server 500) — the object may
      // already exist, so run the same compensating cleanup as the error path.
      if (uploaded && path) await removeUploadedObject(supabase, path)
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setUploadStatus(id, { status: 'error', error: msg })
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    if (!selectedTarget) {
      toast.error('Pick a target first')
      e.target.value = ''
      return
    }
    for (const file of Array.from(files)) {
      const problem = validateUploadFile(file)
      if (problem) {
        toast.error(problem)
        continue
      }
      uploadFile(file)
    }
    e.target.value = ''
  }

  const isUploading = uploads.some((u) => u.status === 'uploading')
  const canUpload = !!selectedTarget && !isUploading

  // Docket mode validation
  const docketReady = kind === 'docket' ? supplier.trim() !== '' && docketNo.trim() !== '' : true

  return (
    <div className="flex flex-col gap-6">
      {/* Target picker */}
      <TargetPicker
        recentTargets={recentTargets}
        allTargets={allTargets}
        selected={selectedTarget}
        onSelect={handleTargetSelect}
      />

      {/* Kind toggle */}
      <KindToggle kind={kind} onChange={(k) => { setKind(k); setUploads([]) }} />

      {/* Docket fields */}
      {kind === 'docket' && (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Docket details
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="f-supplier">
              Supplier <span className="text-destructive">*</span>
            </label>
            <input
              id="f-supplier"
              type="text"
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Boral"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="f-docket-no">
              Docket no <span className="text-destructive">*</span>
            </label>
            <input
              id="f-docket-no"
              type="text"
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="e.g. D123"
              value={docketNo}
              onChange={(e) => setDocketNo(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="f-docket-date">
              Docket date
            </label>
            <input
              id="f-docket-date"
              type="date"
              className="rounded-lg border bg-background px-3 py-2 text-sm w-40"
              value={docketDate}
              onChange={(e) => setDocketDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Caption (photo mode) */}
      {kind === 'photo' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium" htmlFor="f-caption">
            Caption (optional)
          </label>
          <input
            id="f-caption"
            type="text"
            className="rounded-lg border bg-background px-3 py-2 text-sm"
            placeholder="Describe what's in the photo…"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={kind === 'photo' ? 'image/*' : undefined}
        multiple={kind === 'photo'}
        capture={kind === 'photo' ? 'environment' : undefined}
        onChange={handleFileChange}
        className="sr-only"
        aria-hidden
      />

      {/* Upload button */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={!canUpload || !docketReady}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <Loader2Icon className="size-5 animate-spin" />
        ) : kind === 'photo' ? (
          <CameraIcon className="size-5" />
        ) : (
          <UploadIcon className="size-5" />
        )}
        {isUploading
          ? 'Uploading…'
          : kind === 'photo'
            ? 'Take / add photos'
            : 'Attach docket'}
      </Button>

      {/* Upload status list */}
      {uploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {uploads.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              {u.status === 'uploading' && (
                <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {u.status === 'done' && (
                <CheckIcon className="size-4 shrink-0 text-green-600" />
              )}
              {u.status === 'error' && (
                <XIcon className="size-4 shrink-0 text-destructive" />
              )}
              <span className="flex-1 truncate text-muted-foreground">{u.name}</span>
              {u.status === 'error' && (
                <span className="text-xs text-destructive truncate max-w-[140px]">
                  {u.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent uploads */}
      {loadingRecent ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Loading uploads…
        </div>
      ) : (
        <RecentList items={recentItems} />
      )}
    </div>
  )
}
