import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon, CheckCircle2Icon } from 'lucide-react'
import { format, isValid, parseISO } from 'date-fns'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { AttachmentList } from '@/components/AttachmentList'
import { PhotoUpload } from '@/components/PhotoUpload'
import { ShareLinkDialog } from '@/components/ShareLinkDialog'
import { Button } from '@/components/ui/button'
import type { FormField, FormTemplateKind } from '@/lib/zod'
import { SignonSection } from './signon-section'

const KIND_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Start',
  take5: 'Take 5',
  toolbox: 'Toolbox',
  induction: 'Induction',
  incident: 'Incident',
  custom: 'Custom',
}

function fmtDateTime(value: string): string {
  const d = parseISO(value)
  return isValid(d) ? format(d, 'dd/MM/yyyy HH:mm') : ''
}

function humanise(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function FieldValue({
  type,
  value,
}: {
  type: FormField['type'] | 'unknown'
  value: unknown
}) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground">—</span>
  }
  if (type === 'checkbox') {
    return <span>{value === true ? 'Yes' : 'No'}</span>
  }
  if (type === 'rating') {
    return <span className="tabular-nums">{String(value)} / 5</span>
  }
  if (
    type === 'signature' &&
    typeof value === 'string' &&
    value.startsWith('data:image/')
  ) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={value}
        alt="Signature"
        className="h-20 w-auto rounded-lg border bg-white"
      />
    )
  }
  return <span className="whitespace-pre-wrap">{String(value)}</span>
}

export default async function FormSubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { id } = await params
  const supabase = await createClient()

  const { data: submission } = await supabase
    .from('form_submissions')
    .select(
      `id, template_id, template_version, kind, project_id, job_id, plant_id,
       data, schema_snapshot, submitted_by, submitted_at,
       form_templates(name, schema, requires_signon),
       projects(number, name), jobs(number, title), plant(name, rego),
       profiles(full_name)`
    )
    .eq('id', id)
    .single()
  if (!submission) notFound()

  const template = submission.form_templates as unknown as {
    name: string
    schema: FormField[]
    requires_signon: boolean
  } | null
  const projectRel = submission.projects as unknown as {
    number: string
    name: string
  } | null
  const jobRel = submission.jobs as unknown as {
    number: string
    title: string
  } | null
  const plantRel = submission.plant as unknown as {
    name: string
    rego: string | null
  } | null
  const submitter = submission.profiles as unknown as {
    full_name: string
  } | null

  const isMine = submission.submitted_by === profile.id
  const isStaff = profile.role === 'admin' || profile.role === 'office'
  const requiresSignon = Boolean(template?.requires_signon)
  // Render against the schema captured at submit time; legacy rows (null
  // snapshot) fall back to the template's CURRENT schema.
  const snapshotSchema = submission.schema_snapshot as FormField[] | null
  const effectiveSchema = snapshotSchema ?? template?.schema ?? []
  const schema = effectiveSchema.filter((f) => f.type !== 'photo')
  const data = (submission.data ?? {}) as Record<string, unknown>

  // Drift: data keys the effective schema doesn't know about.
  const schemaKeys = new Set(effectiveSchema.map((f) => f.key))
  const extraKeys = Object.keys(data).filter((k) => !schemaKeys.has(k))

  const targetLabel = projectRel
    ? `P-${projectRel.number} — ${projectRel.name}`
    : jobRel
      ? `J-${jobRel.number} — ${jobRel.title}`
      : '—'

  const [attachments, signons] = await Promise.all([
    fetchAttachmentsWithUrls(supabase, 'form_submission', id),
    requiresSignon
      ? supabase
          .from('form_signons')
          .select('id, profile_id, name, company, signature_data, signed_at')
          .eq('submission_id', id)
          .order('signed_at')
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ])

  const mySignonExists = signons.some((s) => s.profile_id === profile.id)
  const canRecordOthers =
    isMine &&
    (profile.role === 'admin' ||
      profile.role === 'office' ||
      profile.role === 'supervisor')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/field/safety"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Safety
        </Link>
        <h1 className="text-lg font-bold">
          {template?.name ?? KIND_LABELS[submission.kind as FormTemplateKind]}
        </h1>
        <p className="text-sm text-muted-foreground">{targetLabel}</p>
        {plantRel && (
          <p className="text-sm text-muted-foreground">
            Plant: {plantRel.name}
            {plantRel.rego ? ` (${plantRel.rego})` : ''}
          </p>
        )}
        <div className="flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
          <CheckCircle2Icon className="size-4 shrink-0 text-green-600 dark:text-green-400" />
          <span>
            Submitted by {submitter?.full_name ?? '—'} ·{' '}
            {fmtDateTime(submission.submitted_at as string)}
          </span>
        </div>
      </div>

      {/* Answers */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Answers
        </h2>
        <div className="divide-y rounded-xl border">
          {schema.map((field) => (
            <div key={field.key} className="flex flex-col gap-1 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                {field.label}
              </p>
              <div className="text-sm">
                <FieldValue type={field.type} value={data[field.key]} />
              </div>
            </div>
          ))}
          {extraKeys.map((key) => (
            <div key={key} className="flex flex-col gap-1 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                {humanise(key)}
              </p>
              <div className="text-sm">
                <FieldValue type="unknown" value={data[key]} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Photos */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Photos
        </h2>
        {isMine && (
          <PhotoUpload
            parentType="form_submission"
            parentId={id}
            kind="photo"
            capture
            multiple
          />
        )}
        {attachments.length === 0 ? (
          !isMine && <p className="text-sm text-muted-foreground">No photos.</p>
        ) : (
          <AttachmentList items={attachments} canDelete={isMine || isStaff} />
        )}
      </section>

      {/* Sign-on */}
      {requiresSignon && (
        <section className="flex flex-col gap-3 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Sign-on ({signons.length})
            </h2>
            {(profile.role === 'admin' ||
              profile.role === 'office' ||
              profile.role === 'supervisor') && (
              <ShareLinkDialog
                target={{ formSubmissionId: id }}
                defaultLabel={`${template?.name ?? KIND_LABELS[submission.kind as FormTemplateKind]} — ${fmtDateTime(submission.submitted_at as string).slice(0, 10)}`}
              />
            )}
          </div>
          {signons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sign-ons yet.</p>
          ) : (
            <div className="divide-y rounded-xl border">
              {signons.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.company ? `${s.company} · ` : ''}
                      {fmtDateTime(s.signed_at as string)}
                    </p>
                  </div>
                  {s.signature_data && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.signature_data as string}
                      alt={`${s.name}'s signature`}
                      className="h-10 w-auto shrink-0 rounded border bg-white"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {isMine && (
            <SignonSection
              submissionId={id}
              defaultName={profile.full_name}
              alreadySignedSelf={mySignonExists}
              canRecordOthers={canRecordOthers}
            />
          )}
        </section>
      )}

      <Button render={<Link href="/field/safety" />} size="lg" variant="outline">
        Done
      </Button>
    </div>
  )
}
