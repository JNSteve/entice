import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SignoffStatusBadge } from '@/components/signoffs/SignoffStatusBadge'
import { daysSince } from '@/components/signoffs/SignoffRegister'

const TABS = [
  { value: 'release', label: 'To release', status: 'draft' },
  { value: 'awaiting', label: 'Awaiting client', status: 'released' },
  { value: 'disputed', label: 'Disputed', status: 'disputed' },
  { value: 'signed', label: 'Signed', status: 'signed' },
] as const

type TabValue = (typeof TABS)[number]['value']

type ClientRel = { name: string } | { name: string }[] | null
type JobRel = {
  id: string
  number: string
  title: string
  pm_id: string | null
  clients: ClientRel
}
type ProjectRel = {
  id: string
  number: string
  name: string
  pm_id: string | null
  clients: ClientRel
}

type Row = {
  id: string
  date: string
  version: number
  status: string
  released_at: string | null
  jobs: JobRel | JobRel[] | null
  projects: ProjectRel | ProjectRel[] | null
  daily_signoff_lines: { count: number }[] | { count: number } | null
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

export default async function SignoffsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; pm?: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const { tab: tabParam, pm } = await searchParams
  const tab: TabValue = TABS.some((t) => t.value === tabParam) ? (tabParam as TabValue) : 'release'
  const status = TABS.find((t) => t.value === tab)!.status
  const mine = pm === 'me'

  const supabase = await createClient()

  // "Mine" = works I am PM on. Resolve ids first: one sign-off belongs to
  // either a job or a project, so an inner embed filter would drop the other.
  let mineFilter: string | null = null
  if (mine) {
    const [{ data: myJobs }, { data: myProjects }] = await Promise.all([
      supabase.from('jobs').select('id').eq('pm_id', profile.id),
      supabase.from('projects').select('id').eq('pm_id', profile.id),
    ])
    const parts: string[] = []
    const jobIds = (myJobs ?? []).map((j) => j.id as string)
    const projectIds = (myProjects ?? []).map((p) => p.id as string)
    if (jobIds.length) parts.push(`job_id.in.(${jobIds.join(',')})`)
    if (projectIds.length) parts.push(`project_id.in.(${projectIds.join(',')})`)
    mineFilter = parts.length ? parts.join(',') : ''
  }

  let rows: Row[] = []
  if (mineFilter !== '') {
    let query = supabase
      .from('daily_signoffs')
      .select(
        `id, date, version, status, released_at,
         jobs(id, number, title, pm_id, clients(name)),
         projects(id, number, name, pm_id, clients(name)),
         daily_signoff_lines(count)`
      )
      .eq('status', status)
      .order('date', { ascending: tab !== 'signed' })
      .order('version', { ascending: false })
      .limit(tab === 'signed' ? 100 : 500)
    if (mineFilter) query = query.or(mineFilter)
    const { data } = await query
    rows = (data ?? []) as unknown as Row[]
  }

  function href(nextTab: TabValue, nextMine: boolean) {
    const params = new URLSearchParams()
    if (nextTab !== 'release') params.set('tab', nextTab)
    if (nextMine) params.set('pm', 'me')
    const qs = params.toString()
    return qs ? `/signoffs?${qs}` : '/signoffs'
  }

  const linkClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1 text-sm transition-colors',
      active
        ? 'bg-background font-medium text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Daily sign-offs"
        description="Daily crew time and usage for client sign-off. Quantities only."
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-fit flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <Link key={t.value} href={href(t.value, mine)} className={linkClass(tab === t.value)}>
              {t.label}
            </Link>
          ))}
        </div>
        <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
          <Link href={href(tab, !mine)} className={linkClass(mine)}>
            Mine
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Work</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                {tab === 'awaiting' && <TableHead className="text-right">Days waiting</TableHead>}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const job = one(r.jobs)
                const project = one(r.projects)
                const work = job
                  ? { label: `${job.number} — ${job.title}`, href: `/jobs/${job.id}`, client: one(job.clients)?.name }
                  : project
                    ? {
                        label: `${project.number} — ${project.name}`,
                        href: `/projects/${project.id}/signoffs`,
                        client: one(project.clients)?.name,
                      }
                    : null
                const lineCount = one(r.daily_signoff_lines)?.count ?? 0
                const waiting = r.status === 'released' ? daysSince(r.released_at) : null
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                    <TableCell>
                      {work ? (
                        <Link href={work.href} className="hover:underline">
                          {work.label}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{work?.client ?? '—'}</TableCell>
                    <TableCell>{r.version > 1 ? `v${r.version}` : ''}</TableCell>
                    <TableCell>
                      <SignoffStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{lineCount}</TableCell>
                    {tab === 'awaiting' && (
                      <TableCell className="text-right tabular-nums">{waiting ?? '—'}</TableCell>
                    )}
                    <TableCell className="text-right">
                      <Link href={`/signoffs/${r.id}`} className="text-sm font-medium hover:underline">
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
