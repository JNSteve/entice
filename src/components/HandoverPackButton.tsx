'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { FileCheckIcon, FileDownIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { generateHandoverPack } from '@/lib/handover'
import type { HandoverKind } from '@/lib/feedback'

/**
 * Office controls for the CP3 handover pack, rendered only on COMPLETED
 * works (job completed/invoiced/paid, project closed):
 *   * Preview — streams the PDF from /api/pdf/handover (nothing stored).
 *   * Generate — renders and stores the pack as a work attachment
 *     (client_visible OFF); office publishes it to the portal with the
 *     normal eye-toggle on the attachment list.
 */
export function HandoverPackButton({
  kind,
  id,
}: {
  kind: HandoverKind
  id: string
}) {
  const [pending, startTransition] = useTransition()

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateHandoverPack(kind, id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        `${result.filename} attached — flip its "Client visible" toggle to publish it to the portal.`
      )
    })
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={`/api/pdf/handover/${id}?kind=${kind}`}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
      >
        <FileDownIcon />
        Preview handover pack
      </a>
      <Button size="sm" onClick={handleGenerate} disabled={pending}>
        <FileCheckIcon />
        {pending ? 'Generating…' : 'Generate handover pack'}
      </Button>
    </div>
  )
}
