'use client'

import React, { useState } from 'react'
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PhoneIcon,
} from 'lucide-react'
import { RISK_LEVEL_LABELS, type RiskLevel } from '@/lib/zod'
import {
  HRCW_ANSWER_LABELS,
  SWMS_EMERGENCY_CONTACT_LABELS,
  SWMS_PROJECT_DETAIL_LABELS,
  SWMS_REQUIREMENT_LABELS,
  hasAnyValue,
  type HrcwAnswer,
  type SwmsEmergencyContacts,
  type SwmsProjectDetails,
  type SwmsStructure,
} from '@/lib/swms'

// ─── Risk chips ──────────────────────────────────────────────────────────────

const RISK_CHIP: Record<RiskLevel, string> = {
  H: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  M: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  L: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
}

function RiskChip({ level, label }: { level: RiskLevel; label: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RISK_CHIP[level] ?? RISK_CHIP.M}`}
    >
      {label}: {RISK_LEVEL_LABELS[level] ?? level}
    </span>
  )
}

const ANSWER_CHIP: Record<HrcwAnswer, string> = {
  yes: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  no: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
  na: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500',
}

// ─── Collapsible section ─────────────────────────────────────────────────────

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 text-left"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {open ? (
          <ChevronUpIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && children}
    </section>
  )
}

function LabelValueList({
  labels,
  values,
}: {
  labels: Record<string, string>
  values: Record<string, string>
}) {
  const rows = Object.entries(labels).filter(([key]) => values[key]?.trim())
  if (rows.length === 0) return null
  return (
    <dl className="flex flex-col divide-y rounded-xl border">
      {rows.map(([key, label]) => (
        <div key={key} className="flex flex-col gap-0.5 px-4 py-2.5">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </dt>
          <dd className="text-sm">{values[key]}</dd>
        </div>
      ))}
    </dl>
  )
}

// ─── Full view ───────────────────────────────────────────────────────────────

/**
 * Renders the complete SWMS structure mobile-first: collapsible sections,
 * work steps as stacked cards, prominent stop-work triggers and the emergency
 * block. Used by the field SWMS page and the external /sign read-through —
 * the crew must be able to read the whole document before signing.
 */
export function SwmsFullView({ structure }: { structure: SwmsStructure }) {
  const {
    docControl,
    projectDetails,
    hrcwItems,
    hrcwAnswers,
    requirements,
    steps,
    stopWorkTriggers,
    emergencyScenarios,
    emergencyContacts,
    referencesList,
  } = structure

  const hasDocControl =
    docControl.prepared_by.trim() !== '' ||
    docControl.approved_by.trim() !== '' ||
    docControl.scope_note.trim() !== ''
  const hasRequirements = hasAnyValue(requirements)
  const hasEmergency =
    hasAnyValue(emergencyContacts) || emergencyScenarios.length > 0

  return (
    <div className="flex flex-col gap-5">
      {/* Scope & document control */}
      {hasDocControl && (
        <Section title="Scope & document control">
          <div className="flex flex-col gap-2">
            {docControl.scope_note.trim() !== '' && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {docControl.scope_note}
              </p>
            )}
            {(docControl.prepared_by.trim() !== '' ||
              docControl.approved_by.trim() !== '') && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                {docControl.prepared_by.trim() !== '' && (
                  <span>
                    Prepared by:{' '}
                    <span className="font-medium text-foreground">
                      {docControl.prepared_by}
                    </span>
                  </span>
                )}
                {docControl.approved_by.trim() !== '' && (
                  <span>
                    Approved by:{' '}
                    <span className="font-medium text-foreground">
                      {docControl.approved_by}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Project-specific details */}
      {hasAnyValue(projectDetails as SwmsProjectDetails) && (
        <Section title="Project details">
          <LabelValueList
            labels={SWMS_PROJECT_DETAIL_LABELS}
            values={projectDetails}
          />
        </Section>
      )}

      {/* HRCW checklist */}
      {hrcwItems.length > 0 && (
        <Section title="High-risk construction work">
          <ul className="flex flex-col divide-y rounded-xl border">
            {hrcwItems.map((item) => {
              const answer = hrcwAnswers[item.id]
              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="flex-1 text-sm">{item.label}</span>
                  {answer ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ANSWER_CHIP[answer]}`}
                    >
                      {HRCW_ANSWER_LABELS[answer]}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* Minimum requirements */}
      {hasRequirements && (
        <Section title="Before you start">
          <LabelValueList
            labels={SWMS_REQUIREMENT_LABELS}
            values={requirements}
          />
        </Section>
      )}

      {/* Work steps */}
      <Section title="Work steps, hazards & controls">
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work steps.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl border p-4">
                <p className="text-sm font-semibold">
                  {i + 1}. {s.step}
                </p>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Key hazards
                  </p>
                  <p className="text-sm">{s.hazards}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RiskChip level={s.initial_risk} label="Initial" />
                  <RiskChip level={s.residual_risk} label="Residual" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Required controls
                  </p>
                  <p className="text-sm">{s.controls}</p>
                </div>
                {s.responsible.trim() !== '' && (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Responsible / evidence
                    </p>
                    <p className="text-sm">{s.responsible}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Stop-work triggers */}
      {stopWorkTriggers.length > 0 && (
        <Section title="Stop work immediately if">
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
            <ul className="flex flex-col gap-2">
              {stopWorkTriggers.map((trigger, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                  <span>{trigger}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* Emergency */}
      {hasEmergency && (
        <Section title="Emergency response">
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-sm font-medium">
              <PhoneIcon className="size-4 shrink-0" />
              Emergency services: 000 (or 112 from a mobile)
            </p>
            {hasAnyValue(emergencyContacts as SwmsEmergencyContacts) && (
              <LabelValueList
                labels={SWMS_EMERGENCY_CONTACT_LABELS}
                values={emergencyContacts}
              />
            )}
            {emergencyScenarios.length > 0 && (
              <div className="flex flex-col gap-3">
                {emergencyScenarios.map((s, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-xl border p-4">
                    <p className="text-sm font-semibold">{s.scenario}</p>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Immediate action
                      </p>
                      <p className="text-sm">{s.immediate_action}</p>
                    </div>
                    {s.notification.trim() !== '' && (
                      <div className="flex flex-col gap-0.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Notification / follow-up
                        </p>
                        <p className="text-sm">{s.notification}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* References */}
      {referencesList.length > 0 && (
        <Section title="References" defaultOpen={false}>
          <ul className="flex flex-col gap-1.5 rounded-xl border p-4">
            {referencesList.map((ref, i) => (
              <li key={i} className="text-sm text-muted-foreground">
                {ref}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
