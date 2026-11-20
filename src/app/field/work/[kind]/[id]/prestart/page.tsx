import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CheckCircle2Icon, ChevronRightIcon, ShieldCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { fmtDateAU, fmtTimeAU } from '@/lib/field-today'
import { parseWorkKind } from '@/lib/live-work'
import { FORM_KIND_LABELS, FORM_KIND_ORDER } from '@/lib/form-kinds'
import type { FormTemplateKind } from '@/lib/zod'

type SubmissionRow = {
  id: string
  kind: string
  submitted_at: string
  by: string | null
  name: string | null
  /** The submission this one amends, if any (form_submissions.amends). */
  amends: string | null
}

const SUBMISSION_COLUMNS =
  'id, kind, submitted_at, amends, form_templates(name), profiles!form_submissions_submitted_by_fkey(full_name)'

function toRow(s: Record<string, unknown>): SubmissionRow {
  return {
    id: s.id as string,
    kind: s.kind as string,
    submitted_at: s.submitted_at as string,
    by: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
    name: (s.form_templates as unknown as { name: string } | null)?.name ?? null,
    amends: (s.amends as string | null) ?? null,
  }
}

export default async function WorkPrestartPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const col = kind === 'job' ? 'job_id' : 'project_id'
  const target = `${kind}=${id}`
  // Brisbane is fixed +10 — the AU day starts at T00:00:00+10:00.
  const dayStartMs = new Date(`${todayAU()}T00:00:00+10:00`).getTime()

  const supabase = await createClient()
  // Meetings and other forms are fetched separately, so a busy project's other
  // forms can't crowd the meetings out of their list (or the other way round).
  const [{ data: templates }, { data: rawMeetings }, { data: rawOthers }] = await Promise.all([
    supabase
      .from('form_templates')
      .select('id, kind, name, version')
      .eq('active', true)
      // Audit checklists are run from the office audit page, not the field.
      .neq('kind', 'audit')
      .order('version', { ascending: false }),
    supabase
      .from('form_submissions')
      .select(SUBMISSION_COLUMNS)
      .eq(col, id)
      .eq('kind', 'prestart_meeting')
      .order('submitted_at', { ascending: false })
      .limit(30),
    supabase
      .from('form_submissions')
      .select(SUBMISSION_COLUMNS)
      .eq(col, id)
      .neq('kind', 'prestart_meeting')
      .order('submitted_at', { ascending: false })
      .limit(10),
  ])

  const allMeetings = (rawMeetings ?? []).map((s) => toRow(s as Record<string, unknown>))
  const otherRecent = (rawOthers ?? []).map((s) => toRow(s as Record<string, unknown>))

  // An amended meeting is replaced by its amendment: list the newest version only.
  const superseded = new Set(
    allMeetings.map((m) => m.amends).filter((v): v is string => Boolean(v))
  )
  const meetings = allMeetings.filter((m) => !superseded.has(m.id))
  const todaysMeeting =
    meetings.find((m) => new Date(m.submitted_at).getTime() >= dayStartMs) ?? null
  const earlier = meetings.filter((m) => m.id !== todaysMeeting?.id).slice(0, 14)

  // Sign-ons stay on the version people signed, so count them across the
  // amendment chain, not only on the newest version.
  const byId = new Map(allMeetings.map((m) => [m.id, m]))
  const chainIds: string[] = []
  let cursor: SubmissionRow | null = todaysMeeting
  while (cursor && !chainIds.includes(cursor.id)) {
    chainIds.push(cursor.id)
    if (!cursor.amends) break
    const previous: SubmissionRow | undefined = byId.get(cursor.amends)
    if (!previous) {
      chainIds.push(cursor.amends)
      break
    }
    cursor = previous
  }

  // Templates come newest version first, so the first prestart_meeting is current.
  const meetingTemplate = (templates ?? []).find((t) => t.kind === 'prestart_meeting') ?? null
  const otherTemplates = (templates ?? [])
    .filter((t) => t.kind !== 'prestart_meeting')
    .sort(
      (a, b) =>
        FORM_KIND_ORDER.indexOf(a.kind as FormTemplateKind) -
        FORM_KIND_ORDER.indexOf(b.kind as FormTemplateKind)
    )

  let signedOn = 0
  if (chainIds.length > 0) {
    const { count } = await supabase
      .from('form_signons')
      .select('id', { count: 'exact', head: true })
      .in('submission_id', chainIds)
    signedOn = count ?? 0
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Today's pre-start meeting */}
      {todaysMeeting ? (
        <Link
          href={`/field/safety/submission/${todaysMeeting.id}`}
          className="flex items-center gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3"
        >
          <CheckCircle2Icon className="size-5 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Pre-start meeting done</p>
            <p className="truncate text-xs text-muted-foreground">
              {todaysMeeting.by ?? 'Someone'} · {fmtTimeAU(todaysMeeting.submitted_at)} ·{' '}
              {signedOn} signed on
            </p>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : meetingTemplate ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-semibold">No pre-start meeting yet today</p>
          </div>
          <Button
            className="w-full"
            render={<Link href={`/field/safety/new/${meetingTemplate.id}?${target}`} />}
          >
            Start pre-start meeting
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No pre-start meeting form is set up. Ask the office to add one in Settings.
        </p>
      )}

      {/* Earlier pre-starts */}
      {earlier.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Earlier on this job
          </h2>
          <div className="flex flex-col divide-y rounded-xl border">
            {earlier.map((m) => (
              <Link
                key={m.id}
                href={`/field/safety/submission/${m.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="text-sm">{fmtDateAU(m.submitted_at)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {m.by ?? ''}
                  <ChevronRightIcon className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Other forms */}
      {otherTemplates.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Other forms for this job
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {otherTemplates.map((t) => (
              <Link
                key={t.id}
                href={`/field/safety/new/${t.id}?${target}`}
                className="flex min-h-16 items-center rounded-xl border p-3 text-sm font-semibold leading-snug transition-colors hover:bg-muted/50 active:bg-muted"
              >
                {t.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {otherRecent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recently filed on this job
          </h2>
          <div className="flex flex-col divide-y rounded-xl border">
            {otherRecent.map((s) => (
              <Link
                key={s.id}
                href={`/field/safety/submission/${s.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {s.name ?? FORM_KIND_LABELS[s.kind as FormTemplateKind] ?? 'Form'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{s.by ?? ''}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {fmtDateAU(s.submitted_at)}
                  <ChevronRightIcon className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        A submitted form can&apos;t be edited. Whoever filed it can amend it, which keeps the
        original.
      </p>
    </div>
  )
}
