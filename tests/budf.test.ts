import { describe, expect, test } from 'vitest'
import {
  BUDF_EOR,
  BUDF_FIELDS,
  BUDF_HEADER_PLACEHOLDER,
  budfFileName,
  budfUniqueIdentifier,
  buildBudfFile,
  disposalMonth,
  escapeBudfField,
  formatBudfAmount,
  formatBudfDate,
  groupProblems,
  normaliseAbn,
  normaliseContactNumber,
  validateMovement,
  type BudfMovement,
} from '../src/lib/waste/budf'
import {
  ALL_DISPOSAL_CODES,
  DISPOSAL_CODES,
  TREATMENT_CODES,
  WASTE_CODES,
  findWasteCode,
  isValidDisposalCode,
  isValidWasteCode,
} from '../src/lib/waste/qld-codes'

// A complete, conforming asbestos movement — the common case for this business.
// Tests mutate a clone of this to isolate one fault at a time.
function movement(overrides: Partial<BudfMovement> = {}): BudfMovement {
  return {
    load_seq: 1,
    generator_name: 'Brisbane City Council',
    generator_abn: '72 002 765 795',
    generator_street_number: '266',
    generator_street_name: 'George Street',
    generator_suburb: 'Brisbane',
    generator_postcode: '4000',
    generator_contact_name: 'Site Manager',
    generator_contact_number: '07 3403 8888',
    collection_date: '2026-07-15',
    local_government_area: 'Brisbane City',
    waste_physical_nature: 'S',
    waste_code: 'N220',
    waste_amount: 2.5,
    waste_unit: 'm3',
    dg_un_class: null,
    dg_un_number: null,
    dg_subsidiary_risk: null,
    dg_packaging_count: null,
    dg_packaging_type: null,
    dg_packing_group: null,
    transporter_name: 'Reliable Haulage Pty Ltd',
    transporter_contact_name: 'Dispatch',
    transporter_contact_number: '0733305677',
    transporter_street_number: '14',
    transporter_street_name: 'Depot Road',
    transporter_suburb: 'Wacol',
    transporter_postcode: '4076',
    transporter_abn: '11222333444',
    transporter_ea_number: 'EA0001234',
    transporter_collection_date: '2026-07-15',
    vehicle1_plate: '123ABC',
    vehicle1_type: 'V',
    vehicle2_plate: null,
    vehicle2_type: null,
    transporter_discrepancy: null,
    receiver_ea_number: 'EPPR00123456',
    receiver_name: 'Swanbank Landfill',
    receiver_contact_name: 'Weighbridge',
    receiver_contact_number: '0738100000',
    receiver_street_number: '100',
    receiver_street_name: 'Cobb Street',
    receiver_suburb: 'Swanbank',
    receiver_postcode: '4306',
    receiver_abn: '99888777666',
    received_date: '2026-07-15',
    disposal_code: 'D1',
    receiver_physical_nature: 'S',
    receiver_waste_code: 'N220',
    receiver_amount: 2.5,
    receiver_unit: 'm3',
    receiver_discrepancy: null,
    waste_description: 'Bonded asbestos cement sheeting, double wrapped',
    consignment_authorisation: null,
    ...overrides,
  }
}

const CTX = { companyName: 'Entice Civil Pty Ltd', identifier: 'ECR' }

/**
 * Counts fields in one CSV record, honouring §2.2 quoting — a comma inside a
 * quoted field is data, not a separator. A regex cannot do this correctly.
 */
