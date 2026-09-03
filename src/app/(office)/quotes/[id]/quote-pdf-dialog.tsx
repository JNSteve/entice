'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  DEFAULT_PRICING,
  PRICING_MODES,
  PRICING_MODE_LABELS,
  type PricingDisplay,
} from '@/lib/quote-doc'
import { applyQuoteTemplate, updateQuotePdfOptions } from '../actions'
import type { QuoteData, TemplateOption } from './quote-builder'
import { FileDownIcon } from 'lucide-react'

const STANDARD = 'standard'

export function QuotePdfDialog({
  quote,
  templates,
  editable,
}: {
  quote: QuoteData
  templates: TemplateOption[]
  editable: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [templateId, setTemplateId] = useState(quote.template_id ?? STANDARD)
  const [display, setDisplay] = useState<PricingDisplay>(quote.pdf_options ?? DEFAULT_PRICING)

  function patch(p: Partial<PricingDisplay>) {
    setDisplay((d) => ({ ...d, ...p }))
  }

  function openPdf() {
    // Open the tab synchronously so popup blockers allow it; point it after saving.
    const tab = window.open('', '_blank')
    startTransition(async () => {
      if (editable) {
        const templateChanged = templateId !== (quote.template_id ?? STANDARD)
        if (templateChanged) {
          if (
            quote.doc &&
            !confirm("Switching templates replaces this quote's document text. Continue?")
          ) {
            tab?.close()
            return
          }
          const r = await applyQuoteTemplate(quote.id, templateId === STANDARD ? null : templateId)
          if (r.error) {
            tab?.close()
            toast.error(r.error)
            return
          }
        }
        const r2 = await updateQuotePdfOptions(quote.id, display)
        if (r2.error) {
          tab?.close()
          toast.error(r2.error)
          return
        }
        router.refresh()
      }
      const url = `/api/pdf/quote/${quote.id}`
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
      setOpen(false)
    })
  }

  const mode = display.mode
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileDownIcon />
        PDF
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quote PDF</DialogTitle>
            <DialogDescription>
              {editable
                ? 'Choices are saved on the quote and used for the client portal copy too.'
                : 'This quote is frozen; the saved layout is shown.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qp-template">Template</Label>
              <Select
                value={templateId}
                onValueChange={(v) => v && setTemplateId(v)}
                disabled={!editable}
              >
                <SelectTrigger id="qp-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STANDARD}>Standard layout</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qp-mode">Pricing display</Label>
              <Select
                value={mode}
                onValueChange={(v) => v && patch({ mode: v as PricingDisplay['mode'] })}
                disabled={!editable}
              >
                <SelectTrigger id="qp-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICING_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PRICING_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mode === 'lump_sum' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qp-fee">Fee label</Label>
                  <Input
                    id="qp-fee"
                    value={display.fee_label}
                    onChange={(e) => patch({ fee_label: e.target.value })}
                    disabled={!editable}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={display.list_items}
                    onCheckedChange={(c) => patch({ list_items: Boolean(c) })}
                    disabled={!editable}
                  />
                  List included items (no prices)
                </label>
              </>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={display.show_qty_unit}
                  onCheckedChange={(c) => patch({ show_qty_unit: Boolean(c) })}
                  disabled={!editable}
                />
                Show qty and unit columns
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={display.show_gst}
                onCheckedChange={(c) => patch({ show_gst: Boolean(c) })}
                disabled={!editable}
              />
              Show GST breakdown
            </label>
            <p className="text-xs text-muted-foreground">
              Cost price and markup are never printed.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={openPdf} disabled={pending}>
              <FileDownIcon />
              {pending ? 'Preparing…' : 'Open PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
