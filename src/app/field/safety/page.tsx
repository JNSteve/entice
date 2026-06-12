import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileIcon,
  FileTextIcon,
  HandIcon,
  ShieldCheckIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchMyFieldSwms } from '@/lib/swms-queries'
import { FieldSwmsCard } from '@/components/FieldSwmsCard'
import { fmtDate } from '@/lib/format'
import {
  WHS_DOC_CATEGORIES,
  WHS_DOC_CATEGORY_LABELS,
  type FormTemplateKind,
  type WhsDocCategory,
} from '@/lib/zod'

const KIND_ICONS: Record<FormTemplateKind, React.ComponentType<{ className?: string }>> = {
  prestart: WrenchIcon,
  take5: HandIcon,
  toolbox: UsersIcon,
  induction: ClipboardListIcon,
  incident: AlertTriangleIcon,
  custom: FileIcon,
}

const KIND_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Start',
  take5: 'Take 5',
  toolbox: 'Toolbox',
  induction: 'Induction',
  incident: 'Incident',
  custom: 'Custom',
}

const KIND_ORDER: FormTemplateKind[] = [
  'prestart',
  'take5',
  'toolbox',
  'induction',
  'incident',
  'custom',
]

type RecentItem = {
  id: string
  href: string
  title: string
  kindLabel: string
  targetLabel: string
  date: string
}

function targetLabel(
  projectRel: { number: string; name: string } | null,
  jobRel: { number: string; title: string } | null
): string {
  if (projectRel) return `${projectRel.number} — ${projectRel.name}`
  if (jobRel) return `${jobRel.number} — ${jobRel.title}`
  return '—'
}

export default async function FieldSafetyPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const [
    { data: templates },
    swmsItems,
    { data: submissions },
    { data: incidents },
    { data: safetyDocs },
  ] = await Promise.all([
    supabase
      .from('form_templates')
      .select('id, kind, name')
      .eq('active', true)
      .order('name'),
    fetchMyFieldSwms(supabase, profile.id),
    supabase
      .from('form_submissions')
      .select(
        'id, kind, submitted_at, form_templates(name), projects(number, name), jobs(number, title)'
      )
      .eq('submitted_by', profile.id)
      .order('submitted_at', { ascending: false })
      .limit(10),
    supabase
      .from('incidents')
      .select('id, number, type, created_at, projects(number, name), jobs(number, title)')
      .eq('reported_by', profile.id)
      .order('created_at', { ascending: false })
      .limit(10),
    // Current controlled WHS documents only — read-only field listing.
    supabase
      .from('whs_documents')
      .select('id, title, category, version, file_path')
      .eq('status', 'current')
      .order('title'),
  ])

  // Sign the document files server-side (private bucket, 1h links).
  const docPaths = (safetyDocs ?? []).map((d) => d.file_path as string)
  const docUrlByPath = new Map<string, string>()
  if (docPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(docPaths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) docUrlByPath.set(entry.path, entry.signedUrl)
    }
  }

  // Group by category, in the canonical category order.
  const docGroups = WHS_DOC_CATEGORIES.map((category) => ({
    category,
    docs: (safetyDocs ?? [])
      .filter((d) => (d.category as WhsDocCategory) === category)
      .map((d) => ({
        id: d.id as string,
        title: d.title as string,
        version: d.version as string,
        url: docUrlByPath.get(d.file_path as string) ?? null,
      })),
  })).filter((g) => g.docs.length > 0)

  const sortedTemplates = [...(templates ?? [])].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind as FormTemplateKind) -
      KIND_ORDER.indexOf(b.kind as FormTemplateKind)
  )

  const mySwms = swmsItems.filter((i) => i.assigned)

  // Merge my form submissions and incident reports into one recent list.
  const recent: RecentItem[] = [
    ...(submissions ?? []).map((s) => {
      const tpl = s.form_templates as unknown as { name: string } | null
      const projectRel = s.projects as unknown as { number: string; name: string } | null
      const jobRel = s.jobs as unknown as { number: string; title: string } | null
      return {
        id: s.id as string,
        href: `/field/safety/submission/${s.id}`,
        title: tpl?.name ?? KIND_LABELS[s.kind as FormTemplateKind] ?? 'Form',
        kindLabel: KIND_LABELS[s.kind as FormTemplateKind] ?? s.kind,
        targetLabel: targetLabel(projectRel, jobRel),
        date: s.submitted_at as string,
      }
    }),
    ...(incidents ?? []).map((i) => {
      const projectRel = i.projects as unknown as { number: string; name: string } | null
      const jobRel = i.jobs as unknown as { number: string; title: string } | null
      return {
        id: i.id as string,
        href: `/field/safety/incident/${i.id}`,
        title: `Incident ${i.number}`,
        kindLabel: 'Incident',
        targetLabel: targetLabel(projectRel, jobRel),
        date: i.created_at as string,
      }
    }),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 10)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Safety</h1>
        <p className="text-sm text-muted-foreground">
          Forms, SWMS sign-on and incident reporting.
        </p>
      </div>

      {/* New form grid */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          New form
        </h2>
        {sortedTemplates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active form templates. Ask the office to set them up in Settings.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sortedTemplates.map((t) => {
              const Icon = KIND_ICONS[t.kind as FormTemplateKind] ?? FileIcon
              return (
                <Link
                  key={t.id}
                  href={`/field/safety/new/${t.id}`}
                  className="flex min-h-24 flex-col justify-between gap-2 rounded-xl border p-4 transition-colors hover:bg-muted/50 active:bg-muted"
                >
                  <Icon className="size-6 text-muted-foreground" />
                  <span className="text-sm font-semibold leading-snug">{t.name}</span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Safety documents (current controlled docs, read-only) */}
      {docGroups.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Safety documents
          </h2>
          <div className="flex flex-col gap-3">
            {docGroups.map((group) => (
              <div key={group.category} className="flex flex-col gap-1.5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {WHS_DOC_CATEGORY_LABELS[group.category]}
                </h3>
                <div className="flex flex-col divide-y rounded-xl border">
                  {group.docs.map((doc) =>
                    doc.url ? (
                      <a
                        key={doc.id}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">{doc.title}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {doc.version}
                        </span>
                      </a>
                    ) : (
                      <span
                        key={doc.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-muted-foreground"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <FileTextIcon className="size-4 shrink-0" />
                          <span className="truncate text-sm">{doc.title}</span>
                        </span>
                        <span className="shrink-0 text-xs">{doc.version}</span>
                      </span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SWMS */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            SWMS sign-on
          </h2>
          <Link
            href="/field/swms"
            className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            All SWMS
            <ChevronRightIcon className="size-3.5" />
          </Link>
        </div>
        {mySwms.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-muted-foreground">
            <ShieldCheckIcon className="size-5 shrink-0" />
            No SWMS on your sites this week.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {mySwms.map((item) => (
              <FieldSwmsCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* My recent submissions */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          My recent submissions
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Forms you submit will show up here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold">{item.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.kindLabel} · {item.targetLabel}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(item.date)}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