function countCsvFields(record: string): number {
  let count = 1
  let inQuotes = false
  for (let i = 0; i < record.length; i++) {
    const ch = record[i]
    if (ch === '"') {
      if (inQuotes && record[i + 1] === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      count++
    }
  }
  return count
}

function build(overrides: Partial<BudfMovement>[] = [{}], extra = {}) {
  return buildBudfFile({
    movements: overrides.map((o, i) => movement({ load_seq: i + 1, ...o })),
    identifier: 'ECR',
    companyName: 'Entice Civil Pty Ltd',
    generatedOn: '2026-08-03',
    ...extra,
  })
}

// ─── §2.2 escaping ───────────────────────────────────────────────────────────

describe('escapeBudfField — spec §2.2', () => {
  test('(d) null and undefined become empty fields', () => {
    expect(escapeBudfField(null)).toBe('')
    expect(escapeBudfField(undefined)).toBe('')
    expect(escapeBudfField('')).toBe('')
  })

  test('plain values pass through unquoted', () => {
    expect(escapeBudfField('Asbestos')).toBe('Asbestos')
    expect(escapeBudfField(2.5)).toBe('2.5')
  })

  test('(e) embedded comma is quoted', () => {
    expect(escapeBudfField('Bonded sheeting, double wrapped')).toBe(
      '"Bonded sheeting, double wrapped"'
    )
  })

  test('(h) embedded double-quote is doubled and the field quoted', () => {
    expect(escapeBudfField('Peter "R" Rabbit')).toBe('"Peter ""R"" Rabbit"')
    expect(escapeBudfField('6" pipe')).toBe('"6"" pipe"')
  })

  test('(i) embedded line breaks are quoted, both LF and CRLF', () => {
    expect(escapeBudfField('this text has a\nline-break')).toBe(
      '"this text has a\nline-break"'
    )
    expect(escapeBudfField('crlf\r\nhere')).toBe('"crlf\r\nhere"')
  })

  // This is the rule src/lib/csv.ts does NOT implement, which is why BUDF has
  // its own escaper. A silent failure here produces a file the department
  // rejects in full.
  test('(g) leading or trailing spaces are preserved by quoting', () => {
    expect(escapeBudfField(' Jogging ')).toBe('" Jogging "')
    expect(escapeBudfField('trailing ')).toBe('"trailing "')
    expect(escapeBudfField(' leading')).toBe('" leading"')
    expect(escapeBudfField('\ttab-edged\t')).toBe('"\ttab-edged\t"')
  })

  test('interior spaces alone do not trigger quoting', () => {
    expect(escapeBudfField('Brisbane City Council')).toBe('Brisbane City Council')
  })

  test('comma and quote together', () => {
    expect(escapeBudfField('a,"b"')).toBe('"a,""b"""')
  })
})

// ─── §2.3 data types ─────────────────────────────────────────────────────────

describe('formatBudfDate — DD-MM-YYYY', () => {
  test('converts ISO to the spec form', () => {
    expect(formatBudfDate('2026-07-15')).toBe('15-07-2026')
  })

  test('keeps leading zeros on both day and month', () => {
    expect(formatBudfDate('2026-01-09')).toBe('09-01-2026')
  })

  test('null, blank and malformed give an empty field', () => {
    expect(formatBudfDate(null)).toBe('')
    expect(formatBudfDate('')).toBe('')
    expect(formatBudfDate('15/07/2026')).toBe('')
    expect(formatBudfDate('2026-7-5')).toBe('')
  })
})

describe('formatBudfAmount — §2.3.3', () => {
  test('whole numbers carry no decimal point', () => {
    expect(formatBudfAmount(12)).toBe('12')
    expect(formatBudfAmount('1250.00')).toBe('1250')
  })

  test('non-whole numbers carry an explicit two-place decimal', () => {
    expect(formatBudfAmount(2.5)).toBe('2.50')
    expect(formatBudfAmount('0.75')).toBe('0.75')
  })

  test('null and non-numeric give an empty field', () => {
    expect(formatBudfAmount(null)).toBe('')
    expect(formatBudfAmount('')).toBe('')
    expect(formatBudfAmount('heavy')).toBe('')
  })
})

describe('normalisers', () => {
  test('contact numbers strip formatting to 10 digits', () => {
    expect(normaliseContactNumber('07 3403 8888')).toBe('0734038888')
    expect(normaliseContactNumber('(07) 3403-8888')).toBe('0734038888')
    expect(normaliseContactNumber('0412 345 678')).toBe('0412345678')
  })

  test('ABN strips spaces', () => {
    expect(normaliseAbn('72 002 765 795')).toBe('72002765795')
  })
})

// ─── §2.4.3 field 2 — the unique identifier ──────────────────────────────────

describe('budfUniqueIdentifier — AAANNNNNNN', () => {
  test('pads the load number to seven digits', () => {
    expect(budfUniqueIdentifier('ECR', 1)).toBe('ECR0000001')
    expect(budfUniqueIdentifier('ECR', 123)).toBe('ECR0000123')
    expect(budfUniqueIdentifier('ECR', 9999999)).toBe('ECR9999999')
  })

  test('is always exactly 10 characters — the field max', () => {
    expect(budfUniqueIdentifier('ECR', 1)).toHaveLength(10)
    expect(budfUniqueIdentifier('ECR', 9999999)).toHaveLength(10)
  })

  test('upper-cases the allocated identifier', () => {
    expect(budfUniqueIdentifier('ecr', 7)).toBe('ECR0000007')
  })

  test('rejects an identifier that is not three letters', () => {
    expect(() => budfUniqueIdentifier('EC', 1)).toThrow(/3 letters/)
    expect(() => budfUniqueIdentifier('ECRX', 1)).toThrow(/3 letters/)
    expect(() => budfUniqueIdentifier('E1R', 1)).toThrow(/3 letters/)
    expect(() => budfUniqueIdentifier('', 1)).toThrow(/3 letters/)
  })

  test('rejects a load number that cannot fit NNNNNNN', () => {
    expect(() => budfUniqueIdentifier('ECR', 0)).toThrow(/between 1 and 9999999/)
    expect(() => budfUniqueIdentifier('ECR', 10_000_000)).toThrow(/between 1 and 9999999/)
    expect(() => budfUniqueIdentifier('ECR', 1.5)).toThrow(/whole number/)
  })
})

// ─── §2.4.1 file name ────────────────────────────────────────────────────────

describe('budfFileName — §2.4.1', () => {
  test('matches the specification example format', () => {
    expect(budfFileName('FIN', '2016-08-09')).toBe('BUDF_FIN_20160809.csv')
  })

  test('uses the generation date, not the movement month', () => {
    expect(budfFileName('ECR', '2026-08-03')).toBe('BUDF_ECR_20260803.csv')
  })

  test('rejects a bad identifier or date', () => {
    expect(() => budfFileName('EC', '2026-08-03')).toThrow()
    expect(() => budfFileName('ECR', '03-08-2026')).toThrow()
  })
})

// ─── §2.4.3 field order ──────────────────────────────────────────────────────

describe('field table', () => {
  test('has exactly 55 fields numbered 1..55 in order', () => {
    expect(BUDF_FIELDS).toHaveLength(55)
    expect(BUDF_FIELDS.map((f) => f.n)).toEqual(
      Array.from({ length: 55 }, (_, i) => i + 1)
    )
  })

  test('the specification field names sit at their stated positions', () => {
    const at = (n: number) => BUDF_FIELDS.find((f) => f.n === n)?.name
    expect(at(1)).toBe('Submitters Company Name')
    expect(at(2)).toBe('Unique Identifier')
    expect(at(3)).toBe('Generator Name')
    expect(at(16)).toBe('Generator Waste Volumetric Type')
    expect(at(29)).toBe('Transporter Postcode')
    expect(at(31)).toBe('Waste Transporter Environmental Authority')
    expect(at(48)).toBe('Waste Disposal or Treatment Type')
    expect(at(55)).toBe('Consignment Authorisation')
  })
})

// ─── File structure ──────────────────────────────────────────────────────────

describe('buildBudfFile — file structure', () => {
  test('header, one record per movement, footer', () => {
    const result = build([{}, {}, {}])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const lines = result.csv.split(BUDF_EOR)
    expect(lines.at(-1)).toBe('') // trailing EOR after the footer
    const records = lines.slice(0, -1)
    expect(records).toHaveLength(5) // header + 3 + footer
    expect(records[0]).toBe(BUDF_HEADER_PLACEHOLDER)
    expect(records.at(-1)).toBe('3')
  })

  test('the footer counts movements only, excluding header and footer', () => {
    const result = build([{}, {}])
    if (!result.ok) throw new Error('expected a file')
    expect(result.csv.split(BUDF_EOR).filter(Boolean).at(-1)).toBe('2')
    expect(result.recordCount).toBe(2)
  })

  test('each movement record has 55 comma-separated fields', () => {
    const result = build()
    if (!result.ok) throw new Error('expected a file')
    const record = result.csv.split(BUDF_EOR)[1]
    expect(countCsvFields(record)).toBe(55)
  })

  test('records end with CRLF and the file ends with one', () => {
    const result = build()
    if (!result.ok) throw new Error('expected a file')
    expect(result.csv.endsWith('\r\n')).toBe(true)
    expect(result.csv).toContain('\r\n')
  })

  test('the header is flagged as a placeholder until overridden', () => {
    const placeholder = build()
    if (!placeholder.ok) throw new Error('expected a file')
    expect(placeholder.headerIsPlaceholder).toBe(true)
    expect(placeholder.csv.startsWith('[VERIFY]')).toBe(true)

    const real = build([{}], { headerRow: 'A,B,C' })
    if (!real.ok) throw new Error('expected a file')
    expect(real.headerIsPlaceholder).toBe(false)
    expect(real.csv.startsWith('A,B,C\r\n')).toBe(true)
  })

  test('field 2 is written at position 2 and field 1 at position 1', () => {
    const result = build([{ load_seq: 42 }])
    if (!result.ok) throw new Error('expected a file')
    const fields = result.csv.split(BUDF_EOR)[1].split(',')
    expect(fields[0]).toBe('Entice Civil Pty Ltd')
    expect(fields[1]).toBe('ECR0000042')
  })

  test('a description containing a comma is quoted in the record', () => {
    const result = build([
      { waste_description: 'Bonded sheeting, double wrapped' },
    ])
    if (!result.ok) throw new Error('expected a file')
    expect(result.csv).toContain('"Bonded sheeting, double wrapped"')
  })

  test('dates are written DD-MM-YYYY, not ISO', () => {
    const result = build()
    if (!result.ok) throw new Error('expected a file')
    expect(result.csv).toContain('15-07-2026')
    expect(result.csv).not.toContain('2026-07-15')
  })
})

// ─── Refusal to emit a non-conforming file ───────────────────────────────────

describe('buildBudfFile — refuses rather than emitting a bad file', () => {
  test('no identifier allocated (V-7)', () => {
    const result = buildBudfFile({
      movements: [movement()],
      identifier: null,
      companyName: 'Entice Civil Pty Ltd',
      generatedOn: '2026-08-03',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0].field).toBe(2)
    expect(result.problems[0].message).toMatch(/DETSI must allocate/)
  })

  test('no movements in the month', () => {
    const result = buildBudfFile({
      movements: [],
      identifier: 'ECR',
      companyName: 'Entice Civil Pty Ltd',
      generatedOn: '2026-08-03',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0].message).toMatch(/nothing to lodge/)
  })

  test('a duplicated load number is a hard stop', () => {
    const result = buildBudfFile({
      movements: [movement({ load_seq: 7 }), movement({ load_seq: 7 })],
      identifier: 'ECR',
      companyName: 'Entice Civil Pty Ltd',
      generatedOn: '2026-08-03',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0].message).toMatch(/never repeat/)
  })

  test('ONE incomplete record blocks the whole file', () => {
    const result = build([{}, { received_date: null, disposal_code: null }, {}])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.some((p) => p.field === 47)).toBe(true)
    expect(result.problems.some((p) => p.field === 48)).toBe(true)
  })
})

