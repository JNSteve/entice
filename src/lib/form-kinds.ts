import { FORM_TEMPLATE_KINDS, type FormTemplateKind } from '@/lib/zod'

/**
 * Display metadata for form template kinds, keyed off FORM_TEMPLATE_KINDS in
 * zod.ts (same pattern as COMPLIANCE_DOC_KIND_LABELS etc.). Adding a new kind
 * means extending the enum and these Records — the compiler flags every map
 * that misses it. FormPdf.tsx keeps its own deliberately formal long-form
 * labels ('Toolbox Talk', 'Incident Report', …).
 */

export const FORM_KIND_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Start',
  prestart_meeting: 'Pre-Start Meeting',
  take5: 'Take 5',
  toolbox: 'Toolbox',
  induction: 'Induction',
  incident: 'Incident',
  custom: 'Custom',
  audit: 'Audit',
}

/** Pluralised labels for filter tabs and counts. */
export const FORM_KIND_PLURAL_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Starts',
  prestart_meeting: 'Pre-Start Meetings',
  take5: 'Take 5s',
  toolbox: 'Toolbox',
  induction: 'Inductions',
  incident: 'Incidents',
  custom: 'Custom',
  audit: 'Audit',
}

/** Lowercase inline variants ("3 pre-start · 1 toolbox"). */
export const FORM_KIND_SHORT: Record<FormTemplateKind, string> = {
  prestart: 'pre-start',
  prestart_meeting: 'pre-start meeting',
  take5: 'take 5',
  toolbox: 'toolbox',
  induction: 'induction',
  incident: 'incident',
  custom: 'custom',
  audit: 'audit',
}

/** Badge classes shared by the office register, settings and project WHS tab. */
export const FORM_KIND_COLORS: Record<FormTemplateKind, string> = {
  prestart: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  prestart_meeting: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300',
  take5: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300',
  toolbox: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
  induction: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300',
  incident: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  custom: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300',
  audit: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
}

/** Display order — the enum declaration order is the intended order. */
export const FORM_KIND_ORDER: readonly FormTemplateKind[] = FORM_TEMPLATE_KINDS
