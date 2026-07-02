import { complianceTitle, type ComplianceStatus } from '@/lib/compliance'

/**
 * The vendor-register compliance traffic light dot (green / amber / red).
 * Shared with any register that aggregates expiry-dated documents.
 */
export function ComplianceLight({ status }: { status: ComplianceStatus }) {
  const colours = {
    green: 'bg-green-500',
    amber: 'bg-amber-400',
    red: 'bg-red-500',
  }
  return (
    <span
      className={`inline-block size-3 rounded-full ${colours[status]}`}
      title={complianceTitle(status)}
      aria-label={complianceTitle(status)}
    />
  )
}
