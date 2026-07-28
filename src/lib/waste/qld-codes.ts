// Queensland trackable waste code tables.
//
// SOURCE OF TRUTH: DETSI "Waste Tracking — Bulk Upload Data File Specification",
// ESR/2023/6563 version 2.01, last reviewed 25 January 2023 — Appendix A (waste
// description and code) and Appendix B (disposal and treatment codes).
//
// Both appendices carry the note "These codes are subject to change by the
// department" (§2.1). That is precisely why these lists live here and not in a
// database CHECK constraint: a departmental change is a code change, not a
// migration. Re-check against the current specification before go-live.
//
// Nothing in this file is inferred. The six sub-rows of "Waste from the
// manufacture, formulation or use of —" (H100, F100, G160, T120, F110, H170)
// render offset from their descriptions in linear PDF text extraction and were
// paired to their descriptions by table-row coordinate before transcription.

export const BUDF_SPEC_VERSION = 'ESR/2023/6563 v2.01 (25 January 2023)'

// ─── Physical nature — fields 13 and 49 ──────────────────────────────────────

export const PHYSICAL_NATURES = ['L', 'S', 'M', 'P'] as const
export type PhysicalNature = (typeof PHYSICAL_NATURES)[number]

export const PHYSICAL_NATURE_LABELS: Record<PhysicalNature, string> = {
  L: 'Liquid',
  S: 'Solid',
  M: 'Mixed',
  P: 'Sludge',
}

// ─── Units — fields 16 and 52 ────────────────────────────────────────────────
//
// "Only kg, L and m³ will be accepted. Specify if it's an individual item: Each
// or IBC (this only applies to empty containers)."
//
// [VERIFY V-1] The specification gives this field a max size of 2 while
// permitting the values 'Each' (4 characters) and 'IBC' (3). Its format,
// A{XXX}, admits 1 or 4 characters, which fits neither 'kg' nor 'IBC'. The
// three constraints cannot all hold. All five values are accepted here and the
// size-2 limit is not enforced; confirm with the department before lodging.

export const BUDF_UNITS = ['kg', 'L', 'm3', 'Each', 'IBC'] as const
export type BudfUnit = (typeof BUDF_UNITS)[number]

export const BUDF_UNIT_LABELS: Record<BudfUnit, string> = {
  kg: 'Kilograms',
  L: 'Litres',
  m3: 'Cubic metres (m³)',
  Each: 'Each (empty containers only)',
  IBC: 'IBC (empty containers only)',
}

/** Units that measure a quantity rather than counting empty containers. */
export const BUDF_MEASURED_UNITS: readonly BudfUnit[] = ['kg', 'L', 'm3']

// ─── Dangerous goods packing group — field 22 ────────────────────────────────
//
// [VERIFY V-2] Max size 1, but the permitted values are I, II and III.

export const DG_PACKING_GROUPS = ['I', 'II', 'III'] as const
export type DgPackingGroup = (typeof DG_PACKING_GROUPS)[number]

export const DG_PACKING_GROUP_LABELS: Record<DgPackingGroup, string> = {
  I: 'I — High risk',
  II: 'II — Medium risk',
  III: 'III — Low risk',
}

// ─── Vehicle type — fields 34 and 36 ─────────────────────────────────────────

export const VEHICLE_TYPES = ['V', 'T'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  V: 'Vehicle',
  T: 'Trailer',
}

// ─── Appendix A — waste description and code ─────────────────────────────────

export interface WasteCode {
  code: string
  description: string
  /**
   * Appendix A note: "If a substance falls under more than 1 item in this list,
   * and the code for one of the items is marked with an asterisk, the code for
   * the substance is the code marked with an asterisk."
   *
   * The asterisk is a precedence marker, NOT part of the code — field 14 is
   * ANNN, four characters, so it is never written to the file.
   */
  priority?: true
}

