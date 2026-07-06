'use client'

import React from 'react'
import { CalendarPlusIcon, CopyIcon } from 'lucide-react'

/**
 * "Subscribe" card on the portal Calendar page: the client-link ICS feed URL
 * (/api/calendar/portal/[token]) with a copy button, so review dates and
 * works land in the client's own calendar app. Client component only for the
 * clipboard + origin; styled to match PortalCard (plain markup — portal-ui
 * stays server-only).
 */
const subscribeNoop = () => () => {}

export function CalendarSubscribe({ token }: { token: string }) {
  const [copied, setCopied] = React.useState(false)

  // SSR-safe origin: '' on the server, the real origin after hydration.
  const origin = React.useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => ''
  )

  const feedUrl = `${origin}/api/calendar/portal/${token}`

  function copyUrl() {
    navigator.clipboard
      .writeText(feedUrl)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => {
        // Clipboard unavailable (rare) — the input below stays selectable.
      })
  }

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarPlusIcon className="size-4 text-[#162040]" />
        <p className="text-sm font-semibold text-slate-900">
          Subscribe in your calendar app
        </p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Add this feed to Google, Outlook or Apple Calendar (&ldquo;subscribe
        from URL&rdquo;) and these dates stay up to date automatically.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          readOnly
          value={feedUrl}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Calendar feed URL"
          className="min-h-11 w-full min-w-0 flex-1 rounded-xl border bg-slate-50 px-3 font-mono text-xs text-slate-600"
        />
        <button
          type="button"
          onClick={copyUrl}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <CopyIcon className="size-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
