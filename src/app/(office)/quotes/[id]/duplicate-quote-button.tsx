'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { duplicateQuote } from '../actions'

/**
 * Ghost "Duplicate" button + confirm dialog. Available on any status — cloning
 * an accepted quote into a fresh draft is the main use. Redirects to the copy.
 */
export function DuplicateQuoteButton({ id }: { id: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateQuote(id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Quote duplicated')
      setOpen(false)
      if (result.id) router.push(`/quotes/${result.id}`)
    })
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CopyIcon />
        Duplicate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate this quote?</DialogTitle>
            <DialogDescription>
              Creates a fresh draft copy with a new number.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button onClick={handleDuplicate} disabled={pending}>
              {pending ? 'Duplicating…' : 'Duplicate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
