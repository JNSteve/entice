'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { deleteAttachment } from '@/lib/attachments'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DownloadIcon,
  Trash2Icon,
  FileIcon,
  FileTextIcon,
  FileImageIcon,
} from 'lucide-react'
import { fmtDate } from '@/lib/format'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttachmentItem {
  id: string
  filename: string
  content_type: string
  size: number
  kind: 'photo' | 'docket' | 'document' | 'pdf'
  caption: string | null
  created_by: string
  created_by_name: string | null
  created_at: string
  signedUrl: string | null
}

interface AttachmentListProps {
  items: AttachmentItem[]
  canDelete: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileTypeIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/')) return <FileImageIcon className="size-4 shrink-0 text-muted-foreground" />
  if (contentType === 'application/pdf') return <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
  return <FileIcon className="size-4 shrink-0 text-muted-foreground" />
}

// ─── Photo grid + lightbox ────────────────────────────────────────────────────

interface PhotoGridProps {
  photos: AttachmentItem[]
  canDelete: boolean
  onDelete: (id: string) => void
  deleting: string | null
}

function PhotoGrid({ photos, canDelete, onDelete, deleting }: PhotoGridProps) {
  const [lightbox, setLightbox] = useState<AttachmentItem | null>(null)

  if (photos.length === 0) {
    return <p className="text-sm text-muted-foreground">No photos yet.</p>
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="group relative aspect-square rounded-lg overflow-hidden border bg-muted cursor-pointer"
            onClick={() => setLightbox(photo)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setLightbox(photo)}
            aria-label={`View ${photo.filename}`}
          >
            {photo.signedUrl ? (
              <img
                src={photo.signedUrl}
                alt={photo.caption ?? photo.filename}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <FileImageIcon className="size-8 text-muted-foreground" />
              </div>
            )}
            {canDelete && (
              <button
                type="button"
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity bg-black/60 rounded-md p-1 text-white hover:bg-black/80 focus:opacity-100 focus:outline-none"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete ${photo.filename}?`)) {
                    onDelete(photo.id)
                  }
                }}
                disabled={deleting === photo.id}
                aria-label={`Delete ${photo.filename}`}
              >
                <Trash2Icon className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        {lightbox && (
          <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>{lightbox.filename}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col">
              {lightbox.signedUrl ? (
                <img
                  src={lightbox.signedUrl}
                  alt={lightbox.caption ?? lightbox.filename}
                  className="w-full max-h-[70vh] object-contain bg-muted"
                />
              ) : (
                <div className="flex items-center justify-center h-64 bg-muted">
                  <FileImageIcon className="size-16 text-muted-foreground" />
                </div>
              )}
              <div className="p-4 flex flex-col gap-1">
                {lightbox.caption && (
                  <p className="text-sm">{lightbox.caption}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {lightbox.filename}
                  {lightbox.created_by_name && ` · ${lightbox.created_by_name}`}
                  {` · ${fmtDate(lightbox.created_at)}`}
                </p>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

// ─── Document / docket list ───────────────────────────────────────────────────

interface DocListProps {
  docs: AttachmentItem[]
  canDelete: boolean
  onDelete: (id: string) => void
  deleting: string | null
}

function DocList({ docs, canDelete, onDelete, deleting }: DocListProps) {
  if (docs.length === 0) {
    return <p className="text-sm text-muted-foreground">No documents yet.</p>
  }

  return (
    <div className="rounded-xl border divide-y">
      {docs.map((doc) => (
        <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
          <FileTypeIcon contentType={doc.content_type} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{doc.filename}</p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(doc.size)}
              {doc.caption ? ` · ${doc.caption}` : ''}
              {doc.created_by_name ? ` · ${doc.created_by_name}` : ''}
              {` · ${fmtDate(doc.created_at)}`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {doc.signedUrl && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                render={
                  <a
                    href={doc.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={doc.filename}
                    aria-label={`Download ${doc.filename}`}
                  />
                }
              >
                <DownloadIcon className="size-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={deleting === doc.id}
                onClick={() => {
                  if (confirm(`Delete ${doc.filename}?`)) {
                    onDelete(doc.id)
                  }
                }}
                aria-label={`Delete ${doc.filename}`}
              >
                <Trash2Icon className="size-3.5 text-destructive" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function AttachmentList({ items, canDelete }: AttachmentListProps) {
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const photos = items.filter((i) => i.kind === 'photo')
  const docs = items.filter((i) => i.kind !== 'photo')

  function handleDelete(id: string) {
    setDeletingId(id)
    startTransition(async () => {
      const result = await deleteAttachment(id)
      setDeletingId(null)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Attachment deleted')
      }
    })
  }

  // Separate rendering for photo grids vs doc lists, callers can choose which
  // kind slice to pass in; this component renders both if mixed.
  return (
    <div className="flex flex-col gap-4">
      {photos.length > 0 && (
        <PhotoGrid
          photos={photos}
          canDelete={canDelete}
          onDelete={handleDelete}
          deleting={pending ? deletingId : null}
        />
      )}
      {docs.length > 0 && (
        <DocList
          docs={docs}
          canDelete={canDelete}
          onDelete={handleDelete}
          deleting={pending ? deletingId : null}
        />
      )}
    </div>
  )
}
