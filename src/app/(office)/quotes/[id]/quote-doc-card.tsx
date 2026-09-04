'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DocBlocksEditor } from '@/components/DocBlocksEditor'
import type { QuoteDoc } from '@/lib/quote-doc'
import { updateQuoteDoc } from '../actions'
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon } from 'lucide-react'

export function QuoteDocCard({
  quoteId,
  doc,
  templateName,
  editable,
}: {
  quoteId: string
  doc: QuoteDoc | null
  templateName: string | null
  editable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [openEditor, setOpenEditor] = useState(false)
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

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
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
            <p className="text-xs text-muted-foreground">
              This is the quote&apos;s own copy of the template, so editing the template in
              Settings does not change it. To take a template edit, open the PDF dialog and
              choose to use the template&apos;s wording.
            </p>
            <DocBlocksEditor
              value={draft.blocks}
              onChange={(blocks) => setDraft({ ...draft, blocks })}
              disabled={!editable}
            />
            {editable && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDraft(doc)}
                  disabled={!dirty || pending}
                >
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
