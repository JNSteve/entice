'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createClient,
  updateClient,
  archiveClient,
  upsertContact,
  deleteContact,
  upsertSite,
  deleteSite,
} from './actions'
import { CLIENT_TYPES, type ClientType } from '@/lib/zod'
import { PlusIcon, PencilIcon, Trash2Icon } from 'lucide-react'

const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  builder: 'Builder',
  strata: 'Strata',
  council: 'Council',
  government: 'Government',
  facility_manager: 'Facility Manager',
  insurer: 'Insurer',
  private: 'Private',
  other: 'Other',
}

// ─── New Client Dialog ────────────────────────────────────────────────────────

export function NewClientDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [type, setType] = useState<ClientType>('builder')
  const [abn, setAbn] = useState('')
  const [terms, setTerms] = useState('30')
  const [notes, setNotes] = useState('')

  function reset() {
    setName('')
    setType('builder')
    setAbn('')
    setTerms('30')
    setNotes('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createClient({
        name,
        type,
        abn,
        payment_terms_days: Number(terms),
        notes,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Client created')
      setOpen(false)
      reset()
      if (result.id) {
        router.push(`/clients/${result.id}`)
      }
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        New client
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-name">Name</Label>
              <Input
                id="nc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ClientType)}>
                <SelectTrigger id="nc-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CLIENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-abn">ABN (optional)</Label>
              <Input
                id="nc-abn"
                value={abn}
                onChange={(e) => setAbn(e.target.value)}
                placeholder="12 345 678 901"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-terms">Payment terms (days)</Label>
              <Input
                id="nc-terms"
                type="number"
                min={0}
                max={120}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-notes">Notes</Label>
              <Textarea
                id="nc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes…"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create client'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Edit Client Dialog ───────────────────────────────────────────────────────

interface ClientRow {
  id: string
  name: string
  type: ClientType
  abn: string | null
  payment_terms_days: number
  notes: string | null
}

export function EditClientDialog({ client }: { client: ClientRow }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(client.name)
  const [type, setType] = useState<ClientType>(client.type)
  const [abn, setAbn] = useState(client.abn ?? '')
  const [terms, setTerms] = useState(String(client.payment_terms_days))
  const [notes, setNotes] = useState(client.notes ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateClient(client.id, {
        name,
        type,
        abn,
        payment_terms_days: Number(terms),
        notes,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Client updated')
      setOpen(false)
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-name">Name</Label>
              <Input
                id="ec-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ClientType)}>
                <SelectTrigger id="ec-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CLIENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-abn">ABN (optional)</Label>
              <Input
                id="ec-abn"
                value={abn}
                onChange={(e) => setAbn(e.target.value)}
                placeholder="12 345 678 901"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-terms">Payment terms (days)</Label>
              <Input
                id="ec-terms"
                type="number"
                min={0}
                max={120}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-notes">Notes</Label>
              <Textarea
                id="ec-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Archive Client Button ────────────────────────────────────────────────────

export function ArchiveClientButton({
  clientId,
  archived = false,
}: {
  clientId: string
  archived?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleToggle() {
    const message = archived
      ? 'Unarchive this client? They will appear in the client list again.'
      : 'Archive this client? They will no longer appear in the client list.'
    if (!confirm(message)) return
    startTransition(async () => {
      const result = await archiveClient(clientId, !archived)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(archived ? 'Client unarchived' : 'Client archived')
      if (!archived) {
        router.push('/clients')
      }
    })
  }

  return (
    <Button variant="destructive" onClick={handleToggle} disabled={pending}>
      {pending
        ? archived ? 'Unarchiving…' : 'Archiving…'
        : archived ? 'Unarchive' : 'Archive'}
    </Button>
  )
}

// ─── Contact Dialog ───────────────────────────────────────────────────────────

interface ContactRow {
  id: string
  client_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
}

interface ContactDialogProps {
  clientId: string
  contact?: ContactRow
  trigger?: React.ReactNode
}

export function ContactDialog({ clientId, contact, trigger }: ContactDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(contact?.name ?? '')
  const [role, setRole] = useState(contact?.role ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')

  function reset() {
    if (!contact) {
      setName('')
      setRole('')
      setEmail('')
      setPhone('')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertContact({
        id: contact?.id,
        client_id: clientId,
        name,
        role,
        email,
        phone,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(contact ? 'Contact updated' : 'Contact added')
      setOpen(false)
      reset()
    })
  }

  const defaultTrigger = contact ? (
    <Button variant="ghost" size="icon-sm">
      <PencilIcon />
      <span className="sr-only">Edit contact</span>
    </Button>
  ) : (
    <Button variant="outline" size="sm">
      <PlusIcon />
      Add contact
    </Button>
  )

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger ?? defaultTrigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{contact ? 'Edit contact' : 'Add contact'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-name">Name</Label>
              <Input
                id="cd-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-role">Role / title</Label>
              <Input
                id="cd-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Project Manager"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-email">Email</Label>
              <Input
                id="cd-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-phone">Phone</Label>
              <Input
                id="cd-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0400 000 000"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Delete Contact Button ────────────────────────────────────────────────────

export function DeleteContactButton({
  contactId,
  clientId,
}: {
  contactId: string
  clientId: string
}) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('Delete this contact?')) return
    startTransition(async () => {
      const result = await deleteContact(contactId, clientId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Contact deleted')
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleDelete}
      disabled={pending}
    >
      <Trash2Icon className="text-destructive" />
      <span className="sr-only">Delete contact</span>
    </Button>
  )
}

// ─── Site Dialog ──────────────────────────────────────────────────────────────

interface SiteRow {
  id: string
  client_id: string
  name: string
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  notes: string | null
}

interface SiteDialogProps {
  clientId: string
  site?: SiteRow
  trigger?: React.ReactNode
}

export function SiteDialog({ clientId, site, trigger }: SiteDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(site?.name ?? '')
  const [address, setAddress] = useState(site?.address ?? '')
  const [suburb, setSuburb] = useState(site?.suburb ?? '')
  const [state, setState] = useState(site?.state ?? '')
  const [postcode, setPostcode] = useState(site?.postcode ?? '')
  const [notes, setNotes] = useState(site?.notes ?? '')

  function reset() {
    if (!site) {
      setName('')
      setAddress('')
      setSuburb('')
      setState('')
      setPostcode('')
      setNotes('')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertSite({
        id: site?.id,
        client_id: clientId,
        name,
        address,
        suburb,
        state,
        postcode,
        notes,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(site ? 'Site updated' : 'Site added')
      setOpen(false)
      reset()
    })
  }

  const defaultTrigger = site ? (
    <Button variant="ghost" size="icon-sm">
      <PencilIcon />
      <span className="sr-only">Edit site</span>
    </Button>
  ) : (
    <Button variant="outline" size="sm">
      <PlusIcon />
      Add site
    </Button>
  )

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger ?? defaultTrigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{site ? 'Edit site' : 'Add site'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sd-name">Site name</Label>
              <Input
                id="sd-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Main office"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sd-address">Address</Label>
              <Input
                id="sd-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sd-suburb">Suburb</Label>
                <Input
                  id="sd-suburb"
                  value={suburb}
                  onChange={(e) => setSuburb(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sd-state">State</Label>
                <Input
                  id="sd-state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="NSW"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sd-postcode">Postcode</Label>
              <Input
                id="sd-postcode"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                placeholder="2000"
                className="max-w-28"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sd-notes">Notes</Label>
              <Textarea
                id="sd-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : site ? 'Save changes' : 'Add site'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Delete Site Button ───────────────────────────────────────────────────────

export function DeleteSiteButton({
  siteId,
  clientId,
}: {
  siteId: string
  clientId: string
}) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('Delete this site?')) return
    startTransition(async () => {
      const result = await deleteSite(siteId, clientId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Site deleted')
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleDelete}
      disabled={pending}
    >
      <Trash2Icon className="text-destructive" />
      <span className="sr-only">Delete site</span>
    </Button>
  )
}
