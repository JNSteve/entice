import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon, CheckCircle2Icon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/StatusBadge'
import { SwmsFullView } from '@/components/SwmsFullView'
import { fmtDate } from '@/lib/format'
import { SWMS_STRUCTURE_COLUMNS, parseSwmsStructure } from '@/lib/swms'
import { SignForm } from './sign-form'

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
      `id, title, body, hazards, version, status, ${SWMS_STRUCTURE_COLUMNS},
       projects(number, name), jobs(number, title)`
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

  const structure = parseSwmsStructure(instance)

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

      <SwmsFullView structure={structure} />

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
          <SignForm
            instanceId={instance.id}
            version={Number(instance.version)}
            defaultName={profile.full_name}
          />
        )}
      </section>
    </div>
  )
}
