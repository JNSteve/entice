// Shared between the server page (param validation) and the client report
// component (tab rendering). Must NOT live in a 'use client' module: plain
// values imported across the server→client boundary become proxy stubs.
export const PERIOD_TABS = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-quarter', label: 'This quarter' },
  { value: 'all', label: 'All time' },
] as const

export type PeriodKey = (typeof PERIOD_TABS)[number]['value']
