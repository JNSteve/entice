// src/lib/xero/types.ts
/** Xero Accounting API shapes — ONLY the fields spec §3 allows us to read. */

export type XeroTracking = {
  TrackingCategoryID?: string
  TrackingOptionID?: string
  Name?: string
  Option?: string
}

export type XeroLineItem = {
  Description?: string
  Quantity?: number
  UnitAmount?: number
  AccountCode?: string
  TaxType?: string
  LineAmount?: number
  Tracking?: XeroTracking[]
}

export type XeroInvoice = {
  InvoiceID: string
  InvoiceNumber?: string
  Reference?: string
  Type: 'ACCREC' | 'ACCPAY'
  Status: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'PAID' | 'VOIDED' | 'DELETED'
  /** ISO local date "2026-09-05T00:00:00" — preferred over the /Date()/ form. */
  DateString?: string
  DueDateString?: string
  Date?: string
  DueDate?: string
  LineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax'
  Total?: number
  AmountDue?: number
  AmountPaid?: number
  AmountCredited?: number
  /** /Date(ms+0000)/ */
  FullyPaidOnDate?: string
  UpdatedDateUTC?: string
  Contact?: { ContactID: string; Name?: string }
  LineItems?: XeroLineItem[]
}

export type XeroPayment = {
  PaymentID: string
  Date?: string
  Amount?: number
  Reference?: string
  Status?: 'AUTHORISED' | 'DELETED'
  PaymentType?: string
  IsReconciled?: boolean
  UpdatedDateUTC?: string
  Invoice?: { InvoiceID: string; InvoiceNumber?: string }
}

export type XeroContact = {
  ContactID: string
  Name: string
  TaxNumber?: string
  EmailAddress?: string
  ContactStatus?: 'ACTIVE' | 'ARCHIVED' | 'GDPRREQUEST'
  UpdatedDateUTC?: string
}

export type XeroAccount = {
  AccountID: string
  Code?: string
  Name: string
  Type: string
  TaxType?: string
  Status?: 'ACTIVE' | 'ARCHIVED'
}

export type XeroTaxRate = {
  Name: string
  TaxType: string
  EffectiveRate?: number
  Status?: 'ACTIVE' | 'DELETED' | 'ARCHIVED'
  CanApplyToRevenue?: boolean
}

export type XeroTrackingOption = {
  TrackingOptionID: string
  Name: string
  Status?: 'ACTIVE' | 'ARCHIVED' | 'DELETED'
}

export type XeroTrackingCategory = {
  TrackingCategoryID: string
  Name: string
  Status?: 'ACTIVE' | 'ARCHIVED'
  Options?: XeroTrackingOption[]
}

/** settings.xero_* as read by the push/pull code. */
export type XeroMapping = {
  emailMode: 'xero' | 'ecr'
  defaultAccount: string | null
  accountByKind: Record<string, string>
  claimsAccount: string | null
  gstTaxType: string
  noGstTaxType: string
  trackingCategoryId: string | null
}

/** What buildInvoicePayload needs from ECR. */
export type EcrInvoiceForPush = {
  number: string
  issue_date: string
  due_date: string | null
  gst_rate: number
  payment_terms_days: number
  job_number: string | null
  job_title: string | null
  lines: { description: string; qty: number; unit_sell: number; kind: string | null }[]
}

export type EcrClaimForPush = {
  project_number: string
  project_name: string
  claim_number: number
  certified_amount: number
  reference_date: string
  payment_terms_days: number
}

export type XeroInvoicePayload = {
  Type: 'ACCREC'
  Contact: { ContactID: string }
  Date: string
  DueDate: string
  InvoiceNumber: string
  Reference: string
  Status: 'AUTHORISED'
  LineAmountTypes: 'Exclusive' | 'Inclusive'
  LineItems: {
    Description: string
    Quantity: number
    UnitAmount: number
    AccountCode: string
    TaxType: string
    Tracking?: { TrackingCategoryID: string; TrackingOptionID: string }[]
  }[]
}
