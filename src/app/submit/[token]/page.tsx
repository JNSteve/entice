import { ShieldCheckIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { SubmitClient } from './submit-client'

// Public, token-gated, no auth — always resolve the token fresh.
export const dynamic = 'force-dynamic'

// ─── get_shared_doc payload shape (subbie_swms links) ────────────────────────

interface SharedDoc {
  kind: 'signon' | 'subbie_swms'
  label: string | null
  project_name: string | null
  doc: { type: string }
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
          Ask your contact at the head contractor for a new SWMS submission link.
        </p>
      </div>
    </PageShell>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Public subbie SWMS submission page. No auth — the token IS the credential:
 * get_shared_doc / submit_subbie_swms are security-definer RPCs granted to
 * anon, the anon role may upload (only) into attachments/public-submissions/,
 * and /submit is excluded from the auth proxy matcher.
 */
export default async function PublicSubmitPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const supabase = createPublicClient()
  const { data } = await supabase.rpc('get_shared_doc', { p_token: token })
  const shared = (data ?? null) as SharedDoc | null

  // Unknown/expired/deactivated token, or a link this page doesn't serve
  // (sign-on links have their own flow at /sign/[token]).
  if (!shared || shared.kind !== 'subbie_swms') {
    return <ExpiredPage />
  }

  return (
    <PageShell>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">
          Submit your SWMS{shared.project_name ? ` — ${shared.project_name}` : ''}
        </h1>
        {shared.label && (
          <p className="text-sm text-muted-foreground">{shared.label}</p>
        )}
        <p className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm">
          Fill in your details and attach your Safe Work Method Statement as a
          PDF. It will be reviewed by the site team before you start work.
        </p>
      </div>

      <SubmitClient token={token} />
    </PageShell>
  )
}
