import { createPublicClient } from '@/lib/supabase/public'
import {
  WasteLinkExpired,
  WasteLinkReceipt,
  WastePublicShell,
  WasteLoadSummary,
} from '@/components/WastePublicShell'
import type { WasteLinkView } from '@/lib/waste/link-payload'
import { HaulForm } from './haul-form'

// Public, token-gated, no auth — always resolve the token fresh.
export const dynamic = 'force-dynamic'

/**
 * Part 2 of the waste transport certificate, filled in by the transporter.
 * No auth — the token IS the credential: waste_link_view and
 * waste_link_submit_transporter are security-definer RPCs granted to anon, and
 * /haul is excluded from the auth proxy matcher.
 */
export default async function HaulPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const supabase = createPublicClient()
  const { data } = await supabase.rpc('waste_link_view', { p_token: token })
  const view = (data ?? null) as WasteLinkView | null

  // Unknown, expired or deactivated token, or a receiver link (which has its
  // own page at /receive/[token]) — never serve the other party's form.
  if (!view || view.kind !== 'waste_transporter') {
    return <WasteLinkExpired what="transport" />
  }

  // Locked on submit; the office can reopen it if something needs correcting.
  if (view.submitted_at) {
    return <WasteLinkReceipt view={view} what="transport details" />
  }

  return (
    <WastePublicShell>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">Transport details</h1>
        <p className="text-sm text-muted-foreground">
          You are carrying trackable waste. Record your vehicles and collection
          date — this forms part of the waste transport certificate lodged with
          the Queensland department.
        </p>
      </div>

      <WasteLoadSummary view={view} />

      <HaulForm token={token} view={view} />
    </WastePublicShell>
  )
}