// ─── Per-record validation ───────────────────────────────────────────────────

describe('validateMovement', () => {
  test('the reference movement conforms', () => {
    expect(validateMovement(movement(), CTX)).toEqual([])
  })

  test('reports every fault, not just the first', () => {
    const problems = validateMovement(
      movement({
        generator_name: null,
        generator_postcode: '400',
        receiver_contact_number: '123',
      }),
      CTX
    )
    expect(problems.map((p) => p.field).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      3, 8, 41,
    ])
  })

  test('missing transporter EA number is caught (field 31)', () => {
    const problems = validateMovement(movement({ transporter_ea_number: null }), CTX)
    expect(problems).toHaveLength(1)
    expect(problems[0].field).toBe(31)
    expect(problems[0].message).toMatch(/required/)
  })

  test('postcodes must be four digits', () => {
    expect(validateMovement(movement({ generator_postcode: '4000' }), CTX)).toEqual([])
    expect(validateMovement(movement({ generator_postcode: 'QLD' }), CTX)[0].field).toBe(8)
    expect(validateMovement(movement({ transporter_postcode: '407' }), CTX)[0].field).toBe(29)
  })

  test('contact numbers must be ten digits', () => {
    const ok = validateMovement(movement({ generator_contact_number: '(07) 3403 8888' }), CTX)
    expect(ok).toEqual([])
    const bad = validateMovement(movement({ generator_contact_number: '3403 8888' }), CTX)
    expect(bad[0].field).toBe(10)
  })

  test('ABN accepts 11 digits and ACN accepts 9 (V-8)', () => {
    expect(validateMovement(movement({ generator_abn: '72002765795' }), CTX)).toEqual([])
    expect(validateMovement(movement({ generator_abn: '002765795' }), CTX)).toEqual([])
    expect(validateMovement(movement({ generator_abn: '1234' }), CTX)[0].field).toBe(4)
  })

  test('nullable fields may be absent', () => {
    expect(
      validateMovement(
        movement({
          generator_abn: null,
          local_government_area: null,
          waste_description: null,
          consignment_authorisation: null,
          receiver_ea_number: null,
          transporter_abn: null,
          receiver_abn: null,
        }),
        CTX
      )
    ).toEqual([])
  })

  test('physical nature must be L, S, M or P', () => {
    expect(validateMovement(movement({ waste_physical_nature: 'X' }), CTX)[0].field).toBe(13)
    for (const nature of ['L', 'S', 'M', 'P']) {
      expect(validateMovement(movement({ waste_physical_nature: nature }), CTX)).toEqual([])
    }
  })

  test('waste code must be an Appendix A code', () => {
    expect(validateMovement(movement({ waste_code: 'N220' }), CTX)).toEqual([])
    const bad = validateMovement(movement({ waste_code: 'Z999' }), CTX)
    expect(bad[0].field).toBe(14)
    expect(bad[0].message).toMatch(/not an Appendix A waste code/)
  })

  test('disposal code must be an Appendix B code, either table', () => {
    expect(validateMovement(movement({ disposal_code: 'D1' }), CTX)).toEqual([])
    expect(validateMovement(movement({ disposal_code: 'D9A' }), CTX)).toEqual([])
    expect(validateMovement(movement({ disposal_code: 'R14' }), CTX)).toEqual([])
    // D3 and R10 are absent from the specification's tables.
    expect(validateMovement(movement({ disposal_code: 'D3' }), CTX)[0].field).toBe(48)
    expect(validateMovement(movement({ disposal_code: 'R10' }), CTX)[0].field).toBe(48)
  })

  test('units accept kg, L, m3, Each and IBC (V-1)', () => {
    for (const unit of ['kg', 'L', 'm3', 'Each', 'IBC']) {
      expect(
        validateMovement(movement({ waste_unit: unit, receiver_unit: unit }), CTX)
      ).toEqual([])
    }
    expect(validateMovement(movement({ waste_unit: 't' }), CTX)[0].field).toBe(16)
  })

  test('the max-2 limit is not enforced on unit fields (V-1)', () => {
    // 'Each' is 4 characters against a stated max of 2 — length must not fire.
    const problems = validateMovement(
      movement({ waste_unit: 'Each', receiver_unit: 'Each' }),
      CTX
    )
    expect(problems).toEqual([])
  })

  test('the max-1 limit is not enforced on packing group (V-2)', () => {
    expect(validateMovement(movement({ dg_packing_group: 'III' }), CTX)).toEqual([])
    expect(validateMovement(movement({ dg_packing_group: 'IV' }), CTX)[0].field).toBe(22)
  })

  test('over-length text is rejected against the stated max', () => {
    const problems = validateMovement(movement({ generator_name: 'x'.repeat(61) }), CTX)
    expect(problems[0].field).toBe(3)
    expect(problems[0].message).toMatch(/61 characters, max 60/)
  })

  test('discrepancy and description are validated at 225, not 255 (V-3)', () => {
    expect(validateMovement(movement({ waste_description: 'x'.repeat(225) }), CTX)).toEqual([])
    expect(validateMovement(movement({ waste_description: 'x'.repeat(226) }), CTX)[0].field).toBe(54)
  })

  test('vehicle 2 is optional (V-5) but must be complete if given', () => {
    expect(validateMovement(movement({ vehicle2_plate: null, vehicle2_type: null }), CTX)).toEqual([])
    expect(
      validateMovement(movement({ vehicle2_plate: 'TRL456', vehicle2_type: 'T' }), CTX)
    ).toEqual([])

    const half = validateMovement(movement({ vehicle2_plate: 'TRL456', vehicle2_type: null }), CTX)
    expect(half).toHaveLength(1)
    expect(half[0].fieldName).toBe('Transporter Vehicle 2')

    const other = validateMovement(movement({ vehicle2_plate: null, vehicle2_type: 'T' }), CTX)
    expect(other).toHaveLength(1)
  })

  test('vehicle type must be V or T', () => {
    expect(validateMovement(movement({ vehicle1_type: 'X' }), CTX)[0].field).toBe(34)
  })

  test('an unlodgeable identifier surfaces as a field 2 problem', () => {
    const problems = validateMovement(movement(), { ...CTX, identifier: 'TOOLONG' })
    expect(problems[0].field).toBe(2)
  })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('helpers', () => {
  test('groupProblems collects faults per load number', () => {
    const result = build([{ generator_name: null }, { receiver_name: null }])
    if (result.ok) throw new Error('expected refusal')
    const grouped = groupProblems(result.problems)
    expect([...grouped.keys()].sort()).toEqual([1, 2])
  })

  test('disposalMonth reads the month from the received date, per §2.4', () => {
    expect(disposalMonth({ received_date: '2026-07-31' })).toBe('2026-07')
    expect(disposalMonth({ received_date: null })).toBeNull()
  })
})

// ─── Appendix integrity ──────────────────────────────────────────────────────

describe('Appendix A and B — as extracted from ESR/2023/6563 v2.01', () => {
  test('Appendix A holds 70 codes, all unique', () => {
    expect(WASTE_CODES).toHaveLength(70)
    expect(new Set(WASTE_CODES.map((w) => w.code)).size).toBe(70)
  })

  test('every waste code matches the ANNN format of field 14', () => {
    for (const w of WASTE_CODES) expect(w.code).toMatch(/^[A-Z][0-9]{3}$/)
  })

  test('asbestos is N220 — the common case here', () => {
    expect(findWasteCode('N220')?.description).toBe('Asbestos')
    expect(isValidWasteCode('n220')).toBe(true)
  })

  test('the four asterisked precedence codes are marked, without the asterisk', () => {
    const priority = WASTE_CODES.filter((w) => w.priority).map((w) => w.code)
    expect(priority.sort()).toEqual(['N140', 'N160', 'R100', 'R120'])
    for (const w of WASTE_CODES) expect(w.code).not.toContain('*')
  })

  test('the six manufacture sub-rows carry their paired codes', () => {
    const d = (code: string) => findWasteCode(code)?.description ?? ''
    expect(d('H100')).toMatch(/biocides and phytopharmaceuticals$/)
    expect(d('F100')).toMatch(/inks, dyes, pigments, paints, lacquers and varnish$/)
    expect(d('G160')).toMatch(/organic solvents$/)
    expect(d('T120')).toMatch(/photographic chemicals or processing materials$/)
    expect(d('F110')).toMatch(/resins, latex, plasticisers, glues and adhesives$/)
    expect(d('H170')).toMatch(/wood-preserving chemicals$/)
  })

  test('Appendix B holds 11 disposal and 12 treatment codes', () => {
    expect(DISPOSAL_CODES).toHaveLength(11)
    expect(TREATMENT_CODES).toHaveLength(12)
    expect(ALL_DISPOSAL_CODES).toHaveLength(23)
    expect(TREATMENT_CODES.map((c) => c.code)).toEqual([
      'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R11', 'R13', 'R14',
    ])
    expect(DISPOSAL_CODES.map((c) => c.code)).toEqual([
      'D1', 'D2', 'D4', 'D8', 'D9A', 'D9B', 'D10', 'D12', 'D13', 'D14', 'D15',
    ])
  })

  test('the gaps in the specification tables are preserved', () => {
    // D3, D5, D6, D7, D11, R10 and R12 are absent from the source tables.
    for (const absent of ['D3', 'D5', 'D6', 'D7', 'D11', 'R10', 'R12']) {
      expect(isValidDisposalCode(absent)).toBe(false)
    }
    for (const present of ['D1', 'D2', 'D4', 'D8', 'D9A', 'D9B', 'D10', 'D12', 'D13', 'D14', 'D15']) {
      expect(isValidDisposalCode(present)).toBe(true)
    }
  })

  test('every disposal code fits field 48 (max 10, X[10])', () => {
    for (const d of ALL_DISPOSAL_CODES) expect(d.code.length).toBeLessThanOrEqual(10)
  })
})
