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
  createVendor,
  updateVendor,
  setVendorArchived,
  upsertComplianceDoc,
  deleteComplianceDoc,
} from './actions'
import {
  COMPLIANCE_DOC_KINDS,
  COMPLIANCE_DOC_KIND_LABELS,
  type ComplianceDocKind,
} from '@/lib/zod'
import { PlusIcon, PencilIcon, Trash2Icon } from 'lucide-react'

// ─── Shared vendor form fields ────────────────────────────────────────────────

interface VendorFormState {
  name: string
  abn: string
  tradesRaw: string
  contact_name: string
  email: string
  phone: string
  terms: string
  notes: string
  // Waste transport (migration 0054)
  street_number: string
  street_name: string
  suburb: string
  postcode: string
  is_waste_transporter: boolean
  agent_agreement_date: string
}

function useVendorFormState(initial?: Partial<VendorFormState>): [
  VendorFormState,
  {
    setName: (v: string) => void
    setAbn: (v: string) => void
    setTradesRaw: (v: string) => void
    setContactName: (v: string) => void
    setEmail: (v: string) => void
    setPhone: (v: string) => void
    setTerms: (v: string) => void
    setNotes: (v: string) => void
    setStreetNumber: (v: string) => void
    setStreetName: (v: string) => void
    setSuburb: (v: string) => void
    setPostcode: (v: string) => void
    setIsWasteTransporter: (v: boolean) => void
    setAgentAgreementDate: (v: string) => void
  },
] {
  const [name, setName] = useState(initial?.name ?? '')
  const [abn, setAbn] = useState(initial?.abn ?? '')
  const [tradesRaw, setTradesRaw] = useState(initial?.tradesRaw ?? '')
  const [contact_name, setContactName] = useState(initial?.contact_name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [terms, setTerms] = useState(initial?.terms ?? '30')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [street_number, setStreetNumber] = useState(initial?.street_number ?? '')
  const [street_name, setStreetName] = useState(initial?.street_name ?? '')
  const [suburb, setSuburb] = useState(initial?.suburb ?? '')
  const [postcode, setPostcode] = useState(initial?.postcode ?? '')
  const [is_waste_transporter, setIsWasteTransporter] = useState(
    initial?.is_waste_transporter ?? false
  )
  const [agent_agreement_date, setAgentAgreementDate] = useState(
    initial?.agent_agreement_date ?? ''
  )

  return [
    {
      name, abn, tradesRaw, contact_name, email, phone, terms, notes,
      street_number, street_name, suburb, postcode,
      is_waste_transporter, agent_agreement_date,
    },
    {
      setName, setAbn, setTradesRaw, setContactName, setEmail, setPhone,
      setTerms, setNotes, setStreetNumber, setStreetName, setSuburb,
      setPostcode, setIsWasteTransporter, setAgentAgreementDate,
    },
  ]
}

function VendorFormFields({
  state,
  handlers,
  idPrefix,
}: {
  state: VendorFormState
  handlers: ReturnType<typeof useVendorFormState>[1]
  idPrefix: string
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          value={state.name}
          onChange={(e) => handlers.setName(e.target.value)}
          placeholder="Acme Electrical"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-abn`}>ABN (optional)</Label>
        <Input
          id={`${idPrefix}-abn`}
          value={state.abn}
          onChange={(e) => handlers.setAbn(e.target.value)}
          placeholder="12 345 678 901"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-trades`}>
          Trades (comma-separated)
        </Label>
        <Input
          id={`${idPrefix}-trades`}
          value={state.tradesRaw}
          onChange={(e) => handlers.setTradesRaw(e.target.value)}
          placeholder="Electrical, Data, Fire"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-contact`}>Contact name</Label>
        <Input
          id={`${idPrefix}-contact`}
          value={state.contact_name}
          onChange={(e) => handlers.setContactName(e.target.value)}
          placeholder="Jane Smith"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-email`}>Email</Label>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          value={state.email}
          onChange={(e) => handlers.setEmail(e.target.value)}
          placeholder="jane@example.com"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-phone`}>Phone</Label>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          value={state.phone}
          onChange={(e) => handlers.setPhone(e.target.value)}
          placeholder="0400 000 000"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-terms`}>Payment terms (days)</Label>
        <Input
          id={`${idPrefix}-terms`}
          type="number"
          min={0}
          max={120}
          value={state.terms}
          onChange={(e) => handlers.setTerms(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          value={state.notes}
          onChange={(e) => handlers.setNotes(e.target.value)}
          placeholder="Optional notes…"
        />
      </div>

      {/* Regulated waste transport. The depot address is required by the BUDF
          record (fields 26–29, all null-not-allowed), so it is captured here
          rather than at the gate. The EA NUMBER is not here — it is a
          compliance document, which is what gives it expiry monitoring. */}
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={state.is_waste_transporter}
            onChange={(e) => handlers.setIsWasteTransporter(e.target.checked)}
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Regulated waste transporter</span>
            <span className="text-xs text-muted-foreground">
              Selectable at the gate for trackable waste. Add their
              environmental authority as a compliance document below — a
              transporter without one cannot be given trackable waste (s96).
            </span>
          </span>
        </label>

        {state.is_waste_transporter && (
          <>
            <div className="flex gap-2">
              <div className="flex w-1/3 flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-street-no`}>Depot street no.</Label>
                <Input
                  id={`${idPrefix}-street-no`}
                  value={state.street_number}
                  onChange={(e) => handlers.setStreetNumber(e.target.value)}
                  maxLength={20}
                  placeholder="14"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-street-name`}>Street name</Label>
                <Input
                  id={`${idPrefix}-street-name`}
                  value={state.street_name}
                  onChange={(e) => handlers.setStreetName(e.target.value)}
                  maxLength={40}
                  placeholder="Depot Road"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-suburb`}>Suburb</Label>
                <Input
                  id={`${idPrefix}-suburb`}
                  value={state.suburb}
                  onChange={(e) => handlers.setSuburb(e.target.value)}
                  maxLength={25}
                />
              </div>
              <div className="flex w-28 flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-postcode`}>Postcode</Label>
                <Input
                  id={`${idPrefix}-postcode`}
                  value={state.postcode}
                  onChange={(e) => handlers.setPostcode(e.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-agent`}>
                Agent agreement signed (optional)
              </Label>
              <Input
                id={`${idPrefix}-agent`}
                type="date"
                value={state.agent_agreement_date}
                onChange={(e) => handlers.setAgentAgreementDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Bulk upload lodges their part under our identifier, which makes
                us their agent. The department may ask to see the agreement.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ─── New Vendor Dialog ────────────────────────────────────────────────────────

export function NewVendorDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [state, handlers] = useVendorFormState()

  function reset() {
    handlers.setName('')
    handlers.setAbn('')
    handlers.setTradesRaw('')
    handlers.setContactName('')
    handlers.setEmail('')
    handlers.setPhone('')
    handlers.setTerms('30')
    handlers.setNotes('')
    handlers.setStreetNumber('')
    handlers.setStreetName('')
    handlers.setSuburb('')
    handlers.setPostcode('')
    handlers.setIsWasteTransporter(false)
    handlers.setAgentAgreementDate('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createVendor({
        name: state.name,
        abn: state.abn,
        trades: state.tradesRaw,
        contact_name: state.contact_name,
        email: state.email,
        phone: state.phone,
        payment_terms_days: Number(state.terms),
        notes: state.notes,
        street_number: state.street_number,
        street_name: state.street_name,
        suburb: state.suburb,
        postcode: state.postcode,
        is_waste_transporter: state.is_waste_transporter,
        agent_agreement_date: state.agent_agreement_date || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Supplier created')
      setOpen(false)
      reset()
      if (result.id) {
        router.push(`/vendors/${result.id}`)
      }
    })
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        New supplier
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New supplier</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <VendorFormFields
              state={state}
              handlers={handlers}
              idPrefix="nv"
            />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create supplier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Edit Vendor Dialog ───────────────────────────────────────────────────────

interface VendorDetail {
  id: string
  name: string
  abn: string | null
  trades: string[]
  contact_name: string | null
  email: string | null
  phone: string | null
  payment_terms_days: number
  notes: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  postcode: string | null
  is_waste_transporter: boolean
  agent_agreement_date: string | null
}

export function EditVendorDialog({ vendor }: { vendor: VendorDetail }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [state, handlers] = useVendorFormState({
    name: vendor.name,
    abn: vendor.abn ?? '',
    tradesRaw: vendor.trades.join(', '),
    contact_name: vendor.contact_name ?? '',
    email: vendor.email ?? '',
    phone: vendor.phone ?? '',
    terms: String(vendor.payment_terms_days),
    notes: vendor.notes ?? '',
    street_number: vendor.street_number ?? '',
    street_name: vendor.street_name ?? '',
    suburb: vendor.suburb ?? '',
    postcode: vendor.postcode ?? '',
    is_waste_transporter: vendor.is_waste_transporter,
    agent_agreement_date: vendor.agent_agreement_date ?? '',
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateVendor(vendor.id, {
        name: state.name,
        abn: state.abn,
        trades: state.tradesRaw,
        contact_name: state.contact_name,
        email: state.email,
        phone: state.phone,
        payment_terms_days: Number(state.terms),
        notes: state.notes,
        street_number: state.street_number,
        street_name: state.street_name,
        suburb: state.suburb,
        postcode: state.postcode,
        is_waste_transporter: state.is_waste_transporter,
        agent_agreement_date: state.agent_agreement_date || null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Supplier updated')
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
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit supplier</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <VendorFormFields
              state={state}
              handlers={handlers}
              idPrefix="ev"
            />
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

// ─── Archive Vendor Button ────────────────────────────────────────────────────

export function ArchiveVendorButton({
  vendorId,
  archived = false,
}: {
  vendorId: string
  archived?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleToggle() {
    const message = archived
      ? 'Unarchive this supplier? They will appear in the supplier list again.'
      : 'Archive this supplier? They will no longer appear in the supplier list.'
    if (!confirm(message)) return
    startTransition(async () => {
      const result = await setVendorArchived(vendorId, !archived)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(archived ? 'Supplier unarchived' : 'Supplier archived')
      if (!archived) {
        router.push('/vendors')
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

// ─── Compliance Doc Dialog ────────────────────────────────────────────────────

interface ComplianceDocRow {
  id: string
  vendor_id: string
  kind: ComplianceDocKind
  reference: string | null
  expiry_date: string
}

interface ComplianceDocDialogProps {
  vendorId: string
  doc?: ComplianceDocRow
  trigger?: React.ReactNode
}

export function ComplianceDocDialog({
  vendorId,
  doc,
  trigger,
}: ComplianceDocDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [kind, setKind] = useState<ComplianceDocKind>(
    doc?.kind ?? 'public_liability'
  )
  const [reference, setReference] = useState(doc?.reference ?? '')
  const [expiryDate, setExpiryDate] = useState(doc?.expiry_date ?? '')

  function reset() {
    if (!doc) {
      setKind('public_liability')
      setReference('')
      setExpiryDate('')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await upsertComplianceDoc({
        id: doc?.id,
        vendor_id: vendorId,
        kind,
        reference,
        expiry_date: expiryDate,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(doc ? 'Document updated' : 'Document added')
      setOpen(false)
      reset()
    })
  }

  const defaultTrigger = doc ? (
    <Button variant="ghost" size="icon-sm">
      <PencilIcon />
      <span className="sr-only">Edit document</span>
    </Button>
  ) : (
    <Button variant="outline" size="sm">
      <PlusIcon />
      Add document
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
            <DialogTitle>
              {doc ? 'Edit compliance document' : 'Add compliance document'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-kind">Document type</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as ComplianceDocKind)}
              >
                <SelectTrigger id="cd-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPLIANCE_DOC_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {COMPLIANCE_DOC_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-ref">Reference / policy number</Label>
              <Input
                id="cd-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="POL-12345"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cd-expiry">Expiry date</Label>
              <Input
                id="cd-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending
                  ? 'Saving…'
                  : doc ? 'Save changes' : 'Add document'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Delete Compliance Doc Button ─────────────────────────────────────────────

export function DeleteComplianceDocButton({
  docId,
  vendorId,
}: {
  docId: string
  vendorId: string
}) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('Delete this compliance document?')) return
    startTransition(async () => {
      const result = await deleteComplianceDoc(docId, vendorId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Document deleted')
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
      <span className="sr-only">Delete document</span>
    </Button>
  )
}
