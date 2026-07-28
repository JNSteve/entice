// Bulk Upload Data File (BUDF) generation.
//
// SOURCE OF TRUTH: DETSI "Waste Tracking — Bulk Upload Data File
// Specification", ESR/2023/6563 version 2.01, 25 January 2023.
//   §2.2   CSV file format conventions (escaping)
//   §2.3   data types
//   §2.4.1 data file name
//   §2.4.2 header record
//   §2.4.3 trackable waste movement record — the 55 fields, in this order
//   §2.4.4 footer record (control total)
//
// "A bulk upload data file received by the department which does not conform to
// this specification will not be accepted" (§1). The department rejects a
// non-conforming file IN FULL, so a partial file is worse than none: this
// module refuses to emit anything until every record validates, and reports
// what is missing per record and per field.
//
// This module is PURE — no database, no clock, no environment. The caller
// passes the movements, the identifier and the generation date.

import {
  BUDF_UNITS,
  DG_PACKING_GROUPS,
  PHYSICAL_NATURES,
  VEHICLE_TYPES,
  isValidDisposalCode,
  isValidWasteCode,
  type BudfUnit,
} from './qld-codes'

export { BUDF_SPEC_VERSION } from './qld-codes'

// ─── §2.2 CSV conventions ────────────────────────────────────────────────────

/**
 * Escapes one field per §2.2. Deliberately NOT src/lib/csv.ts's csvField:
 * that quotes on comma, double-quote and newline only, and rule (g) also
 * requires quoting when a field has leading or trailing spaces. Using the
 * generic helper here would silently emit a non-conforming file.
 *
 *   (d) null / undefined → an empty field
 *   (e) embedded commas → surround with double quotes
 *   (g) leading or trailing spaces → surround with double quotes
 *   (h) embedded double quotes → surround, and double each internal quote
 *   (i) embedded line breaks → surround with double quotes
 */
export function escapeBudfField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s === '') return ''

  const needsQuoting =
    s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r') ||
    s !== s.trim() // rule (g) — leading or trailing whitespace must survive

  if (!needsQuoting) return s
  return `"${s.replace(/"/g, '""')}"`
}

/** §2.2(a): a line feed or a CR/LF pair. CRLF chosen — the template is Excel. */
export const BUDF_EOR = '\r\n'

/** §2.2(b),(c): comma separated, no delimiter after the final field. */
function toRecord(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeBudfField).join(',')
}

// ─── §2.3 data types ─────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' → 'DD-MM-YYYY'. Returns '' for null/blank/malformed. */
export function formatBudfDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return ''
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * §2.3.3: "Number fields which do not contain whole numbers must contain an
 * explicit decimal point". A whole number is therefore written without one;
 * anything else carries exactly two decimal places, matching format N.[NN].
 */
export function formatBudfAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** Strips formatting from a phone number so N(10) can be checked and written. */
export function normaliseContactNumber(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\D/g, '')
}

/** Strips spaces from an ABN/ACN. */
export function normaliseAbn(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\D/g, '')
}

/**
 * §2.1: "The bulk upload data file uses a delimited ASCII text file format."
 * Free text reaching this file comes from phones and pasted documents, which
 * readily produce em dashes, curly quotes and ellipses. Those are NOT ASCII,
 * and a non-conforming file is rejected in full — so they are reported rather
 * than silently rewritten, because this is a statutory record and the office
 * should decide the wording, not the exporter.
 *
 * Returns the distinct offending characters, in order of first appearance.
 */
export function nonAsciiCharacters(value: string): string[] {
  const found: string[] = []
  for (const ch of value) {
    // Printable ASCII plus tab, LF and CR (all legal inside a quoted field).
    const code = ch.codePointAt(0) ?? 0
    const ok = (code >= 0x20 && code <= 0x7e) || code === 9 || code === 10 || code === 13
    if (!ok && !found.includes(ch)) found.push(ch)
  }
  return found
}

/**
 * Replaces the typographic characters that cause almost all real-world ASCII
 * failures with their ASCII equivalents. Offered to the office as a one-click
 * fix — never applied automatically by the exporter.
 */