/** All 70 Appendix A codes, in the specification's own order. */
export const WASTE_CODES: readonly WasteCode[] = [
  { code: 'B100', description: 'Acidic solutions or acids in solid form' },
  {
    code: 'K100',
    description:
      'Animal effluent and residues, including abattoir effluent, poultry and fish processing wastes',
  },
  { code: 'D170', description: 'Antimony and antimony compounds' },
  { code: 'D130', description: 'Arsenic and arsenic compounds' },
  { code: 'N220', description: 'Asbestos' },
  { code: 'D290', description: 'Barium compounds other than barium sulphate' },
  {
    code: 'C100',
    description: 'Basic (alkaline) solutions or bases (alkalis) in solid form',
  },
  { code: 'D160', description: 'Beryllium and beryllium compounds' },
  { code: 'D310', description: 'Boron compounds' },
  { code: 'D150', description: 'Cadmium and cadmium compounds' },
  {
    code: 'T100',
    description:
      'Chemical waste arising from a research and development or teaching activity, including new or unidentified material and material whose effects on human health or the environment are not known',
  },
  { code: 'D350', description: 'Chlorates' },
  { code: 'D140', description: 'Chromium compounds (hexavalent and trivalent)' },
  { code: 'R100', description: 'Clinical and related wastes', priority: true },
  { code: 'D190', description: 'Copper compounds' },
  { code: 'A130', description: 'Cyanides (inorganic)' },
  { code: 'M210', description: 'Cyanides (organic)' },
  {
    code: 'N160',
    description:
      'Encapsulated, chemically fixed, solidified or polymerised wastes',
    priority: true,
  },
  { code: 'G100', description: 'Ethers' },
  {
    code: 'N190',
    description:
      'Filter cake, other than filter cake waste generated from the treatment of raw water for the supply of drinking water',
  },
  {
    code: 'N140',
    description: 'Fire debris and fire wash waters',
    priority: true,
  },
  { code: 'N150', description: 'Fly ash' },
  { code: 'K110', description: 'Grease trap waste' },
  { code: 'G150', description: 'Halogenated organic solvents' },
  {
    code: 'M260',
    description:
      'Highly odorous organic chemicals, including mercaptans and acrylates',
  },
  {
    code: 'D110',
    description: 'Inorganic fluorine compounds, other than calcium fluoride',
  },
  { code: 'D330', description: 'Inorganic sulphides' },
  { code: 'M220', description: 'Isocyanate compounds' },
  { code: 'D220', description: 'Lead and lead compounds' },
  { code: 'K200', description: 'Liquid food processing waste' },
  {
    code: 'M100',
    description:
      "Material containing polychlorinated biphenyls ((PCB's), polychlorinated napthalenes (PCN's), polychlorinated terphenyls (PCT's) and/or polybrominated biphenyls (PBB's)",
  },
  { code: 'D120', description: 'Mercury and mercury compounds' },
  { code: 'D100', description: 'Metal carbonyls' },
  { code: 'J100', description: 'Mineral oils' },
  { code: 'D210', description: 'Nickel compounds' },
  { code: 'D300', description: 'Non-toxic salts' },
  {
    code: 'J120',
    description:
      'Oil and water mixtures or emulsions, or hydrocarbons and water mixtures or emulsions',
  },
  { code: 'H110', description: 'Organic phosphorous compounds' },
  {
    code: 'G110',
    description: 'Organic solvents, other than halogenated solvents',
  },
  {
    code: 'M160',
    description:
      'Organohalogen compounds, other than another substances referred to in this table',
  },
  { code: 'D340', description: 'Perchlorates' },
  {
    code: 'R120',
    description: 'Pharmaceuticals, drugs and medicines',
    priority: true,
  },
  {
    code: 'M150',
    description: 'Phenols and phenol compounds including chlorophenols',
  },
  {
    code: 'D360',
    description: 'Phosphorus compounds, other than mineral phosphates',
  },
  { code: 'M170', description: 'Polychlorinated dibenzo-furan (any congener)' },
  { code: 'M180', description: 'Polychlorinated dibenzo-p-dioxin (any congener)' },
  {
    code: 'N205',
    description: 'Residues from industrial waste treatment/disposal operations',
  },
  { code: 'D240', description: 'Selenium and selenium compounds' },
  {
    code: 'K130',
    description:
      'Sewage sludge and residues including nightsoil and septic tank sludge',
  },
  {
    code: 'M250',
    description:
      'Surface active agents (surfactants) containing principally organic constituents, whether or not also containing metals and other inorganic materials',
  },
  {
    code: 'K140',
    description:
      'Tannery wastes, including leather dust, ash, sludges and flours',
  },
  {
    code: 'J160',
    description:
      'Tarry residues arising from refining, distillation, and any pyrolytic treatment',
  },
  { code: 'D250', description: 'Tellurium and tellurium compounds' },
  { code: 'D180', description: 'Thallium and thallium compounds' },
  { code: 'M230', description: 'Triethylamine catalysts for setting foundry sands' },
  { code: 'T140', description: 'Tyres' },
  { code: 'D270', description: 'Vanadium compounds' },
  {
    code: 'E100',
    description: 'Waste containing peroxides other than hydrogen peroxide',
  },
  {
    code: 'A110',
    description:
      'Waste from heat treatment and tempering operations that uses cyanides',
  },
  {
    code: 'A100',
    description: 'Waste from surface treatment of metals and plastics',
  },
  // The six sub-rows of "Waste from the manufacture, formulation or use of —".
  // The parent text is repeated into each so a picker entry stands alone.
  {
    code: 'H100',
    description:
      'Waste from the manufacture, formulation or use of biocides and phytopharmaceuticals',
  },
  {
    code: 'F100',
    description:
      'Waste from the manufacture, formulation or use of inks, dyes, pigments, paints, lacquers and varnish',
  },
  {
    code: 'G160',
    description:
      'Waste from the manufacture, formulation or use of organic solvents',
  },
  {
    code: 'T120',
    description:
      'Waste from the manufacture, formulation or use of photographic chemicals or processing materials',
  },
  {
    code: 'F110',
    description:
      'Waste from the manufacture, formulation or use of resins, latex, plasticisers, glues and adhesives',
  },
  {
    code: 'H170',
    description:
      'Waste from the manufacture, formulation or use of wood-preserving chemicals',
  },
  {
    code: 'R140',
    description:
      'Waste from the production and preparation of pharmaceutical products',
  },
  {
    code: 'E120',
    description:
      'Waste of an explosive nature other than an explosive within the meaning of the Explosives Act 1999',
  },
  { code: 'K190', description: 'Wool scouring wastes' },
  { code: 'D230', description: 'Zinc compounds' },
]

