import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { format } from 'date-fns'
import { fmtDate } from '@/lib/format'
import { nowAU } from '@/lib/tz'
import { appendPdf, checkOriginalPdf } from '@/lib/pdf-merge'
import {
  HRCW_ANSWER_LABELS,
  SWMS_EMERGENCY_CONTACT_LABELS,
  SWMS_PROJECT_DETAIL_LABELS,
  SWMS_REQUIREMENT_LABELS,
  SWMS_STRUCTURE_COLUMNS,
  parseSwmsStructure,
  type SwmsEmergencyContacts,
  type SwmsProjectDetails,
  type SwmsRequirements,
} from '@/lib/swms'
import { toDocCompany, type SettingsRow } from '@/pdf/build-quote-pdf'
import {
  SwmsPdf,
  type SwmsPdfChange,
  type SwmsPdfRow,
  type SwmsPdfSignature,
} from '@/pdf/SwmsPdf'
import { SwmsRegisterPdf } from '@/pdf/SwmsRegisterPdf'

export type SwmsPdfOptions = {
  /**
   * false = the SWMS as issued: no sign-on register is rendered and an
   * uploaded PDF is returned as-is. Default true (the office "Signed copy").
   */
  register?: boolean
  /** Portal issue stamp (fixed watermark + footer line); null for office copies. */
  watermark?: string | null
}

/** Non-empty {label, value} rows from a label map + values record. */
function labelValueRows(
  labels: Record<string, string>,
  values: Record<string, string>
): SwmsPdfRow[] {
  return Object.entries(labels)
    .filter(([key]) => values[key]?.trim())
    .map(([key, label]) => ({ label, value: values[key] }))
}

/** ASCII-only, header-safe file stem: the title is free text. */
function fileStem(title: string): string {
  return title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'swms'
}

function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  })
}

/**
 * Shared SWMS PDF builder. The office route (/api/pdf/swms/[id]) passes the
 * signed-in user's client; the portal route passes the service-role client
 * only after portal_swms_file has proved the link is entitled to this SWMS.
 *
 * Template SWMS render SwmsPdf. Uploaded-PDF SWMS return the original pages
 * with the sign-on register appended (the "signed copy"), or the original
 * alone when `register` is false. Generated on demand; nothing is stored.
 */
