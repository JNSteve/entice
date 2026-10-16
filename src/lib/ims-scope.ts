/**
 * What the portal shows for the certified ECR IMS Rev 1 (ISO 9001/14001/45001,
 * Stage 2 passed 01/10/2026). The portal's V1 IMS modules were built for a
 * bigger system than the one certified; these screens are hidden for ECR, not
 * deleted — the code and any records stay (portal brief 2026-10-07, section 7).
 *
 * Flip a flag back to `false` to show a module again.
 */
export const IMS_HIDDEN = {
  /** ITP templates, lots, inspections, lab results — replaced by the one-page IMS-F-02 hold point checklist filed on the job. */
  itpLots: true,
  /** Scored aspects screen — the issued IMS-R-01 spreadsheet is the register (significance is Y/N, not L×S). */
  envAspects: true,
} as const
