'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { GlobeIcon, GlobeLockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setWorkClientShared } from '@/lib/work-sharing'

/**
 * The per-work "Share with client" switch (admin/office). ON = the work's
 * photos, documents and close-out pack show in the client portal (dockets
 * never do); office can still hide single items with the eye toggle.
 */
export function ShareWithClientSwitch({
  kind,
  id,
  shared,
  clientName,
}: {
  kind: 'job' | 'project'
  id: string
  shared: boolean
  clientName: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggle() {
    const next = !shared
    if (
      !next &&
      !confirm(
        `Hide everything from the client portal? ${clientName} will no longer see this work's photos, documents or close-out pack.`
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await setWorkClientShared(kind, id, next)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const photos = result.photos ?? 0
      const documents = result.documents ?? 0
      toast.success(
        next
          ? `Shared with ${clientName} — ${photos} photo${photos === 1 ? '' : 's'} and ${documents} document${documents === 1 ? '' : 's'} are now in their portal. New uploads will be visible too; use the eye toggle to hide any single item.`
          : `Hidden from ${clientName}'s portal`
      )
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant={shared ? 'default' : 'outline'}
      size="sm"
      disabled={pending}
      onClick={toggle}
      aria-pressed={shared}
      title={`Photos, documents and the close-out pack appear in ${clientName}'s portal. Dockets never do.`}
    >
      {shared ? <GlobeIcon /> : <GlobeLockIcon />}
      {pending ? 'Saving…' : shared ? 'Shared with client' : 'Share with client'}
    </Button>
  )
}
