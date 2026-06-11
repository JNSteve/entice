'use client'

import React, { useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { recordAttachment } from '@/lib/attachments'
import { Button } from '@/components/ui/button'
import { UploadIcon, CheckIcon, XIcon, RefreshCwIcon, Loader2Icon } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Kind = 'photo' | 'docket' | 'document'

interface FileState {
  file: File
  name: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
  progress?: number
}

interface PhotoUploadProps {
  parentType: string
  parentId: string
  kind: Kind
  onUploaded?: () => void
  capture?: boolean
  multiple?: boolean
  extraMeta?: Record<string, unknown>
}

const MAX_SIZE = 25 * 1024 * 1024 // 25 MB
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      const { naturalWidth: w, naturalHeight: h } = img

      if (w <= MAX_EDGE && h <= MAX_EDGE) {
        resolve(file)
        return
      }

      const scale = MAX_EDGE / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          const downscaled = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
          })
          resolve(downscaled)
        },
        'image/jpeg',
        JPEG_QUALITY
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }

    img.src = url
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhotoUpload({
  parentType,
  parentId,
  kind,
  onUploaded,
  capture = false,
  multiple = false,
  extraMeta,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileStates, setFileStates] = useState<FileState[]>([])

  const isPhoto = kind === 'photo'
  const accept = isPhoto ? 'image/*' : undefined

  function setStatus(index: number, update: Partial<FileState>) {
    setFileStates((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...update } : f))
    )
  }

  async function uploadFile(file: File, index: number) {
    setStatus(index, { status: 'uploading', error: undefined })

    try {
      const processedFile = isPhoto ? await downscaleImage(file) : file
      const sanitized = sanitizeFilename(processedFile.name)
      const path = `${parentType}/${parentId}/${crypto.randomUUID()}-${sanitized}`

      const supabase = createClient()
      const { error: storageError } = await supabase.storage
        .from('attachments')
        .upload(path, processedFile, {
          contentType: processedFile.type || 'application/octet-stream',
          upsert: false,
        })

      if (storageError) {
        setStatus(index, { status: 'error', error: storageError.message })
        return
      }

      const result = await recordAttachment({
        parent_type: parentType,
        parent_id: parentId,
        path,
        filename: file.name,
        content_type: processedFile.type || 'application/octet-stream',
        size: processedFile.size,
        kind,
        caption: null,
        meta: extraMeta ?? null,
      })

      if (result.error) {
        // Row failed — clean up storage object best-effort
        await supabase.storage.from('attachments').remove([path])
        setStatus(index, { status: 'error', error: result.error })
        return
      }

      setStatus(index, { status: 'done' })
      onUploaded?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setStatus(index, { status: 'error', error: msg })
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return

    const newStates: FileState[] = []
    const startIndex = fileStates.length

    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name} exceeds the 25 MB limit and was skipped.`)
        continue
      }
      newStates.push({ file, name: file.name, status: 'pending' })
    }

    if (newStates.length === 0) return

    setFileStates((prev) => [...prev, ...newStates])

    // Start uploads after state update
    newStates.forEach((_, i) => {
      setTimeout(() => {
        uploadFile(newStates[i].file, startIndex + i)
      }, 0)
    })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files)
    // Reset so same file can be re-selected after error
    e.target.value = ''
  }

  async function retryFile(index: number) {
    const fs = fileStates[index]
    if (!fs || fs.status !== 'error') return
    await uploadFile(fs.file, index)
  }

  function dismissFile(index: number) {
    setFileStates((prev) => prev.filter((_, i) => i !== index))
  }

  const pending = fileStates.some((f) => f.status === 'uploading')

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture ? 'environment' : undefined}
        onChange={handleChange}
        className="sr-only"
        aria-hidden
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className="self-start"
      >
        {pending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <UploadIcon className="size-4" />
        )}
        {kind === 'photo' ? 'Add photo' : 'Attach file'}
      </Button>

      {fileStates.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {fileStates.map((fs, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              {fs.status === 'uploading' && (
                <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {fs.status === 'done' && (
                <CheckIcon className="size-4 shrink-0 text-green-600" />
              )}
              {fs.status === 'error' && (
                <XIcon className="size-4 shrink-0 text-destructive" />
              )}
              {fs.status === 'pending' && (
                <span className="size-4 shrink-0" />
              )}

              <span className="flex-1 truncate text-muted-foreground">{fs.name}</span>

              {fs.status === 'error' && (
                <>
                  <span className="text-xs text-destructive truncate max-w-[140px]">
                    {fs.error}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => retryFile(i)}
                  >
                    <RefreshCwIcon className="size-3.5" />
                    <span className="sr-only">Retry</span>
                  </Button>
                </>
              )}

              {(fs.status === 'done' || fs.status === 'error') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => dismissFile(i)}
                >
                  <XIcon className="size-3.5" />
                  <span className="sr-only">Dismiss</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