export function toAscii(value: string): string {
  return value
    .replace(/[–—−]/g, '-') // en dash, em dash, minus
    .replace(/[‘’‛]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/…/g, '...') // ellipsis
    .replace(/ /g, ' ') // non-breaking space
    .replace(/[²]/g, '2')
    .replace(/[³]/g, '3') // m³ → m3
    .replace(/°/g, ' deg ')
    .replace(/[•·]/g, '-')
}

// ─── §2.4.3 field 2 — the unique identifier ──────────────────────────────────

/**
 * AAANNNNNNN — three letters allocated by DETSI plus the 7-digit load number
 * that "cannot be repeated (or duplicated in any future submission)".
 * Throws rather than truncating: a wrong identifier is a compliance failure,
 * not a formatting nit.
 */
export function budfUniqueIdentifier(identifier: string, loadSeq: number): string {
  const aaa = identifier.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(aaa)) {
    throw new Error(
      `BUDF identifier must be exactly 3 letters allocated by the department, got "${identifier}"`
    )
  }
  if (!Number.isInteger(loadSeq) || loadSeq < 1 || loadSeq > 9_999_999) {
    throw new Error(
      `Load number must be a whole number between 1 and 9999999, got ${loadSeq}`
    )
  }
  return `${aaa}${String(loadSeq).padStart(7, '0')}`
}

// ─── §2.4.1 data file name ───────────────────────────────────────────────────

/**
 * BUDF_identifier_YYYYMMDD.csv, where YYYYMMDD is the date the file was
 * GENERATED — not the month the movements belong to (that is selected by
 * disposal date, §2.4).
 */
export function budfFileName(identifier: string, generatedOn: string): string {
  const aaa = identifier.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(aaa)) {
    throw new Error(`BUDF identifier must be exactly 3 letters, got "${identifier}"`)
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(generatedOn.trim())
  if (!m) {
    throw new Error(`Generation date must be YYYY-MM-DD, got "${generatedOn}"`)
  }
  return `BUDF_${aaa}_${m[1]}${m[2]}${m[3]}.csv`
}

// ─── The movement shape this module consumes ─────────────────────────────────

export interface BudfMovement {
  load_seq: number

  generator_name: string | null
  generator_abn: string | null
  generator_street_number: string | null
  generator_street_name: string | null
  generator_suburb: string | null
  generator_postcode: string | null
  generator_contact_name: string | null
  generator_contact_number: string | null
  collection_date: string | null
  local_government_area: string | null

  waste_physical_nature: string | null
  waste_code: string | null
  waste_amount: number | string | null
  waste_unit: string | null

  dg_un_class: string | null
  dg_un_number: string | null
  dg_subsidiary_risk: string | null
  dg_packaging_count: string | null
  dg_packaging_type: string | null
  dg_packing_group: string | null

  transporter_name: string | null
  transporter_contact_name: string | null
  transporter_contact_number: string | null
  transporter_street_number: string | null
  transporter_street_name: string | null
  transporter_suburb: string | null
  transporter_postcode: string | null
  transporter_abn: string | null
  transporter_ea_number: string | null
  transporter_collection_date: string | null
  vehicle1_plate: string | null
  vehicle1_type: string | null
  vehicle2_plate: string | null
  vehicle2_type: string | null
  transporter_discrepancy: string | null

  receiver_ea_number: string | null
  receiver_name: string | null
  receiver_contact_name: string | null
  receiver_contact_number: string | null
  receiver_street_number: string | null
  receiver_street_name: string | null
  receiver_suburb: string | null
  receiver_postcode: string | null
  receiver_abn: string | null
  received_date: string | null
  disposal_code: string | null
  receiver_physical_nature: string | null
  receiver_waste_code: string | null
  receiver_amount: number | string | null
  receiver_unit: string | null
  receiver_discrepancy: string | null

  waste_description: string | null
  consignment_authorisation: string | null
}

// ─── §2.4.3 the 55 fields, in order ──────────────────────────────────────────

export interface BudfFieldSpec {
  /** 1-based position in the record, as printed in the specification. */
  n: number
  /** The specification's own "General name". */
  name: string
  /** Max size from the specification; null where the column is blank. */
  max: number | null
  /** false where the specification's "Null allowed" column says Yes. */
  required: boolean
  value: (m: BudfMovement, ctx: BudfContext) => string
}

export interface BudfContext {
  companyName: string
  identifier: string
}

const t = (v: string | null | undefined): string => (v ?? '').trim()

