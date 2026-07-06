'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { StarIcon } from 'lucide-react'
import { submitPortalFeedback } from '../../actions'
import { FEEDBACK_MAX_COMMENT_CHARS } from '@/lib/feedback'

/**
 * "How did we do?" — the compact satisfaction card shown on completed works
 * in the portal works history (CP3). Stars + optional comment, one submission
 * per portal link per work (the SQL fn enforces it). Ratings feed the
 * customer-satisfaction KPI (customer_satisfaction_avg).
 */
export function FeedbackCard({
  token,
  kind,
  id,
  companyName,
}: {
  token: string
  kind: 'job' | 'project'
  id: string
  companyName: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await submitPortalFeedback({
        token,
        kind,
        id,
        rating,
        comment,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      setDone(true)
      router.refresh()
    })
  }

  if (done) {
    return (
      <div className="rounded-xl bg-green-50 px-3.5 py-3 text-sm font-medium text-green-800">
        Thanks for your feedback!
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5"
    >
      <p className="text-sm font-semibold text-slate-800">How did we do?</p>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating out of 5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={`${star} star${star === 1 ? '' : 's'}`}
            onClick={() => setRating(star)}
            className="flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-white"
          >
            <StarIcon
              className={`size-7 transition-colors ${
                star <= rating
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-transparent text-slate-300'
              }`}
            />
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={`Anything you'd like ${companyName} to know? (optional)`}
            maxLength={FEEDBACK_MAX_COMMENT_CHARS}
            rows={2}
            aria-label="Feedback comment"
            className="min-h-11 w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#162040]"
          />
          <button
            type="submit"
            disabled={pending}
            className="flex min-h-11 w-fit items-center rounded-xl bg-[#162040] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? 'Sending…' : 'Send feedback'}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