export async function buildSwmsPdfResponse(
  supabase: SupabaseClient,
  id: string,
  opts: SwmsPdfOptions = {}
): Promise<Response> {
  const register = opts.register ?? true
  const watermark = opts.watermark ?? null

  const [{ data: instance }, { data: signatures }, { data: auditRows }, { data: settings }] =
    await Promise.all([
      supabase
        .from('swms_instances')
        .select(
          `id, title, body, hazards, version, status, created_at, document_attachment_id,
           document:attachments!swms_instances_document_attachment_id_fkey(bucket, path, filename),
           ${SWMS_STRUCTURE_COLUMNS},
           projects(number, name), jobs(number, title)`
        )
        .eq('id', id)
        .single(),
      supabase
        .from('swms_signatures')
        .select(
          'name, company, external, signature_path, signature_data, version, signed_at, profiles(role)'
        )
        .eq('swms_instance_id', id)
        .order('signed_at'),
      supabase
        .from('audit_log')
        .select('at, actor_name, action, detail')
        .eq('entity_type', 'swms_instances')
        .eq('entity_id', id)
        .order('at'),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!instance) return new Response('Not found', { status: 404 })

  const projectRel = instance.projects as unknown as {
    number: string
    name: string
  } | null
  const jobRel = instance.jobs as unknown as { number: string; title: string } | null
  const parentLabel = projectRel
    ? `${projectRel.number} — ${projectRel.name}`
    : jobRel
      ? `${jobRel.number} — ${jobRel.title}`
      : '—'

  const structure = parseSwmsStructure(instance)
  const company = toDocCompany((settings ?? null) as SettingsRow | null)

  const currentVersion = Number(instance.version)
  // "As issued" copies carry no register at all, so no signatures are read.
  const currentSigs = register
    ? (signatures ?? []).filter((s) => Number(s.version) === currentVersion)
    : []
  const earlierSignatureCount = register ? (signatures ?? []).length - currentSigs.length : 0

  // Batch-sign signature image URLs — react-pdf fetches them at render time.
  // Missing objects (e.g. seeded rows) simply render without an image.
  // External rows store the PNG inline (signature_data) instead of a path.
  const pathSigs = currentSigs.filter((s) => s.signature_path)
  const urlByPath = new Map<string, string>()
  if (pathSigs.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(pathSigs.map((s) => s.signature_path as string), 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  const pdfSignatures: SwmsPdfSignature[] = currentSigs.map((s) => {
    const sigCompany = s.company as string | null
    const external = Boolean(s.external)
    const profileRel = s.profiles as unknown as { role: string } | null
    const role = external
      ? 'External'
      : profileRel?.role
        ? profileRel.role.charAt(0).toUpperCase() + profileRel.role.slice(1)
        : '—'
    return {
      name: s.name as string,
      role,
      company: external ? (sigCompany ?? '—') : company.name,
      date: fmtDate(s.signed_at),
      version: Number(s.version),
      imageUrl: s.signature_path
        ? (urlByPath.get(s.signature_path as string) ?? null)
        : ((s.signature_data as string | null) ?? null),
    }
  })

  // Review/change record: issue + version bumps + supersede from the audit log.
  const changes: SwmsPdfChange[] = []
  for (const row of auditRows ?? []) {
    const detail = (row.detail ?? {}) as {
      changed?: Record<string, { from?: unknown; to?: unknown }>
    }
    if (row.action === 'insert') {
      changes.push({
        date: fmtDate(row.at as string),
        description: 'Issued (v1)',
        by: (row.actor_name as string) ?? 'system',
      })
    } else if (row.action === 'update' && detail.changed?.version) {
      changes.push({
        date: fmtDate(row.at as string),
        description: `Revised to v${detail.changed.version.to} — workers must re-sign`,
        by: (row.actor_name as string) ?? 'system',
      })
    } else if (row.action === 'update' && detail.changed?.status) {
      changes.push({
        date: fmtDate(row.at as string),
        description: `Status changed to ${String(detail.changed.status.to).replace(/"/g, '')}`,
        by: (row.actor_name as string) ?? 'system',
      })
    }
  }

  const documentRel = instance.document as unknown as {
    bucket: string
    path: string
    filename: string
  } | null
  if (documentRel) {
    // Uploaded-PDF SWMS. The stored original is never modified.
    let originalBytes: Uint8Array | null = null
    const { data: blob } = await supabase.storage
      .from(documentRel.bucket ?? 'attachments')
      .download(documentRel.path)
    if (blob) originalBytes = new Uint8Array(await blob.arrayBuffer())
    const check = await checkOriginalPdf(originalBytes)
    const stem = fileStem(instance.title)

    if (!register) {
      // As issued: the original alone, nothing generated.
      if (!check.ok || !originalBytes) {
        return new Response('The original PDF is unavailable', { status: 404 })
      }
      return pdfResponse(originalBytes, `${stem}-v${currentVersion}.pdf`)
    }

    // "Signed copy": original pages + register pages.
    const renderRegister = (originalProblem: string | null) =>
      renderToBuffer(
        <SwmsRegisterPdf
          swms={{
            title: instance.title,
            parentLabel,
            version: currentVersion,
            status: instance.status,
            date: fmtDate(instance.created_at),
          }}
          company={company}
          sourceFilename={documentRel.filename}
          generatedAt={format(nowAU(), 'dd/MM/yyyy HH:mm')}
          signatures={pdfSignatures}
          earlierSignatureCount={earlierSignatureCount}
          changes={changes}
          originalProblem={originalProblem}
          watermark={watermark}
        />
      )

    let bytes: Uint8Array
    if (check.ok) {
      const registerPages = await renderRegister(null)
      try {
        bytes = await appendPdf(check.doc, new Uint8Array(registerPages))
      } catch {
        // Loaded leniently but can't be re-saved (damaged xref/objects):
        // fall back to the register alone, with the reason printed on it.
        bytes = new Uint8Array(await renderRegister('the PDF could not be merged'))
      }
    } else {
      bytes = new Uint8Array(await renderRegister(check.reason))
    }

    return pdfResponse(bytes, `${stem}-v${currentVersion}-signed.pdf`)
  }

  const docControlRows: SwmsPdfRow[] = [
    structure.docControl.prepared_by.trim()
      ? { label: 'Prepared by', value: structure.docControl.prepared_by }
      : null,
    structure.docControl.approved_by.trim()
      ? { label: 'Approved by', value: structure.docControl.approved_by }
      : null,
  ].filter((r): r is SwmsPdfRow => r !== null)

  const buffer = await renderToBuffer(
    <SwmsPdf
      swms={{
        title: instance.title,
        parentLabel,
        version: currentVersion,
        status: instance.status,
        date: fmtDate(instance.created_at),
      }}
      company={company}
      docControl={docControlRows}
      scopeNote={structure.docControl.scope_note.trim()}
      projectDetails={labelValueRows(
        SWMS_PROJECT_DETAIL_LABELS,
        structure.projectDetails as SwmsProjectDetails
      )}
      hrcw={structure.hrcwItems.map((item) => ({
        label: item.label,
        value: structure.hrcwAnswers[item.id]
          ? HRCW_ANSWER_LABELS[structure.hrcwAnswers[item.id]]
          : '—',
      }))}
      requirements={labelValueRows(
        SWMS_REQUIREMENT_LABELS,
        structure.requirements as SwmsRequirements
      )}
      steps={structure.steps}
      stopWorkTriggers={structure.stopWorkTriggers}
      emergencyContacts={labelValueRows(
        SWMS_EMERGENCY_CONTACT_LABELS,
        structure.emergencyContacts as SwmsEmergencyContacts
      )}
      emergencyScenarios={structure.emergencyScenarios}
      referencesList={structure.referencesList}
      signatures={pdfSignatures}
      earlierSignatureCount={earlierSignatureCount}
      changes={changes}
      showSignatures={register}
      watermark={watermark}
    />
  )

  return pdfResponse(new Uint8Array(buffer), `swms-v${currentVersion}.pdf`)
}
