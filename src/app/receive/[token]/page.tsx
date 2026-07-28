import { createPublicClient } from '@/lib/supabase/public'
import {
  WasteLinkExpired,
  WasteLinkReceipt,
  WastePublicShell,
  WasteLoadSummary,
} from '@/components/WastePublicShell'
import type { WasteLinkView } from '@/lib/waste/link-payload'
import { ReceiveForm } from './receive-form'

// Public, token-gated, no auth — always resolve the token fresh.
export const dynamic = 'force-dynamic'

/**
 * Part 3 of the waste transport certificate, filled in by the receiving
 * facility. No auth — the token IS the credential: waste_link_view and
 * waste_link_submit_receiver are security-definer RPCs granted to anon, and
 * /receive is excluded from the auth proxy matcher.
 */
export default async function ReceivePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const supabase = createPublicClient()
  const { data } = await supabase.rpc('waste_link_view', { p_token: token })
  const view = (data ?? null) as WasteLinkView | null

  // Unknown, expired or deactivated token, or a transporter link (which has
  // its own page at /haul/[token]) — never serve the other party's form.
  if (!view || view.kind !== 'waste_receiver') {
    return <WasteLinkExpired what="receipt" />
  }

  // Locked on submit; the office can reopen it if something needs correcting.
  if (view.submitted_at) {
    return <WasteLinkReceipt view={view} what="receipt details" />
  }

  return (
    <WastePublicShell>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">Waste receipt</h1>
        <p className="text-sm text-muted-foreground">
          Record what arrived at {view.receiver.name ?? 'your facility'} and how
          it was handled — this forms part of the waste transport certificate
          lodged with the Queensland department.
        </p>
      </div>

      <WasteLoadSummary view={view} />

      <ReceiveForm token={token} view={view} />
    </WastePublicShell>
  )
}
