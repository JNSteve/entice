'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { createQuote } from './actions'
import { PlusIcon } from 'lucide-react'

const NONE = 'none'

interface Option {
  id: string
  name: string
}

interface ClientScopedOption extends Option {
  client_id: string
}

interface ProfileOption {
  id: string
  full_name: string
}

interface TemplateOption extends Option {
  is_default: boolean
}

export function NewQuoteDialog({
  clients,
  sites,
  contacts,
  pmOptions,
  templates,
  currentProfileId,
}: {
  clients: Option[]
  sites: ClientScopedOption[]
  contacts: ClientScopedOption[]
  pmOptions: ProfileOption[]
  templates: TemplateOption[]
  currentProfileId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [clientId, setClientId] = useState('')
  const [siteId, setSiteId] = useState(NONE)
  const [contactId, setContactId] = useState(NONE)
  const [pmId, setPmId] = useState(currentProfileId)
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState(
    templates.find((t) => t.is_default)?.id ?? NONE
  )

  const clientSites = sites.filter((s) => s.client_id === clientId)
  const clientContacts = contacts.filter((c) => c.client_id === clientId)

  function handleClientChange(id: string) {
    setClientId(id)
    // Site/contact belong to the previous client — reset.
    setSiteId(NONE)
    setContactId(NONE)
  }

  function reset() {
    setClientId('')
    setSiteId(NONE)
    setContactId(NONE)
    setPmId(currentProfileId)
    setTitle('')
    setTemplateId(templates.find((t) => t.is_default)?.id ?? NONE)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId) {
      toast.error('Pick a client')
      return
    }
    startTransition(async () => {
      const result = await createQuote({
        client_id: clientId,
        site_id: siteId === NONE ? null : siteId,
        contact_id: contactId === NONE ? null : contactId,
        pm_id: pmId,
        title,
        template_id: templateId === NONE ? null : templateId,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Quote created')
      setOpen(false)
      reset()
      if (result.id) router.push(`/quotes/${result.id}`)
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        New quote
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New quote</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nq-client">Client</Label>
              <Select
                value={clientId || null}
                onValueChange={(v) => handleClientChange(v as string)}
              >
                <SelectTrigger id="nq-client" className="w-full">
                  <SelectValue placeholder="Pick a client…" />
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
              <Label htmlFor="nq-site">Site (optional)</Label>
              <Select
                value={siteId}
                onValueChange={(v) => setSiteId(v as string)}
                disabled={!clientId}
              >
                <SelectTrigger id="nq-site" className="w-full">
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nq-contact">Contact (optional)</Label>
              <Select
                value={contactId}
                onValueChange={(v) => setContactId(v as string)}
                disabled={!clientId}
              >
                <SelectTrigger id="nq-contact" className="w-full">
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nq-pm">PM</Label>
              <Select
                value={pmId}
                onValueChange={(v) => v && setPmId(v)}
              >
                <SelectTrigger id="nq-pm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pmOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nq-title">Title</Label>
              <Input
                id="nq-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Driveway crossover — 12 Smith St"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nq-template">Template</Label>
              <Select value={templateId} onValueChange={(v) => v && setTemplateId(v)}>
                <SelectTrigger id="nq-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Standard layout</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !clientId}>
                {pending ? 'Creating…' : 'Create quote'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
