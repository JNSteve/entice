import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { workKey } from '@/lib/live-work'
import {
  fetchLiveWork,
  fetchOpenEntry,
  fetchScheduledKeys,
} from '@/lib/field-work-queries'
import { JobsList } from './jobs-list'

export default async function FieldJobsPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const [rows, scheduledKeys, open] = await Promise.all([
    fetchLiveWork(supabase),
    fetchScheduledKeys(supabase, profile.id, todayAU()),
    fetchOpenEntry(supabase, profile.id),
  ])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Jobs</h1>
        <p className="text-sm text-muted-foreground">Every live job and project.</p>
      </div>
      <JobsList
        rows={rows}
        scheduledKeys={scheduledKeys}
        checkedInKey={open ? workKey(open.kind, open.workId) : null}
      />
    </div>
  )
}
