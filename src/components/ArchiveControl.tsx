'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArchiveIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { setQuoteArchived } from '@/app/(office)/quotes/actions'
import { setJobArchived } from '@/app/(office)/jobs/actions'
import { setProjectArchived } from '@/app/(office)/projects/actions'

export type ArchiveKind = 'quote' | 'job' | 'project'

const NOUN: Record<ArchiveKind, string> = {
  quote: 'quote',
  job: 'job',
  project: 'project',
}

async function toggleArchive(
  kind: ArchiveKind,
  id: string,
  archived: boolean
): Promise<{ error?: string }> {
  switch (kind) {
    case 'quote':
      return setQuoteArchived(id, archived)
    case 'job':
      return setJobArchived(id, archived)
    case 'project':
      return setProjectArchived(id, archived)
  }
}

/**
 * Ghost "Archive" button + confirm dialog. Render only when the record is not
 * archived — the {@link ArchiveBanner} takes over once it is.
 */
export function ArchiveButton({ kind, id }: { kind: ArchiveKind; id: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const noun = NOUN[kind]

  function handleArchive() {
    startTransition(async () => {
      const result = await toggleArchive(kind, id, true)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} archived`)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <ArchiveIcon />
        Archive
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this {noun}?</DialogTitle>
            <DialogDescription>
              It disappears from lists and reports; restore any time from
              Settings → Archive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button onClick={handleArchive} disabled={pending}>
              {pending ? 'Archiving…' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Amber "archived" banner with an inline Restore button. Render only when the
 * record is archived.
 */
export function ArchiveBanner({ kind, id }: { kind: ArchiveKind; id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const noun = NOUN[kind]

  function handleRestore() {
    startTransition(async () => {
      const result = await toggleArchive(kind, id, false)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} restored`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <span>
        {`This ${noun} is archived — it's hidden from lists. Restore it from Settings → Archive.`}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRestore}
        disabled={pending}
      >
        {pending ? 'Restoring…' : 'Restore'}
      </Button>
    </div>
  )
}
