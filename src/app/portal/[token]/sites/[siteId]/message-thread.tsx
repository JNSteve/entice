'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SendIcon } from 'lucide-react'
import { postPortalMessage } from '../../actions'
import type { PortalMessageRow } from '../../portal-ui'

const NAME_STORAGE_KEY = 'entice-portal-sender-name'

export interface PortalMessageDisplay extends PortalMessageRow {
  /** Pre-formatted Brisbane datetime (server-rendered — no locale drift). */
  created_display: string
}

/**
 * Chat-style correspondence thread for one property. The client's own
 * messages sit right in brand navy; office replies sit left on white. The
 * thread itself is fetched server-side (portal_thread RPC, which also marks
 * office messages as read) and refreshed via router.refresh() after posting.
 */
export function MessageThread({
  token,
  siteId,
  companyName,
  messages,
}: {
  token: string
  siteId: string
  companyName: string
  messages: PortalMessageDisplay[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Remembered across visits (asked once, not per message). Lazy init reads
  // localStorage on the client; the SSR pass renders '' — suppressed below.
  const [name, setName] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      return window.localStorage.getItem(NAME_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await postPortalMessage({
        token,
        siteId,
        name,
        body,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      try {
        window.localStorage.setItem(NAME_STORAGE_KEY, name.trim())
      } catch {
        /* non-fatal */
      }
      setBody('')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Thread */}
      {messages.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            Start the conversation
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Questions about this property, its compliance or works? Send{' '}
            {companyName} a message — replies appear right here.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Message thread">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`flex ${m.sender === 'client' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[70%] ${
                  m.sender === 'client'
                    ? 'rounded-br-md bg-[#1e3a5f] text-white'
                    : 'rounded-bl-md border bg-white text-slate-900 shadow-sm'
                }`}
              >
                <p
                  className={`text-[11px] font-semibold ${
                    m.sender === 'client' ? 'text-blue-200' : 'text-slate-500'
                  }`}
                >
                  {m.sender === 'client' ? m.sender_name : `${m.sender_name} — ${companyName}`}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {m.body}
                </p>
                <p
                  className={`mt-1 text-[10px] ${
                    m.sender === 'client' ? 'text-blue-200/80' : 'text-slate-400'
                  }`}
                >
                  {m.created_display}
                </p>
              </div>
            </li>
          ))}
          <div ref={endRef} />
        </ol>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="flex flex-col gap-2.5 rounded-2xl border bg-white p-3.5 shadow-sm"
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={120}
          required
          aria-label="Your name"
          suppressHydrationWarning
          className="h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none transition-colors focus:border-[#1e3a5f] sm:max-w-60"
        />
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message…"
            maxLength={2000}
            rows={2}
            required
            aria-label="Message"
            className="min-h-11 flex-1 resize-y rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#1e3a5f]"
          />
          <button
            type="submit"
            disabled={pending || !name.trim() || !body.trim()}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#1e3a5f] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            aria-label="Send message"
          >
            <SendIcon className="size-4" />
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
