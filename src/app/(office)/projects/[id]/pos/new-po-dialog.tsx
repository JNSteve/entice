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
import { Textarea } from '@/components/ui/textarea'
import { PlusIcon } from 'lucide-react'
import { createPo, createVendorQuick } from './actions'

export interface VendorOption {
  id: string
  name: string
}

interface NewPoDialogProps {
  projectId: string
  vendors: VendorOption[]
}

export function NewPoDialog({ projectId, vendors: initialVendors }: NewPoDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Main form state
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')

  // Inline vendors list (grows when quick-add succeeds)
  const [vendors, setVendors] = useState<VendorOption[]>(initialVendors)

  // Quick-add vendor sub-dialog
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickPending, startQuickTransition] = useTransition()
  const [quickName, setQuickName] = useState('')
  const [quickEmail, setQuickEmail] = useState('')
  const [quickTrade, setQuickTrade] = useState('')

  function resetMain() {
    setVendorId('')
    setNotes('')
  }

  function resetQuick() {
    setQuickName('')
    setQuickEmail('')
    setQuickTrade('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!vendorId) {
      toast.error('Pick a vendor')
      return
    }
    startTransition(async () => {
      const result = await createPo({ project_id: projectId, vendor_id: vendorId, notes: notes || undefined })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Purchase order created')
      setOpen(false)
      resetMain()
      router.push(`/projects/${projectId}/pos/${result.id}`)
    })
  }

  function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault()
    startQuickTransition(async () => {
      const result = await createVendorQuick({
        name: quickName,
        email: quickEmail || undefined,
        trade: quickTrade || undefined,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Vendor "${result.name}" added`)
      setVendors((prev) => [...prev, { id: result.id!, name: result.name! }])
      setVendorId(result.id!)
      setQuickOpen(false)
      resetQuick()
    })
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        New PO
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="po-vendor">Vendor</Label>
              <Select
                value={vendorId || null}
                onValueChange={(v) => {
                  if (!v) return
                  if (v === '__new__') {
                    setQuickOpen(true)
                  } else {
                    setVendorId(v)
                  }
                }}
              >
                <SelectTrigger id="po-vendor" className="w-full">
                  <SelectValue placeholder="Pick a vendor…" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new__" className="text-primary font-medium">
                    <PlusIcon className="mr-1 inline size-3" />
                    New vendor…
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="po-notes">Notes (optional)</Label>
              <Textarea
                id="po-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Scope, reference, delivery instructions…"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !vendorId}>
                {pending ? 'Creating…' : 'Create PO'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick-add vendor sub-dialog */}
      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add vendor</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleQuickAdd} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qv-name">Vendor name</Label>
              <Input
                id="qv-name"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="Acme Supplies"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qv-email">Email (optional)</Label>
              <Input
                id="qv-email"
                type="email"
                value={quickEmail}
                onChange={(e) => setQuickEmail(e.target.value)}
                placeholder="orders@acme.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qv-trade">Trade (optional)</Label>
              <Input
                id="qv-trade"
                value={quickTrade}
                onChange={(e) => setQuickTrade(e.target.value)}
                placeholder="Concrete, Electrical…"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setQuickOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={quickPending || !quickName}>
                {quickPending ? 'Adding…' : 'Add vendor'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
