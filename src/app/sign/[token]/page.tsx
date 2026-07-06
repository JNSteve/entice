import { format, isValid, parseISO } from 'date-fns'
import { ShieldCheckIcon } from 'lucide-react'
import { FormDataView } from '@/components/FormDataView'
import { SwmsFullView } from '@/components/SwmsFullView'
import { createPublicClient } from '@/lib/supabase/public'
import { parseSwmsStructure } from '@/lib/swms'
import { type FormField } from '@/lib/zod'
import { SignClient } from './sign-client'

// Public, token-gated, no auth — always resolve the token fresh.
export const dynamic = 'force-dynamic'

// ─── get_shared_doc payload shapes ───────────────────────────────────────────

interface SharedSwmsDoc {
  type: 'swms'
  title: string
  body: string | null
  hazards: unknown
  version: number
  // SWMS 2.0 structured sections (see src/lib/swms.ts / migration 0030)
  doc_control?: unknown
  hrcw_items?: unknown
  hrcw_answers?: unknown
  requirements?: unknown
  steps?: unknown
  stop_work_triggers?: unknown
  emergency_scenarios?: unknown
  emergency_contacts?: unknown
  project_details?: unknown
  references_list?: unknown
}

interface SharedFormDoc {
  type: 'form'
  name: string
  kind: string
  schema: FormField[] | null
  version: number
  requires_signon: boolean
  data: Record<string, unknown> | null
  submitted_at: string
}

interface SharedDoc {
  kind: 'signon' | 'subbie_swms'
  label: string | null
  project_name: string | null
  doc: SharedSwmsDoc | SharedFormDoc | { type: 'subbie_swms' }
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 p-4 pb-10">
      <div className="border-b pb-3">
        <p className="text-2xl font-bold tracking-tight text-[#162040] dark:text-blue-200">
          Entice
        </p>
        <p className="text-xs text-muted-foreground">
          Civil &amp; remediation operations
        </p>
      </div>
      {children}
    </div>
  )
}

function ExpiredPage() {
  return (
    <PageShell>
      <div className="flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center">
        <ShieldCheckIcon className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">This link has expired or been deactivated</h1>
        <p className="text-sm text-muted-foreground">
          Ask the site supervisor for a new sign-on link or QR poster.
        </p>
      </div>
    </PageShell>
  )
}

/** SWMS read-through — the full structured document (SwmsFullView). */
function SwmsReadThrough({ doc }: { doc: SharedSwmsDoc }) {
  return <SwmsFullView structure={parseSwmsStructure(doc)} />
}

/** Toolbox/induction read-through — the recorded form data. */
function FormReadThrough({ doc }: { doc: SharedFormDoc }) {
  const submitted = parseISO(doc.submitted_at)
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {doc.name}
      </h2>
      {isValid(submitted) && (
        <p className="text-xs text-muted-foreground">
          Recorded {format(submitted, 'dd/MM/yyyy HH:mm')}
        </p>
      )}
      <div className="rounded-xl border p-4">
        <FormDataView schema={doc.schema ?? []} data={doc.data ?? {}} />
      </div>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Public external sign-on page. No auth — the token IS the credential:
 * get_shared_doc / submit_shared_signon are security-definer RPCs granted to
 * anon, and /sign is excluded from the auth proxy matcher.
 */
export default async function PublicSignPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const supabase = createPublicClient()
  const { data } = await supabase.rpc('get_shared_doc', { p_token: token })
  const shared = (data ?? null) as SharedDoc | null

  // Unknown/expired/deactivated token, or a link this page doesn't serve
  // (subbie SWMS uploads have their own flow).
  if (!shared || shared.kind !== 'signon' || shared.doc.type === 'subbie_swms') {
    return <ExpiredPage />
  }

  const doc = shared.doc
  const heading =
    shared.label ?? (doc.type === 'swms' ? doc.title : doc.name)

  return (
    <PageShell>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">{heading}</h1>
        <p className="text-sm text-muted-foreground">
          {[shared.project_name, doc.type === 'swms' ? `SWMS v${doc.version}` : null]
            .filter(Boolean)
            .join(' · ') || 'Sign-on'}
        </p>
        <p className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm">
          Read through the {doc.type === 'swms' ? 'safe work method statement' : 'record'}{' '}
          below, then sign on at the bottom.
        </p>
      </div>

      {doc.type === 'swms' ? (
        <SwmsReadThrough doc={doc} />
      ) : (
        <FormReadThrough doc={doc} />
      )}

      <SignClient token={token} />
    </PageShell>
  )
}