/**
 * Asbestos — the common case for this business. Contaminated soil takes the
 * code of its CONTAMINANT, never a soil code; there is no soil code in
 * Appendix A.
 */
export const ASBESTOS_WASTE_CODE = 'N220'

const WASTE_CODE_MAP = new Map(WASTE_CODES.map((w) => [w.code, w]))

export function findWasteCode(code: string): WasteCode | undefined {
  return WASTE_CODE_MAP.get(code.trim().toUpperCase())
}

export function isValidWasteCode(code: string): boolean {
  return WASTE_CODE_MAP.has(code.trim().toUpperCase())
}

// ─── Appendix B — disposal and treatment codes ───────────────────────────────

export interface DisposalCode {
  code: string
  description: string
  /**
   * Table 1 (disposal): "Operations which do not lead to the possibility of
   * resource recovery, recycling, reclamation, direct re-use or alternative
   * uses." Table 2 (treatment): "Operations which may lead to resource
   * recovery, recycling, reclamation, direct re-use or alternative uses."
   */
  kind: 'disposal' | 'treatment'
}

/**
 * Appendix B Table 1 — 11 disposal codes. The gaps (D3, D5, D6, D7, D11) are in
 * the source table, not an extraction loss.
 */
export const DISPOSAL_CODES: readonly DisposalCode[] = [
  { code: 'D1', description: 'Disposal to a landfill', kind: 'disposal' },
  { code: 'D2', description: 'Land farming', kind: 'disposal' },
  { code: 'D4', description: 'Surface impoundment', kind: 'disposal' },
  {
    code: 'D8',
    description:
      'Biological treatment in a way not otherwise mentioned in this table',
    kind: 'disposal',
  },
  {
    code: 'D9A',
    description: 'Immobilisation or solidification',
    kind: 'disposal',
  },
  {
    code: 'D9B',
    description:
      'Physio-chemical treatment other than immobilisation of solidification',
    kind: 'disposal',
  },
  { code: 'D10', description: 'Incineration', kind: 'disposal' },
  { code: 'D12', description: 'Permanent storage', kind: 'disposal' },
  {
    code: 'D13',
    description:
      'Blending or mixing before disposal in another way mentioned in this table',
    kind: 'disposal',
  },
  {
    code: 'D14',
    description:
      'Repackaging before disposal in another way mentioned in this table',
    kind: 'disposal',
  },
  {
    code: 'D15',
    description:
      'Storage before disposal in another way mentioned in this table',
    kind: 'disposal',
  },
]

