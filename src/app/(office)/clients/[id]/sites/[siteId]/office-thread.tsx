'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MessageSquareIcon, SendIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { markThreadRead, sendOfficeMessage } from './message-actions'

export interface OfficeMessageRow {
  id: string
  sender: 'client' | 'office'
  sender_name: string
  body: string
  /** Pre-formatted Brisbane datetime (server-rendered). */
  created_display: string
  unread: boolean
}

/**
 * Office view of a property's portal correspondence: client messages left,
 * office replies right. Opening the thread marks client messages read (badge
 * clears on the dashboard and client card).
 */
export function OfficeThread({
  clientId,
  siteId,
  clientName,
  messages,
  unreadCount,
  canReply,
}: {
  clientId: string
  siteId: string
  clientName: string
  messages: OfficeMessageRow[]
  unreadCount: number
  canReply: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const markedRef = useRef(false)

  // Mark-read once on open (only when something is unread).
  useEffect(() => {
    if (markedRef.current || unreadCount === 0 || !canReply) return
    markedRef.current = true
    void markThreadRead(clientId, siteId)
  }, [clientId, siteId, unreadCount, canReply])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await sendOfficeMessage({
        client_id: clientId,
        site_id: siteId,
        body,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setBody('')
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <MessageSquareIcon className="size-4 text-muted-foreground" />
        Client messages
        {unreadCount > 0 && (
          <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
            {unreadCount} unread
          </Badge>
        )}
      </h2>

      <div className="flex flex-col gap-3 rounded-xl border p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No portal messages for this property yet. When {clientName} writes
            through their portal link, the conversation lands here.
          </p>
        ) : (
          <ol className="flex max-h-96 flex-col gap-2.5 overflow-y-auto pr-1">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`flex ${m.sender === 'office' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 sm:max-w-[70%] ${
                    m.sender === 'office'
                      ? 'bg-primary text-primary-foreground'
                      : 'border bg-muted/40'
                  }`}
                >
                  <p
                    className={`text-[11px] font-semibold ${
                      m.sender === 'office'
                        ? 'text-primary-foreground/70'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {m.sender === 'client' ? `${m.sender_name} — ${clientName}` : m.sender_name}
                    {m.unread && m.sender === 'client' ? ' · new' : ''}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                  <p
                    className={`mt-0.5 text-[10px] ${
                      m.sender === 'office'
                        ? 'text-primary-foreground/60'
                        : 'text-muted-foreground/80'
                    }`}
                  >
                    {m.created_display}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {canReply && (
          <form onSubmit={handleSend} className="flex items-end gap-2 border-t pt-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Reply to ${clientName}…`}
              maxLength={2000}
              rows={2}
              className="min-h-10 flex-1 resize-y"
              aria-label="Reply"
            />
            <Button
              type="submit"
              size="icon"
              disabled={pending || !body.trim()}
              aria-label="Send reply"
            >
              <SendIcon className="size-4" />
            </Button>
          </form>
        )}
      </div>
    </section>
  )
}