export const BUDF_FIELDS: readonly BudfFieldSpec[] = [
  { n: 1, name: 'Submitters Company Name', max: null, required: true, value: (_m, c) => c.companyName.trim() },
  { n: 2, name: 'Unique Identifier', max: 10, required: true, value: (m, c) => budfUniqueIdentifier(c.identifier, m.load_seq) },

  { n: 3, name: 'Generator Name', max: 60, required: true, value: (m) => t(m.generator_name) },
  { n: 4, name: 'Generator ABN/ACN', max: 11, required: false, value: (m) => normaliseAbn(m.generator_abn) },
  { n: 5, name: 'Generator Street Number', max: 20, required: true, value: (m) => t(m.generator_street_number) },
  { n: 6, name: 'Generator Street Name', max: 40, required: true, value: (m) => t(m.generator_street_name) },
  { n: 7, name: 'Generator Suburb', max: 25, required: true, value: (m) => t(m.generator_suburb) },
  { n: 8, name: 'Generator Postcode', max: 4, required: true, value: (m) => t(m.generator_postcode) },
  { n: 9, name: 'Generator Contact Name', max: 50, required: true, value: (m) => t(m.generator_contact_name) },
  { n: 10, name: 'Generator Contact Number', max: 10, required: true, value: (m) => normaliseContactNumber(m.generator_contact_number) },
  { n: 11, name: 'Generator Collection Date', max: 10, required: true, value: (m) => formatBudfDate(m.collection_date) },
  { n: 12, name: 'Local Government Area', max: 50, required: false, value: (m) => t(m.local_government_area) },

  { n: 13, name: 'Generator Waste Physical Nature', max: 1, required: true, value: (m) => t(m.waste_physical_nature) },
  { n: 14, name: 'Generator Waste Code', max: 4, required: true, value: (m) => t(m.waste_code).toUpperCase() },
  { n: 15, name: 'Generator Waste Amount', max: 10, required: true, value: (m) => formatBudfAmount(m.waste_amount) },
  { n: 16, name: 'Generator Waste Volumetric Type', max: 2, required: true, value: (m) => t(m.waste_unit) },

  { n: 17, name: 'Dangerous Goods U.N Class', max: 2, required: false, value: (m) => t(m.dg_un_class) },
  { n: 18, name: 'Dangerous Goods Number', max: 4, required: false, value: (m) => t(m.dg_un_number) },
  { n: 19, name: 'Dangerous Goods Subsidiary Risk', max: 2, required: false, value: (m) => t(m.dg_subsidiary_risk) },
  { n: 20, name: 'Dangerous Goods Bulk/No of Packaging', max: 5, required: false, value: (m) => t(m.dg_packaging_count) },
  { n: 21, name: 'Dangerous Goods Type of Packaging', max: 20, required: false, value: (m) => t(m.dg_packaging_type) },
  { n: 22, name: 'Dangerous Goods Packaging Group', max: 1, required: false, value: (m) => t(m.dg_packing_group) },

  { n: 23, name: 'Waste Transporter Name', max: 60, required: true, value: (m) => t(m.transporter_name) },
  { n: 24, name: 'Waste Transporter Contact Name', max: 50, required: true, value: (m) => t(m.transporter_contact_name) },
  { n: 25, name: 'Waste Transporter Contact Number', max: 10, required: true, value: (m) => normaliseContactNumber(m.transporter_contact_number) },
  { n: 26, name: 'Transporter Street Number', max: 20, required: true, value: (m) => t(m.transporter_street_number) },
  { n: 27, name: 'Waste Transporter Street Name', max: 40, required: true, value: (m) => t(m.transporter_street_name) },
  { n: 28, name: 'Waste Transporter Suburb', max: 25, required: true, value: (m) => t(m.transporter_suburb) },
  { n: 29, name: 'Transporter Postcode', max: 4, required: true, value: (m) => t(m.transporter_postcode) },
  { n: 30, name: 'Waste Transporter ABN/ACN', max: 11, required: false, value: (m) => normaliseAbn(m.transporter_abn) },
  { n: 31, name: 'Waste Transporter Environmental Authority', max: 50, required: true, value: (m) => t(m.transporter_ea_number) },
  { n: 32, name: 'Waste Transporters Collection Date', max: 10, required: true, value: (m) => formatBudfDate(m.transporter_collection_date) },
  { n: 33, name: 'Transporter Vehicle 1 number plate', max: 7, required: true, value: (m) => t(m.vehicle1_plate).toUpperCase() },
  { n: 34, name: 'Transporter Vehicle 1 Type', max: 1, required: true, value: (m) => t(m.vehicle1_type).toUpperCase() },
  // [VERIFY V-5] The specification marks Vehicle 2 null-not-allowed, but a
  // rigid tipper with no trailer has no second vehicle. Relaxed to optional.
  { n: 35, name: 'Transporter Vehicle 2 number plate', max: 7, required: false, value: (m) => t(m.vehicle2_plate).toUpperCase() },
  { n: 36, name: 'Transporter Vehicle 2 Type', max: 1, required: false, value: (m) => t(m.vehicle2_type).toUpperCase() },
  { n: 37, name: 'Transporter Discrepancy', max: 225, required: false, value: (m) => t(m.transporter_discrepancy) },

  { n: 38, name: 'Waste Receiver Environmental Authority', max: 15, required: false, value: (m) => t(m.receiver_ea_number) },
  { n: 39, name: 'Waste Receiver Name', max: 50, required: true, value: (m) => t(m.receiver_name) },
  { n: 40, name: 'Waste Receiver Contact Name', max: 50, required: true, value: (m) => t(m.receiver_contact_name) },
  { n: 41, name: 'Waste Receiver Contact Number', max: 10, required: true, value: (m) => normaliseContactNumber(m.receiver_contact_number) },
  { n: 42, name: 'Waste Receiver Street Number', max: 20, required: true, value: (m) => t(m.receiver_street_number) },
  { n: 43, name: 'Waste Receiver Street Name', max: 40, required: true, value: (m) => t(m.receiver_street_name) },
  { n: 44, name: 'Waste Receiver Suburb', max: 25, required: true, value: (m) => t(m.receiver_suburb) },
  { n: 45, name: 'Receiver Postcode', max: 4, required: true, value: (m) => t(m.receiver_postcode) },
  { n: 46, name: 'Waste Receiver ABN/ACN', max: 11, required: false, value: (m) => normaliseAbn(m.receiver_abn) },
  { n: 47, name: 'Receiver Waste Received Date', max: 10, required: true, value: (m) => formatBudfDate(m.received_date) },
  // [VERIFY V-4] The "Null allowed" cell is blank for this field alone.
  // Treated as required — it is the substance of Part 3.
  { n: 48, name: 'Waste Disposal or Treatment Type', max: 10, required: true, value: (m) => t(m.disposal_code).toUpperCase() },
  { n: 49, name: 'Receiver Waste Physical Nature', max: 1, required: true, value: (m) => t(m.receiver_physical_nature) },
  { n: 50, name: 'Receiver Waste Code', max: 4, required: true, value: (m) => t(m.receiver_waste_code).toUpperCase() },
  { n: 51, name: 'Receiver Waste Volume', max: 10, required: true, value: (m) => formatBudfAmount(m.receiver_amount) },
  { n: 52, name: 'Receiver Waste Volume Measurement Unit', max: 2, required: true, value: (m) => t(m.receiver_unit) },
  // [VERIFY V-3] Max size column says 255, format column says X[225].
  // Validated at 225, the tighter of the two.
  { n: 53, name: 'Receiver Discrepancy', max: 225, required: false, value: (m) => t(m.receiver_discrepancy) },

  { n: 54, name: 'Waste Description', max: 225, required: false, value: (m) => t(m.waste_description) },
  { n: 55, name: 'Consignment Authorisation', max: 225, required: false, value: (m) => t(m.consignment_authorisation) },
]