/**
 * Appendix B Table 2 — 12 treatment codes. The gaps (R10, R12) are in the
 * source table. R2–R5 and R6–R8 are bullet sub-rows of two parent phrases; the
 * parent text is folded into each description so an entry stands alone.
 */
export const TREATMENT_CODES: readonly DisposalCode[] = [
  {
    code: 'R1',
    description: 'Using waste as a fuel, other than by direct incineration',
    kind: 'treatment',
  },
  {
    code: 'R2',
    description:
      'Recycling or reclaiming an organic substance used as a solvent (other than a substance mentioned in items R6 to R8)',
    kind: 'treatment',
  },
  {
    code: 'R3',
    description:
      'Recycling or reclaiming an organic substance not used as a solvent (other than a substance mentioned in items R6 to R8)',
    kind: 'treatment',
  },
  {
    code: 'R4',
    description:
      'Recycling or reclaiming a metal or metal compound other than a drum (other than a substance mentioned in items R6 to R8)',
    kind: 'treatment',
  },
  {
    code: 'R5',
    description:
      'Recycling or reclaiming an inorganic substance other than a metal or metal compound (other than a substance mentioned in items R6 to R8)',
    kind: 'treatment',
  },
  {
    code: 'R6',
    description: 'Recycling or reclaiming an acid or base',
    kind: 'treatment',
  },
  {
    code: 'R7',
    description:
      'Recycling or reclaiming a component used for pollution abatement',
    kind: 'treatment',
  },
  {
    code: 'R8',
    description: 'Recycling or reclaiming a component from a catalyst',
    kind: 'treatment',
  },
  {
    code: 'R9',
    description: 'Refining used oil or otherwise using previously used oil',
    kind: 'treatment',
  },
  {
    code: 'R11',
    description:
      'Using a residual trackable waste obtained from treatment in another way mentioned in this table',
    kind: 'treatment',
  },
  {
    code: 'R13',
    description:
      'Storage before treatment in another way mentioned in this table',
    kind: 'treatment',
  },
  {
    code: 'R14',
    description: 'Recycling, reconditioning or laundering of drums',
    kind: 'treatment',
  },
]

/** Field 48 accepts either table. */
export const ALL_DISPOSAL_CODES: readonly DisposalCode[] = [
  ...DISPOSAL_CODES,
  ...TREATMENT_CODES,
]

const DISPOSAL_CODE_MAP = new Map(ALL_DISPOSAL_CODES.map((d) => [d.code, d]))

export function findDisposalCode(code: string): DisposalCode | undefined {
  return DISPOSAL_CODE_MAP.get(code.trim().toUpperCase())
}

export function isValidDisposalCode(code: string): boolean {
  return DISPOSAL_CODE_MAP.has(code.trim().toUpperCase())
}
