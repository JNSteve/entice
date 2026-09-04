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
  const [confirmSwitch, setConfirmSwitch] = useState(false)

  function patch(p: Partial<PricingDisplay>) {
    setDisplay((d) => ({ ...d, ...p }))
  }

  const templateChanged = editable && templateId !== (quote.template_id ?? STANDARD)

  /**
   * `apply` decides what to do about the quote's copy of the template:
   *  - 'auto'  save it if the wording matches, ask if it would change
   *  - 'force' take the template's wording, replacing this quote's
   *  - 'keep'  leave this quote's wording alone and just open the PDF
   */
  function openPdf(apply: 'auto' | 'force' | 'keep' = 'auto') {
    // Open the tab synchronously so popup blockers allow it; point it after
    // saving. Any question must be asked BEFORE this: the new tab takes focus,
    // and browsers suppress dialogs in a background tab.
    const tab = window.open('', '_blank')
    startTransition(async () => {
      try {
        if (editable) {
          if (apply !== 'keep') {
            const r = await applyQuoteTemplate(
              quote.id,
              templateId === STANDARD ? null : templateId,
              { force: apply === 'force' }
            )
            if (r.needsConfirm) {
              tab?.close()
              setConfirmSwitch(true)
              return
            }
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
        setConfirmSwitch(false)
        setOpen(false)
      } catch (err) {
        tab?.close()
        toast.error(err instanceof Error ? err.message : 'Could not open the PDF')
      }
    })
  }

  const mode = display.mode
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileDownIcon />
        PDF
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return
          setConfirmSwitch(false)
          setOpen(o)
        }}
      >
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
                onValueChange={(v) => {
                  if (!v) return
                  setTemplateId(v)
                  setConfirmSwitch(false)
                  // A template brings its own pricing defaults (applyQuoteTemplate
                  // saves them); show them so the dialog matches what will print.
                  const picked = templates.find((t) => t.id === v)
                  if (picked) setDisplay(picked.pricing_defaults)
                }}
                disabled={!editable}
              >
                <SelectTrigger id="qp-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STANDARD}>Standard layout</SelectItem>
                  {quote.template_id && !templates.some((t) => t.id === quote.template_id) && (
                    <SelectItem value={quote.template_id}>
                      {`${quote.template_name ?? 'Current template'} (inactive)`}
                    </SelectItem>
                  )}
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
          {confirmSwitch && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {templateChanged
                ? "Changing the template replaces this quote's wording, including any edits made in the Document card."
                : "This quote's wording differs from the template. Either the template was edited in Settings, or this quote was. Take the template's wording, or keep this quote's."}
            </p>
          )}
          <DialogFooter>
            {confirmSwitch ? (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    templateChanged ? setConfirmSwitch(false) : openPdf('keep')
                  }
                  disabled={pending}
                >
                  {templateChanged ? 'Keep current' : "Keep this quote's wording"}
                </Button>
                <Button onClick={() => openPdf('force')} disabled={pending}>
                  <FileDownIcon />
                  {pending
                    ? 'Preparing…'
                    : templateChanged
                      ? 'Replace and open'
                      : 'Use the template'}
                </Button>
              </>
            ) : (
              <Button onClick={() => openPdf()} disabled={pending}>
                <FileDownIcon />
                {pending ? 'Preparing…' : 'Open PDF'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