/**
 * Fields whose max size the specification contradicts elsewhere. Length is not
 * enforced for these — see the [VERIFY] register in the design document.
 *   16, 52  max 2, but 'Each' and 'IBC' are permitted values (V-1)
 *   22      max 1, but I / II / III are the permitted values (V-2)
 */
const UNENFORCED_MAX = new Set([16, 22, 52])

// ─── Per-record validation ───────────────────────────────────────────────────

export interface BudfProblem {
  loadSeq: number
  field: number | null
  fieldName: string
  message: string
}

function checkEnum(
  value: string,
  allowed: readonly string[],
  spec: BudfFieldSpec,
  loadSeq: number,
  problems: BudfProblem[]
): void {
  if (value && !allowed.includes(value)) {
    problems.push({
      loadSeq,
      field: spec.n,
      fieldName: spec.name,
      message: `must be one of ${allowed.join(', ')} — got "${value}"`,
    })
  }
}

/**
 * Every reason this record cannot go in the file. An empty array means it
 * conforms. Reports ALL problems, not just the first — the office should fix a
 * record in one pass, not discover faults one at a time.
 */
export function validateMovement(m: BudfMovement, ctx: BudfContext): BudfProblem[] {
  const problems: BudfProblem[] = []
  const push = (field: number | null, fieldName: string, message: string) =>
    problems.push({ loadSeq: m.load_seq, field, fieldName, message })

  for (const spec of BUDF_FIELDS) {
    let value: string
    try {
      value = spec.value(m, ctx)
    } catch (err) {
      push(spec.n, spec.name, err instanceof Error ? err.message : 'could not be built')
      continue
    }

    if (spec.required && value === '') {
      push(spec.n, spec.name, 'is required and empty')
      continue
    }
    if (value === '') continue

    if (spec.max !== null && !UNENFORCED_MAX.has(spec.n) && value.length > spec.max) {
      push(spec.n, spec.name, `is ${value.length} characters, max ${spec.max}`)
    }

    // §2.1 — the whole file is ASCII.
    const nonAscii = nonAsciiCharacters(value)
    if (nonAscii.length > 0) {
      push(
        spec.n,
        spec.name,
        `contains non-ASCII characters (${nonAscii.join(' ')}) — the specification requires a plain ASCII file`
      )
    }

    switch (spec.n) {
      case 8:
      case 29:
      case 45:
        if (!/^\d{4}$/.test(value)) push(spec.n, spec.name, `must be 4 digits — got "${value}"`)
        break
      case 10:
      case 25:
      case 41:
        if (!/^\d{10}$/.test(value)) {
          push(spec.n, spec.name, `must be 10 digits — got "${value}" (${value.length} digits)`)
        }
        break
      // [VERIFY V-8] Field 4 is formatted N(11) while fields 30 and 46 are
      // N(9){NN}, though all three are described as "ABN or ACN". An ACN is 9
      // digits. 9 or 11 accepted for all three, as the descriptions intend.
      case 4:
      case 30:
      case 46:
        if (!/^(\d{9}|\d{11})$/.test(value)) {
          push(spec.n, spec.name, `must be an 11-digit ABN or 9-digit ACN — got ${value.length} digits`)
        }
        break
      case 11:
      case 32:
      case 47:
        if (!/^\d{2}-\d{2}-\d{4}$/.test(value)) {
          push(spec.n, spec.name, 'must be a valid date in DD-MM-YYYY form')
        }
        break
      case 13:
      case 49:
        checkEnum(value, PHYSICAL_NATURES, spec, m.load_seq, problems)
        break
      case 14:
      case 50:
        if (!isValidWasteCode(value)) {
          push(spec.n, spec.name, `"${value}" is not an Appendix A waste code`)
        }
        break
      case 16:
      case 52:
        checkEnum(value, BUDF_UNITS, spec, m.load_seq, problems)
        break
      case 22:
        checkEnum(value, DG_PACKING_GROUPS, spec, m.load_seq, problems)
        break
      case 34:
      case 36:
        checkEnum(value, VEHICLE_TYPES, spec, m.load_seq, problems)
        break
      case 48:
        if (!isValidDisposalCode(value)) {
          push(spec.n, spec.name, `"${value}" is not an Appendix B disposal or treatment code`)
        }
        break
    }
  }

  // Cross-field: a vehicle 2 plate without its type, or the reverse.
  const v2Plate = t(m.vehicle2_plate)
  const v2Type = t(m.vehicle2_type)
  if (Boolean(v2Plate) !== Boolean(v2Type)) {
    push(null, 'Transporter Vehicle 2', 'needs both a number plate and a type, or neither')
  }

  return problems
}

