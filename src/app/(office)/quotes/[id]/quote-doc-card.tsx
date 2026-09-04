'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DocBlocksEditor } from '@/components/DocBlocksEditor'
import type { QuoteDoc, TemplateState } from '@/lib/quote-doc'
import { applyQuoteTemplate, updateQuoteDoc } from '../actions'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  RefreshCwIcon,
} from 'lucide-react'

/**
 * The quote's own copy of its template. The header line says how that copy
 * relates to the template today, and offers the one action that makes sense:
 * pull the template's newer wording in, or reset customised wording to it.
 */
export function QuoteDocCard({
  quoteId,
  doc,
  templateId,
  templateName,
  templateState,
  status,
  editable,
}: {
  quoteId: string
  doc: QuoteDoc | null
  templateId: string | null
  templateName: string | null
  templateState: TemplateState
  status: 'draft' | 'sent' | 'accepted' | 'lost'
  editable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [openEditor, setOpenEditor] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const docJson = JSON.stringify(doc)
  const [draft, setDraft] = useState<QuoteDoc | null>(doc)
  const [baseJson, setBaseJson] = useState(docJson)
  // Adopt a changed server document (template applied from the PDF dialog,
  // or our own save coming back normalised) — React's derive-state-from-props
  // pattern. Refreshes that leave the document unchanged keep unsaved edits.
  if (docJson !== baseJson) {
    setBaseJson(docJson)
    setDraft(doc)
  }
  const dirty = JSON.stringify(draft) !== docJson

  if (!doc) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
          <FileTextIcon className="size-4" />
          Standard layout. Choose a template from the PDF button to add scope, assumptions,
          exclusions and terms.
        </CardContent>
      </Card>
    )
  }

  function save() {
    if (!draft) return
    startTransition(async () => {
      const r = await updateQuoteDoc(quoteId, draft)
      if (r.error) {
        toast.error(r.error)
        return
      }
      toast.success('Document saved')
      router.refresh()
    })
  }

  function takeTemplate() {
    if (!templateId) return
    startTransition(async () => {
      const r = await applyQuoteTemplate(quoteId, templateId, { force: true })
      if (r.error) {
        toast.error(r.error)
        return
      }
      toast.success('Updated from the template')
      setConfirmReset(false)
      router.refresh()
    })
  }

  const canTake = editable && Boolean(templateId)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-2 text-left text-sm font-semibold"
            onClick={() => setOpenEditor((o) => !o)}
          >
            {openEditor ? (
              <ChevronDownIcon className="size-4" />
            ) : (
              <ChevronRightIcon className="size-4" />
            )}
            Document{templateName ? ` · ${templateName}` : ''}
            <span className="font-normal text-muted-foreground">
              ({doc.blocks.length} sections)
            </span>
          </button>

          {templateState === 'current' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckIcon className="size-3.5" />
              Matches the template
            </span>
          )}

          {templateState === 'template_changed' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-amber-700 dark:text-amber-300">
                The template has changed since this copy was taken.
              </span>
              {canTake && (
                <Button size="sm" variant="outline" onClick={takeTemplate} disabled={pending}>
                  <RefreshCwIcon />
                  {pending ? 'Updating…' : 'Update from template'}
                </Button>
              )}
            </div>
          )}

          {templateState === 'differs' && !confirmReset && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>This copy differs from the template.</span>
              {canTake && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmReset(true)}
                  disabled={pending}
                >
                  <RefreshCwIcon />
                  Update from template
                </Button>
              )}
            </div>
          )}

          {templateState === 'customised' && !confirmReset && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Customised on this quote; template changes are not applied.</span>
              {canTake && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmReset(true)}
                  disabled={pending}
                >
                  Reset to template
                </Button>
              )}
            </div>
          )}
        </div>

        {confirmReset && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <span>
              {templateState === 'customised'
                ? "Resetting replaces the wording customised on this quote with the template's."
                : "Updating replaces this quote's wording with the template's."}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmReset(false)} disabled={pending}>
                Keep mine
              </Button>
              <Button size="sm" onClick={takeTemplate} disabled={pending}>
                {pending ? 'Resetting…' : 'Replace with template'}
              </Button>
            </span>
          </div>
        )}

        {status !== 'draft' && templateState !== 'standard' && (
          <p className="text-xs text-muted-foreground">
            This quote has been {status}. Its wording only changes when you choose to update it.
          </p>
        )}

        {openEditor && draft && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qd-heading">Service heading</Label>
                <Input
                  id="qd-heading"
                  value={draft.heading ?? ''}
                  onChange={(e) => setDraft({ ...draft, heading: e.target.value || null })}
                  disabled={!editable}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qd-validity">Validity text</Label>
                <Input
                  id="qd-validity"
                  value={draft.validity_text}
                  onChange={(e) => setDraft({ ...draft, validity_text: e.target.value })}
                  disabled={!editable}
                />
              </div>
            </div>
            <DocBlocksEditor
              value={draft.blocks}
              onChange={(blocks) => setDraft({ ...draft, blocks })}
              disabled={!editable}
            />
            {editable && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(doc)} disabled={!dirty || pending}>
                  Discard
                </Button>
                <Button onClick={save} disabled={!dirty || pending}>
                  {pending ? 'Saving…' : 'Save document'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
