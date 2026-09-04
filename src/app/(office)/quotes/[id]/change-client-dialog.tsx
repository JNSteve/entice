'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { changeQuoteClient } from '../actions'
import { PencilIcon } from 'lucide-react'

const NONE = 'none'

export interface ClientOption {
  id: string
  name: string
}

export interface ClientScopedOption extends ClientOption {
  client_id: string
}

/**
 * Moves a quote to a different client. Site and contact are chosen here too:
 * they belong to the client, so they cannot be left pointing at the old one.
 */
export function ChangeClientDialog({
  quoteId,
  clientId,
  siteId,
  contactId,
  portalPublished,
  clients,
  sites,
  contacts,
}: {
  quoteId: string
  clientId: string
  siteId: string | null
  contactId: string | null
  portalPublished: boolean
  clients: ClientOption[]
  sites: ClientScopedOption[]
  contacts: ClientScopedOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [client, setClient] = useState(clientId)
  const [site, setSite] = useState(siteId ?? NONE)
  const [contact, setContact] = useState(contactId ?? NONE)

  const clientSites = sites.filter((s) => s.client_id === client)
  const clientContacts = contacts.filter((c) => c.client_id === client)
  const changed = client !== clientId

  function reset() {
    setClient(clientId)
    setSite(siteId ?? NONE)
    setContact(contactId ?? NONE)
  }

  function handleClientChange(id: string) {
    setClient(id)
    // Site and contact belong to the previous client — clear them.
    setSite(NONE)
    setContact(NONE)
  }

  function save() {
    startTransition(async () => {
      const result = await changeQuoteClient(quoteId, {
        client_id: client,
        site_id: site === NONE ? null : site,
        contact_id: contact === NONE ? null : contact,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Quote moved to the new client')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Change client"
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <PencilIcon />
        <span className="sr-only">Change client</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return
          setOpen(o)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change client</DialogTitle>
            <DialogDescription>
              The site and contact belong to the client, so pick them again for the new one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-client">Client</Label>
              <Select value={client} onValueChange={(v) => v && handleClientChange(v)}>
                <SelectTrigger id="cc-client" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-site">Site</Label>
              <Select value={site} onValueChange={(v) => v && setSite(v)}>
                <SelectTrigger id="cc-site" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No site</SelectItem>
                  {clientSites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {changed && clientSites.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  That client has no sites yet. Add one on the client page, or leave this
                  empty.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-contact">Contact</Label>
              <Select value={contact} onValueChange={(v) => v && setContact(v)}>
                <SelectTrigger id="cc-contact" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No contact</SelectItem>
                  {clientContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {changed && portalPublished && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                This quote is published to the client portal. Moving it withdraws it, so the
                old client loses access. Publish again when you are ready.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