// ─── §2.4.2 header, §2.4.4 footer, and the whole file ────────────────────────

/**
 * [VERIFY V-6] §2.4.2 says only that "The header file has already been
 * populated in the form provided" — the specification never states its
 * contents. This placeholder MUST be replaced with the header row from the
 * department's own template before a real lodgement. buildBudfFile always
 * returns headerIsPlaceholder: true so callers surface it.
 */
export const BUDF_HEADER_PLACEHOLDER =
  '[VERIFY] REPLACE THIS LINE WITH THE HEADER ROW FROM THE DEPARTMENT TEMPLATE (spec 2.4.2)'

export interface BuildBudfInput {
  movements: BudfMovement[]
  /** The 3-letter identifier allocated by DETSI. */
  identifier: string | null | undefined
  /** settings.company_name — field 1. */
  companyName: string | null | undefined
  /** AU calendar day the file is generated, 'YYYY-MM-DD'. */
  generatedOn: string
  /** Optional override once the real header row is known (V-6). */
  headerRow?: string
}

export type BuildBudfResult =
  | {
      ok: true
      fileName: string
      csv: string
      recordCount: number
      headerIsPlaceholder: boolean
    }
  | { ok: false; problems: BudfProblem[] }

/**
 * Builds the whole file, or refuses and explains why.
 *
 * Refuses when the identifier is unallocated (V-7), when there are no
 * movements, or when ANY record fails validation — the department rejects a
 * non-conforming file in full.
 */
