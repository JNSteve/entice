import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon, CheckCircle2Icon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtDate } from '@/lib/format'
import {
  RISK_LEVEL_LABELS,
  type RiskLevel,
  type SwmsHazard,
} from '@/lib/zod'
import { SignForm } from './sign-form'

const RISK_CHIP: Record<RiskLevel, string> = {
  H: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  M: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  L: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
}

function RiskChip({ level, label }: { level: RiskLevel; label: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_CHIP[level] ?? RISK_CHIP.M}`}
    >
      {label}: {RISK_LEVEL_LABELS[level] ?? level}
    </span>
  )
}

export default async function FieldSwmsInstancePage({
  params,
}: {
  params: Promise<{ instanceId: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { instanceId } = await params
  const supabase = await createClient()

  const { data: instance } = await supabase
    .from('swms_instances')
    .select(
      'id, title, body, hazards, version, status, projects(number, name), jobs(number, title)'
    )
    .eq('id', instanceId)
    .single()
  if (!instance) notFound()

  const { data: mySignature } = await supabase
    .from('swms_signatures')
    .select('signed_at')
    .eq('swms_instance_id', instanceId)
    .eq('user_id', profile.id)
    .eq('version', Number(instance.version))
    .maybeSingle()

  const projectRel = instance.projects as unknown as {
    number: string
    name: string
  } | null
  const jobRel = instance.jobs as unknown as { number: string; title: string } | null
  const parentLabel = projectRel
    ? `${projectRel.number} — ${projectRel.name}`
    : jobRel
      ? `${jobRel.number} — ${jobRel.title}`
      : '—'

  const hazards = ((instance.hazards as SwmsHazard[] | null) ?? []).filter(Boolean)
  const bodyParagraphs = (instance.body ?? '')
    .split(/\n{2,}/)
    .map((p: string) => p.trim())
    .filter(Boolean)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/field/swms"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          All SWMS
        </Link>
        <h1 className="text-lg font-bold">{instance.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium tabular-nums text-muted-foreground">
            v{instance.version}
          </span>
          <StatusBadge status={instance.status} />
        </div>
        <p className="text-sm text-muted-foreground">{parentLabel}</p>
      </div>

      {/* Safe work method */}
      {bodyParagraphs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Safe work method
          </h2>
          {bodyParagraphs.map((p: string, i: number) => (
            <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
              {p}
            </p>
          ))}
        </section>
      )}

      {/* Hazards — mobile-stacked cards */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Hazards &amp; controls
        </h2>
        {hazards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hazard rows.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {hazards.map((h, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl border p-4">
                <p className="text-sm font-semibold">{h.task}</p>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Hazards
                  </p>
                  <p className="text-sm">{h.hazards}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RiskChip level={h.risk} label="Risk" />
                  <RiskChip level={h.residual_risk} label="Residual" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Controls
                  </p>
                  <p className="text-sm">{h.controls}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sign-on */}
      <section className="flex flex-col gap-2 border-t pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sign-on
        </h2>
        {instance.status !== 'active' ? (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            This SWMS has been superseded — sign-on is closed.
          </p>
        ) : mySignature ? (
          <div className="flex items-start gap-3 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3">
            <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" />
            <div className="flex flex-col gap-0.5 text-sm">
              <span className="font-semibold">
                You signed v{instance.version} on {fmtDate(mySignature.signed_at)}
              </span>
              <span className="text-muted-foreground">
                You&apos;ll be asked to re-sign if this SWMS is revised.
              </span>
            </div>
          </div>
        ) : (
          <SignForm instanceId={instance.id} defaultName={profile.full_name} />
        )}
      </section>
    </div>
  )
}
