// Shape of the waste_link_view() payload (migration 0055).
//
// The RPC is anon-callable and the token IS the credential, so it returns only
// what the party holding the printed docket is entitled to see for this one
// movement — never another load, never the other party's contact details.

export interface WasteLinkGenerator {
  name: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  postcode: string | null
  collection_date: string | null
}

export interface WasteLinkWaste {
  code: string | null
  physical_nature: string | null
  amount: number | string | null
  unit: string | null
  description: string | null
}

export interface WasteLinkDangerousGoods {
  un_class: string | null
  un_number: string | null
  subsidiary_risk: string | null
  packaging_count: string | null
  packaging_type: string | null
  packing_group: string | null
}

export interface WasteLinkTransporter {
  name: string | null
  ea_number: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  postcode: string | null
  contact_name: string | null
  contact_number: string | null
  collection_date: string | null
  vehicle1_plate: string | null
  vehicle1_type: string | null
  vehicle2_plate: string | null
  vehicle2_type: string | null
  discrepancy: string | null
}

export interface WasteLinkReceiver {
  name: string | null
  ea_number: string | null
  suburb: string | null
  received_date: string | null
  disposal_code: string | null
  physical_nature: string | null
  waste_code: string | null
  amount: number | string | null
  unit: string | null
  discrepancy: string | null
}

export interface WasteLinkView {
  kind: 'waste_transporter' | 'waste_receiver'
  load_seq: number
  lodged: boolean
  submitted_at: string | null
  submitted_by: string | null
  generator: WasteLinkGenerator
  waste: WasteLinkWaste
  dangerous_goods: WasteLinkDangerousGoods | null
  transporter: WasteLinkTransporter
  receiver: WasteLinkReceiver
}

/** Load number as printed on the docket — the NNNNNNN of the BUDF identifier. */
export function formatLoadNumber(loadSeq: number): string {
  return String(loadSeq).padStart(7, '0')
}
