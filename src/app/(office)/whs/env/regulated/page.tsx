import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { PageHeader } from '@/components/PageHeader'
import { monthOptions } from '@/lib/waste/lodgement'
import { RegulatedRegisterClient, type MovementRow } from './register-client'

export const dynamic = 'force-dynamic'

export default async function RegulatedWasteRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const sp = await searchParams
  const today = todayAU()

  const months = monthOptions(today, 13)
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : months[0]

  const supabase = await createClient()

  // The register is organised by DISPOSAL month, matching the file the
  // department expects (spec §2.4) — but a movement with no received_date yet
  // has no disposal month, and those are exactly the ones the office must
  // chase. They are fetched separately and always shown.
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const [{ data: disposed }, { data: pending }, { data: settings }] =
    await Promise.all([
      supabase
        .from('regulated_waste_movements')
        .select('*')
        .gte('received_date', start)
        .lt('received_date', end)
        .order('load_seq'),
      supabase
        .from('regulated_waste_movements')
        .select('*')
        .is('received_date', null)
        .order('collection_date'),
      supabase
        .from('settings')
        .select('budf_identifier, budf_approved_at')
        .eq('id', 1)
        .single(),
    ])

  const shape = (r: Record<string, unknown>): MovementRow => ({
    id: r.id as string,
    load_seq: r.load_seq as number,
    collection_date: r.collection_date as string,
    received_date: (r.received_date as string | null) ?? null,
    generator_name: r.generator_name as string,
    transporter_name: r.transporter_name as string,
    receiver_name: r.receiver_name as string,
    waste_code: r.waste_code as string,
    waste_amount: Number(r.waste_amount),
    waste_unit: r.waste_unit as string,
    receiver_amount: r.receiver_amount === null ? null : Number(r.receiver_amount),
    receiver_unit: (r.receiver_unit as string | null) ?? null,
    disposal_code: (r.disposal_code as string | null) ?? null,
    part2_submitted_at: (r.part2_submitted_at as string | null) ?? null,
    part2_submitted_by: (r.part2_submitted_by as string | null) ?? null,
    part3_submitted_at: (r.part3_submitted_at as string | null) ?? null,
    part3_submitted_by: (r.part3_submitted_by as string | null) ?? null,
    transporter_declared_variance:
      (r.transporter_declared_variance as Record<string, string> | null) ?? null,
    transporter_discrepancy: (r.transporter_discrepancy as string | null) ?? null,
    receiver_discrepancy: (r.receiver_discrepancy as string | null) ?? null,
    wtc_reference: (r.wtc_reference as string | null) ?? null,
    lodged_at: (r.lodged_at as string | null) ?? null,
    lodgement_method: (r.lodgement_method as string | null) ?? null,
  })

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/whs/env"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Environment
      </Link>

      <PageHeader
        title="Regulated waste register"
        description="Trackable waste under Schedule 11. The department must be given the prescribed information within 7 days of collection, and the record kept for 5 years."
      />

      <RegulatedRegisterClient
        month={month}
        months={months}
        today={today}
        disposed={(disposed ?? []).map(shape)}
        pending={(pending ?? []).map(shape)}
        budfIdentifier={(settings?.budf_identifier as string | null) ?? null}
        budfApprovedAt={(settings?.budf_approved_at as string | null) ?? null}
        canManage={profile.role === 'admin' || profile.role === 'office'}
      />
    </div>
  )
}
