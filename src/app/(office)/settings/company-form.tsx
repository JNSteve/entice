'use client'

import React, { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { updateSettings } from './actions'

export interface SettingsRow {
  id: number
  company_name: string
  abn: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_path: string | null
  gst_rate: number
  quote_footer: string | null
  invoice_footer: string | null
  claim_footer: string | null
}

export function CompanyForm({ settings }: { settings: SettingsRow | null }) {
  const [pending, startTransition] = useTransition()

  const [companyName, setCompanyName] = useState(settings?.company_name ?? '')
  const [abn, setAbn] = useState(settings?.abn ?? '')
  const [address, setAddress] = useState(settings?.address ?? '')
  const [phone, setPhone] = useState(settings?.phone ?? '')
  const [email, setEmail] = useState(settings?.email ?? '')
  const [gstRate, setGstRate] = useState(String(settings?.gst_rate ?? 10))
  const [quoteFooter, setQuoteFooter] = useState(settings?.quote_footer ?? '')
  const [invoiceFooter, setInvoiceFooter] = useState(
    settings?.invoice_footer ?? ''
  )
  const [claimFooter, setClaimFooter] = useState(settings?.claim_footer ?? '')
  const [logoPath, setLogoPath] = useState(settings?.logo_path ?? null)

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      let newLogoPath: string | undefined

      if (logoFile) {
        const ALLOWED = ['png', 'jpg', 'jpeg', 'svg', 'webp']
        const ext =
          logoFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ||
          ''
        if (!ALLOWED.includes(ext)) {
          toast.error('Logo must be PNG, JPG, SVG or WebP')
          return
        }
        const path = `logo.${ext}`
        const supabase = createClient()
        const { error: uploadError } = await supabase.storage
          .from('branding')
          .upload(path, logoFile, {
            upsert: true,
            contentType: logoFile.type || undefined,
          })
        if (uploadError) {
          toast.error(`Logo upload failed: ${uploadError.message}`)
          return
        }
        const { data } = supabase.storage.from('branding').getPublicUrl(path)
        // Cache-bust so the new image shows immediately after replacement.
        newLogoPath = `${data.publicUrl}?v=${Date.now()}`
      }

      const result = await updateSettings({
        company_name: companyName,
        abn,
        address,
        phone,
        email,
        gst_rate: gstRate,
        quote_footer: quoteFooter,
        invoice_footer: invoiceFooter,
        claim_footer: claimFooter,
        ...(newLogoPath !== undefined ? { logo_path: newLogoPath } : {}),
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (newLogoPath !== undefined) {
        setLogoPath(newLogoPath)
        setLogoFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
      toast.success('Settings saved')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Company details</CardTitle>
          <CardDescription>
            Shown on quotes, invoices and progress claims.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cs-name">Company name</Label>
              <Input
                id="cs-name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cs-abn">ABN</Label>
              <Input
                id="cs-abn"
                value={abn}
                onChange={(e) => setAbn(e.target.value)}
                placeholder="12 345 678 901"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-address">Address</Label>
            <Input
              id="cs-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Sydney NSW 2000"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cs-phone">Phone</Label>
              <Input
                id="cs-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="02 9000 0000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cs-email">Email</Label>
              <Input
                id="cs-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-gst">GST rate (%)</Label>
            <Input
              id="cs-gst"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
              className="max-w-28"
              required
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            Used on PDF documents. PNG or JPG recommended.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {logoPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoPath}
              alt="Company logo"
              className="h-16 w-auto self-start rounded border bg-white object-contain p-1"
            />
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-logo">
              {logoPath ? 'Replace logo' : 'Upload logo'}
            </Label>
            <Input
              id="cs-logo"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Document footers</CardTitle>
          <CardDescription>
            Payment terms, bank details and fine print printed at the bottom of
            documents.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-quote-footer">Quote footer</Label>
            <Textarea
              id="cs-quote-footer"
              value={quoteFooter}
              onChange={(e) => setQuoteFooter(e.target.value)}
              rows={3}
              placeholder="Exclusions, payment terms, site access assumptions…"
            />
            <p className="text-xs text-muted-foreground">
              Prints on quote PDFs under the validity line.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-invoice-footer">Invoice footer</Label>
            <Textarea
              id="cs-invoice-footer"
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs-claim-footer">Claim footer</Label>
            <Textarea
              id="cs-claim-footer"
              value={claimFooter}
              onChange={(e) => setClaimFooter(e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
