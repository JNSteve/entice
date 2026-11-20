import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronRightIcon, FileTextIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fmtDateAU } from '@/lib/field-today'
import { parseWorkKind } from '@/lib/live-work'

export default async function WorkDocsPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { kind: rawKind, id } = await params
  const kind = parseWorkKind(rawKind)
  if (!kind) notFound()

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('attachments')
    .select('id, filename, caption, path, created_at')
    .eq('parent_type', kind)
    .eq('parent_id', id)
    .eq('field_visible', true)
    .in('kind', ['document', 'pdf'])
    .order('created_at', { ascending: false })

  // Private bucket — one-hour links, signed server-side.
  const urlByPath = new Map<string, string>()
  const paths = (rows ?? []).map((r) => r.path as string)
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(paths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Job documents
        </h2>
        {(rows ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The office hasn&apos;t shared any documents for this job yet.
          </p>
        ) : (
          <div className="flex flex-col divide-y rounded-xl border">
            {(rows ?? []).map((doc) => {
              const url = urlByPath.get(doc.path as string)
              const body = (
                <>
                  <span className="flex min-w-0 items-center gap-2">
                    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {doc.filename as string}
                      </span>
                      {doc.caption && (
                        <span className="truncate text-xs text-muted-foreground">
                          {doc.caption as string}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtDateAU(doc.created_at as string)}
                  </span>
                </>
              )
              return url ? (
                <a
                  key={doc.id as string}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors active:bg-muted"
                >
                  {body}
                </a>
              ) : (
                <span
                  key={doc.id as string}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-muted-foreground"
                >
                  {body}
                </span>
              )
            })}
          </div>
        )}
      </section>

      <Link
        href="/field/safety"
        className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium"
      >
        Company documents
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>

      <p className="text-xs text-muted-foreground">Read only. Shared by the office.</p>
    </div>
  )
}
