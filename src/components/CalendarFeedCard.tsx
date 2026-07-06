'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CalendarPlusIcon, CopyIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { regenerateCalendarFeedToken } from '@/lib/calendar-actions'

const subscribeNoop = () => () => {}

/**
 * "Subscribe to my calendar" — shows the person's private ICS feed URL with
 * copy + regenerate. Rendered on the field My Day screen and the office
 * Schedule page (initialToken comes from the server page: the caller's own
 * calendar_feed_tokens row, RLS-scoped to self). Regenerating revokes the old
 * URL immediately.
 */
export function CalendarFeedCard({
  initialToken,
}: {
  initialToken: string | null
}) {
  const [token, setToken] = useState(initialToken)
  const [pending, startTransition] = useTransition()

  // SSR-safe origin: '' on the server, the real origin after hydration.
  const origin = React.useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => ''
  )

  const feedUrl = token ? `${origin}/api/calendar/staff/${token}` : null

  function copyUrl() {
    if (!feedUrl) return
    navigator.clipboard
      .writeText(feedUrl)
      .then(() => toast.success('Calendar link copied'))
      .catch(() => toast.error('Could not copy — copy it manually'))
  }

  function regenerate(isReplace: boolean) {
    if (
      isReplace &&
      !confirm(
        'Create a new calendar link? The current link stops working and any calendar using it will need the new one.'
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await regenerateCalendarFeedToken()
      if (result.error || !result.token) {
        toast.error(result.error ?? 'Could not create a calendar link')
        return
      }
      setToken(result.token)
      toast.success(isReplace ? 'New calendar link created — old link revoked' : 'Calendar link created')
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <CalendarPlusIcon className="size-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Subscribe to my calendar</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Your schedule as a live feed for Google, Outlook or Apple Calendar —
          add it via &ldquo;subscribe from URL&rdquo;. The link is private: anyone
          holding it can see your schedule, so regenerate it if it leaks.
        </p>

        {token ? (
          <>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={feedUrl ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
                aria-label="Calendar feed URL"
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Copy calendar link"
                onClick={copyUrl}
              >
                <CopyIcon className="size-4" />
              </Button>
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => regenerate(true)}
              >
                <RefreshCwIcon className="size-3.5" />
                Regenerate link
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => regenerate(false)}
            >
              <CalendarPlusIcon className="size-4" />
              Create my calendar link
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
