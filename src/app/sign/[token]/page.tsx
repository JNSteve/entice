import { format, isValid, parseISO } from 'date-fns'
import { ShieldCheckIcon } from 'lucide-react'
import { FormDataView } from '@/components/FormDataView'
import { createPublicClient } from '@/lib/supabase/public'
import {
  RISK_LEVEL_LABELS,
  type FormField,
  type RiskLevel,
  type SwmsHazard,
} from '@/lib/zod'
import { SignClient } from './sign-client'

// Public, token-gated, no auth — always resolve the token fresh.
export const dynamic = 'force-dynamic'

// ─── get_shared_doc payload shapes ───────────────────────────────────────────

interface SharedSwmsDoc {
  type: 'swms'
  title: string
  body: string | null
  hazards: SwmsHazard[] | null
  version: number
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
        <p className="text-2xl font-bold tracking-tight text-[#1e3a5f] dark:text-blue-200">
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

/** SWMS read-through — body + hazards as mobile-stacked cards. */
function SwmsReadThrough({ doc }: { doc: SharedSwmsDoc }) {
  const hazards = (doc.hazards ?? []).filter(Boolean)
  const bodyParagraphs = (doc.body ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <>
      {bodyParagraphs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Safe work method
          </h2>
          {bodyParagraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
              {p}
            </p>
          ))}
        </section>
      )}

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
    </>
  )
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