export function buildBudfFile(input: BuildBudfInput): BuildBudfResult {
  const problems: BudfProblem[] = []

  const identifier = (input.identifier ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(identifier)) {
    problems.push({
      loadSeq: 0,
      field: 2,
      fieldName: 'Unique Identifier',
      message:
        'No 3-letter identifier is set. DETSI must allocate one and approve bulk upload before a file can be lodged (waste.track@des.qld.gov.au, 07 3330 5677).',
    })
  }

  const companyName = (input.companyName ?? '').trim()
  if (!companyName) {
    problems.push({
      loadSeq: 0,
      field: 1,
      fieldName: 'Submitters Company Name',
      message: 'No company name is set in settings.',
    })
  }

  if (input.movements.length === 0) {
    problems.push({
      loadSeq: 0,
      field: null,
      fieldName: 'File',
      message: 'No movements were disposed of in this month, so there is nothing to lodge.',
    })
  }

  // Field 2 must never repeat. A duplicate within one file is a hard stop.
  const seen = new Set<number>()
  for (const m of input.movements) {
    if (seen.has(m.load_seq)) {
      problems.push({
        loadSeq: m.load_seq,
        field: 2,
        fieldName: 'Unique Identifier',
        message: 'appears more than once in this file — load numbers must never repeat',
      })
    }
    seen.add(m.load_seq)
  }

  if (problems.length > 0) return { ok: false, problems }

  const ctx: BudfContext = { companyName, identifier }
  for (const m of input.movements) {
    problems.push(...validateMovement(m, ctx))
  }
  if (problems.length > 0) return { ok: false, problems }

  const headerRow = input.headerRow ?? BUDF_HEADER_PLACEHOLDER
  const lines = [
    headerRow,
    ...input.movements.map((m) => toRecord(BUDF_FIELDS.map((f) => f.value(m, ctx)))),
    // §2.4.4: one field, the movement count. Excludes header and footer.
    toRecord([input.movements.length]),
  ]

  return {
    ok: true,
    fileName: budfFileName(identifier, input.generatedOn),
    // §2.2(a): every record ends with an EOR, including the last.
    csv: lines.join(BUDF_EOR) + BUDF_EOR,
    recordCount: input.movements.length,
    headerIsPlaceholder: input.headerRow === undefined,
  }
}

/** Groups problems by load number for display in the office register. */
export function groupProblems(problems: BudfProblem[]): Map<number, BudfProblem[]> {
  const grouped = new Map<number, BudfProblem[]>()
  for (const p of problems) {
    const list = grouped.get(p.loadSeq)
    if (list) list.push(p)
    else grouped.set(p.loadSeq, [p])
  }
  return grouped
}

/** The disposal month a movement belongs to (§2.4), 'YYYY-MM', or null. */
export function disposalMonth(m: Pick<BudfMovement, 'received_date'>): string | null {
  if (!m.received_date) return null
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(m.received_date.trim())
  return match ? `${match[1]}-${match[2]}` : null
}

export type { BudfUnit }
