'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { linkInvoiceToJob } from '../invoices/actions'
import type { InvoiceRow } from './xero-export-button'

type JobOption = { id: string; number: string; title: string; status: string }

/** Needs-matching queue: attach a Xero-raised invoice to one of the client's jobs. */
export function MatchJobDialog({ invoice, onClose }: { invoice: InvoiceRow | null; onClose: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [jobId, setJobId] = useState('')
  // Reset the picked job whenever a different invoice is opened for matching.
  // (Adjusted during render rather than in the effect below, per the react-hooks
  // set-state-in-effect rule — see https://react.dev/learn/you-might-not-need-an-effect)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  if (invoice && invoice.id !== loadedFor) {
    setLoadedFor(invoice.id)
    setJobId('')
  }

  useEffect(() => {
    if (!invoice) return
    const supabase = createClient()
    supabase
      .from('jobs')
      .select('id, number, title, status')
      .eq('client_id', invoice.client_id)
      .eq('archived', false)
      .not('status', 'in', '("quote","lost")')
      .order('created_at', { ascending: false })
      .then(({ data }) => setJobs((data ?? []) as JobOption[]))
  }, [invoice])

  function submit() {
    if (!invoice || !jobId) return
    start(async () => {
      const r = await linkInvoiceToJob(invoice.id, jobId)
      if (r.error) { toast.error(r.error); return }
      toast.success(`${invoice.number} linked`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={invoice !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{invoice ? `Match ${invoice.number} to a job` : 'Match invoice'}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{invoice ? `Raised in Xero for ${invoice.client_name}. Pick the job it belongs to so it shows on the job card and in reports.` : ''}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="match-job">Job</Label>
          <select id="match-job" className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-sm" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">— choose a job —</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{`${j.number} — ${j.title} (${j.status})`}</option>)}
          </select>
          {jobs.length === 0 && <p className="text-xs text-muted-foreground">This client has no open jobs. Leave the invoice unmatched or create the job first.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !jobId}>{pending ? 'Linking…' : 'Link'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
