# QLD regulated waste tracking — design

Built against **DETSI "Waste Tracking — Bulk Upload Data File Specification",
ESR/2023/6563 version 2.01, last reviewed 25 January 2023**. Keep that version
string visible in the code so a future reader knows what this was built against.

Prescribed information: Schedule 12, Environmental Protection Regulation 2019.
Trackable wastes: Schedule 11. Asbestos is **N220** and is the common case here;
contaminated soil takes the code of its **contaminant**, never a soil code.

## 1. Provenance

Every field name, length, format, code and value in this design was extracted
from the specification PDF, not transcribed from a summary.

- The 55-field movement record comes from §2.4.3, in the order the spec lists it.
- Appendix A yields **70 waste codes** (the handover brief said 67). Six of them
  — H100, F100, G160, T120, F110, H170 — are sub-rows of *"Waste from the
  manufacture, formulation or use of —"* whose code cells render offset from
  their description in linear text extraction. They were paired by table-row
  y-coordinate to confirm the mapping.
- Appendix B yields **11 disposal codes** (D1, D2, D4, D8, D9A, D9B, D10, D12,
  D13, D14, D15) and **12 treatment codes** (R1–R9, R11, R13, R14) — 23 in all.
  The gaps are in the source; they are not extraction loss. R2–R8 are bullet
  sub-rows and were pairing-verified the same way.
- Both appendices carry the note "These codes are subject to change by the
  department" (§2.1). Re-check before go-live.

### Corrections to the handover brief

| Brief said | Specification says |
|---|---|
| 67 waste codes | **70** |
| Transporter postcode ambiguous — verify before relying on field order | **Not ambiguous.** Field 29, Number, size 4, format `NNNN`, null not allowed |
| (not covered) | The monthly file contains movements **disposed of** in that calendar month (§2.4) — not collected in it |

## 2. Scope and stages

1. **Migration** — master data extensions, the movement record, party handoff links.
2. **Codes and export library** — `qld-codes.ts`, `budf.ts`, unit tests.
3. **Field capture** — regulated movement form, alongside the existing general waste form.
4. **Office register** — list, month filter, 7-day countdown, WTC reference, mark lodged, export.

The existing general waste load flow (`waste_loads`) is left untouched. Volumes
and dockets are a separate, simpler need.

## 3. The movement record — §2.4.3 field order

`Null` is the specification's "Null allowed" column. `Captured` is when this
build knows the value.

| # | Field | Type | Max | Null | Format | Captured |
|---|---|---|---|---|---|---|
| 1 | Submitters Company Name | String | — | No | `X` | `settings.company_name` |
| 2 | Unique Identifier | String | 10 | No | `X(10)` | `AAA` + 7-digit load seq |
| 3 | Generator Name | String | 60 | No | `X[60]` | capture |
| 4 | Generator ABN/ACN | Number | 11 | Yes | `N(11)` | capture |
| 5 | Generator Street Number | String | 20 | No | `X[20]` | capture |
| 6 | Generator Street Name | String | 40 | No | `X[40]` | capture |
| 7 | Generator Suburb | String | 25 | No | `A[25]` | capture |
| 8 | Generator Postcode | Number | 4 | No | `NNNN` | capture |
| 9 | Generator Contact Name | String | 50 | No | `X[50]` | capture |
| 10 | Generator Contact Number | Number | 10 | No | `N(10)` | capture |
| 11 | Generator Collection Date | Number | 10 | No | `DD-MM-YYYY` | capture |
| 12 | Local Government Area | String | 50 | Yes | `A[50]` | capture |
| 13 | Generator Waste Physical Nature | String | 1 | No | `A` | capture — L/S/M/P |
| 14 | Generator Waste Code | String | 4 | No | `ANNN` | capture — Appendix A |
| 15 | Generator Waste Amount | Number | 10 | No | `N.[NN]` | capture |
| 16 | Generator Waste Volumetric Type | String | 2 | No | `A{XXX}` | capture — kg/L/m3/Each/IBC |
| 17 | Dangerous Goods U.N Class | Number | 2 | Yes | `N[NN]` | capture |
| 18 | Dangerous Goods Number | Number | 4 | Yes | `N[NNNN]` | capture |
| 19 | Dangerous Goods Subsidiary Risk | Number | 2 | Yes | `N[NN]` | capture |
| 20 | Dangerous Goods Bulk/No of Packaging | Number | 5 | Yes | `N[NNNNN]` | capture |
| 21 | Dangerous Goods Type of Packaging | String | 20 | Yes | `X[20]` | capture |
| 22 | Dangerous Goods Packaging Group | String | 1 | Yes | `X` | capture — I/II/III |
| 23 | Waste Transporter Name | String | 60 | No | `X[60]` | capture |
| 24 | Waste Transporter Contact Name | String | 50 | No | `[X(50)]` | capture |
| 25 | Waste Transporter Contact Number | Number | 10 | No | `N(10)` | capture |
| 26 | Transporter Street Number | String | 20 | No | `X[20]` | capture |
| 27 | Waste Transporter Street Name | String | 40 | No | `X[40]` | capture |
| 28 | Waste Transporter Suburb | String | 25 | No | `X[25]` | capture |
| 29 | Transporter Postcode | Number | 4 | No | `NNNN` | capture |
| 30 | Waste Transporter ABN/ACN | Number | 11 | Yes | `N(9){NN}` | capture |
| 31 | Waste Transporter Environmental Authority | String | 50 | No | `X[50]` | capture — **blocks the load if absent** |
| 32 | Waste Transporters Collection Date | Number | 10 | No | `DD-MM-YYYY` | Part 2 |
| 33 | Transporter Vehicle 1 number plate | String | 7 | No | `X[7]` | Part 2 |
| 34 | Transporter Vehicle 1 Type | String | 1 | No | `A` | Part 2 — V/T |
| 35 | Transporter Vehicle 2 number plate | String | 7 | No | `X[7]` | Part 2 — see V-5 |
| 36 | Transporter Vehicle 2 Type | String | 1 | No | `A` | Part 2 — see V-5 |
| 37 | Transporter Discrepancy | String | 225 | Yes | `X[225]` | Part 2 |
| 38 | Waste Receiver Environmental Authority | String | 15 | Yes | `X[15]` | capture |
| 39 | Waste Receiver Name | String | 50 | No | `X[50]` | capture |
| 40 | Waste Receiver Contact Name | String | 50 | No | `X[50]` | capture |
| 41 | Waste Receiver Contact Number | Number | 10 | No | `N[10]` | capture |
| 42 | Waste Receiver Street Number | String | 20 | No | `X[20]` | capture |
| 43 | Waste Receiver Street Name | String | 40 | No | `X[40]` | capture |
| 44 | Waste Receiver Suburb | String | 25 | No | `X[25]` | capture |
| 45 | Receiver Postcode | Number | 4 | No | `NNNN` | capture |
| 46 | Waste Receiver ABN/ACN | Number | 11 | Yes | `N(9){NN}` | capture |
| 47 | Receiver Waste Received Date | Number | 10 | No | `DD-MM-YYYY` | Part 3 |
| 48 | Waste Disposal or Treatment Type | String | 10 | *(blank)* | `X[10]` | Part 3 — Appendix B, see V-4 |
| 49 | Receiver Waste Physical Nature | String | 1 | No | `A` | Part 3 — L/S/M/P |
| 50 | Receiver Waste Code | String | 4 | No | `ANNN` | Part 3 — Appendix A |
| 51 | Receiver Waste Volume | Number | 10 | No | `N.{NN}` | Part 3 |
| 52 | Receiver Waste Volume Measurement Unit | String | 2 | No | `A{XXX}` | Part 3 |
| 53 | Receiver Discrepancy | String | 255 | Yes | `X[225]` | Part 3 — see V-3 |
| 54 | Waste Description | String | 255 | Yes | `X[225]` | capture — see V-3 |
| 55 | Consignment Authorisation | String | 255 | Yes | `X[225]` | capture — see V-3 |

**Footer** (§2.4.4): one field, Total record count, Number, max 10, `N[N(9)]`,
null not allowed. Counts movement records only — **excludes header and footer**.

## 4. `[VERIFY]` register

Where the specification contradicts itself or omits a value, the implementation
carries a `[VERIFY]` marker rather than a guess. Resolve with DETSI
(waste.track@des.qld.gov.au, 07 3330 5677) before first lodgement.

| id | Field | The contradiction | Build behaviour |
|---|---|---|---|
| **V-1** | 16, 52 Volumetric Type / Measurement Unit | Max size **2**, but the permitted values include `Each` (4 chars) and `IBC` (3). Format `A{XXX}` allows 1 or 4 characters — which admits neither `IBC` nor `kg` cleanly | Accept `kg`, `L`, `m3`, `Each`, `IBC`; do not enforce the size-2 limit; flag |
| **V-2** | 22 DG Packaging Group | Max size **1**, but the permitted values are `I`, `II`, `III` | Accept all three; do not enforce size 1; flag |
| **V-3** | 53, 54, 55 | Max size column says **255**, format column says `X[225]` | Validate at **225** (the tighter of the two); flag |
| **V-4** | 48 Disposal or Treatment Type | The "Null allowed" cell is **blank** — the only row in the table where it is | Treated as **required** — it is the substance of Part 3; flag |
| **V-5** | 35, 36 Vehicle 2 | Both marked null **not** allowed, but a rigid tipper with no trailer has no second vehicle | Optional in capture and export; a record without Vehicle 2 still validates; flag on the register |
| **V-6** | Header record | §2.4.2: "The header file has already been populated in the form provided" — the spec does not state its contents | Emit a clearly-marked placeholder line; the export flags it and it must be replaced from the department's own template |
| **V-7** | 2 Unique Identifier | The `AAA` prefix must be allocated by DETSI | Null until allocated; the export refuses to run without it |
| **V-8** | 4 vs 30, 46 ABN/ACN | All three are described as "ABN or ACN", but field 4 is formatted `N(11)` while 30 and 46 are `N(9){NN}`. An ACN is 9 digits, so field 4's format admits no ACN at all | Accept 9 or 11 digits on all three, as the descriptions intend; flag |

## 5. Decisions

**D-1 Generator identity.** Per-movement choice, defaulting to the client.
The form asks who generated this waste: the **client** (name and ABN from
`clients`, address from `sites`) or **ECR** (name and ABN from `settings`,
address still the site). `generator_kind` is stored alongside the snapshot, so
the record shows who was decided to be the generator, not just a name. Never
the agent lodging on their behalf. ECR does the removal work and is frequently
the actual generator; as a subcontractor to a builder it frequently is not.

**D-2 Transporters live in `vendors`.** A transporter is a trading account, so
this extends the existing register rather than contradicting migration 0031's
rationale for keeping `env_facilities` separate ("a licensed place, not a
trading account"). `vendors` gains depot address columns; the EA number rides
`vendor_compliance_docs` as a new `environmental_authority` kind — reference
holds the number, `expiry_date` its expiry. That inherits the existing 30-day
traffic light, the register column and the add/edit dialogs already built.

**D-3 Receivers stay in `env_facilities`**, extended with ABN, physical
address and contacts. The existing `licence_no` **is** the receiver
environmental authority (field 38); it already carries `licence_expiry` for the
traffic light, and a second `ea_number` column would be a competing source of
truth.

**D-4 Load numbers from a dedicated Postgres sequence**, not the repo's
`sequences` table. `next_number()` is an `UPDATE … RETURNING`, so a rolled-back
insert hands the same number out again; `nextval()` is non-transactional and
never does. `maxvalue 9999999 no cycle` makes exhaustion an error rather than a
repeat, and the column carries a `unique` constraint. Field 2 must never repeat
across any submission, ever.

**D-5 Snapshot everything.** Generator, transporter and receiver details are
copied onto the movement at creation as well as referenced by id. A five-year
statutory record must show what was true on the day.

**D-6 Nullability follows what is actually known.** Non-null at capture:
generator block, waste block, transporter identity and EA, receiver identity.
Null until the party reports: Parts 2 and 3. The database stays permissive
enough to record reality; **the export is what refuses a non-conforming file.**

**D-7 No delete path.** RLS carries no delete policy. A `before update` trigger
rejects any change to `load_seq`, and freezes the statutory fields once
`lodged_at` is set — only `wtc_reference` and `notes` stay editable after that.

**D-8 Permit usage unions both tables, converting kg→t only.** Movements carry
`permit_id`; `permitUsage()` sums `waste_loads` plus movements. kg→t is exact
arithmetic (÷1000), so it converts; L and m³ never convert to tonnes, and m³
matches m³ directly. This honours the rationale behind migration 0031's locked
decision — it bans **density** assumptions, not unit arithmetic.

**D-9 The month is the disposal month.** §2.4: the file contains movements
"where the waste was disposed of within the calendar month that the file is
required for". Filter on field 47, the received date — not the collection date.
The `YYYYMMDD` in the filename is separately the date the file was *generated*
(§2.4.1).

**D-10 BUDF gets its own CSV escaper.** The repo's `csvField` in
`src/lib/csv.ts` quotes on comma, double-quote and newline, but §2.2(g) also
requires quoting fields with **leading or trailing spaces**. Reusing the generic
helper would silently emit a non-conforming file. Line endings are CRLF; §2.2(a)
permits LF or CRLF.

## 6. Party handoff — Parts 2 and 3

Reuses the established `share_links` + token + security-definer anon RPC
pattern that already drives `/sign`, `/submit` and `/portal`.

`share_links` gains `movement_id` and two kinds, `waste_transporter` and
`waste_receiver`. Two role-scoped tokens per movement, so neither party can edit
the other's part or see more than the docket they are holding:

- **`/haul/[token]`** — driver: collection date, vehicle 1 and 2 plates and
  types, discrepancy, plus confirmation of their own EA number, depot address
  and contact.
- **`/receive/[token]`** — weighbridge: received date, disposal or treatment
  code, physical nature, waste code, amount and unit, discrepancy.

Field capture prints a consignment docket PDF carrying the load number, the
waste block and both QR codes. Office can copy or email the links too.

**D-11 Lock on submit, office can reopen.** The RPC refuses a second submission.
The part is frozen with a submitted-at timestamp and the declared submitter's
name. Office reopening is recorded. A docket left on a weighbridge desk must not
silently rewrite the record.

**D-12 Transporter confirmations flag, never overwrite.** Corrected EA numbers,
addresses and contacts snapshot onto the movement and raise a review flag on the
office register. They do not write to `vendors` — master data behind a statutory
record must not be editable by anyone holding a printed docket. This still
solves the cold start, where a carrier with no EA number on file blocks every load.

**D-13 The QR is never the only path.** Office can key both parts in from the
register. Weighbridges lose signal.

**D-14 Agent agreements are recorded.** Bulk upload lodges all three parts under
ECR's identifier, which makes ECR the **agent** for the transporter and receiver.
Each holds its own statutory duty and the Regulation requires the agreement be
produced to the department on request. `vendors` and `env_facilities` each gain
an agreement flag and date, with the signed copy as an attachment. The export
**warns** when a movement's transporter or receiver has no agreement on file; it
does not block.

## 7. Export rules

`GET /api/waste/budf?month=YYYY-MM` produces `BUDF_AAA_YYYYMMDD.csv`.

The export **refuses to emit a file containing incomplete records** and reports
exactly what is missing, per record and per field. The department rejects a
non-conforming file in full, so a partial file is worse than none. It also
refuses when the `AAA` identifier is unallocated (V-7).

Structure: one placeholder header record (V-6), one movement record per load in
§2.4.3 field order, one footer record carrying the movement count only.

## 8. Testing

Unit tests over the pure export library: escaping (embedded commas, embedded
double-quotes doubled, embedded line breaks, leading and trailing spaces), the
`AAANNNNNNN` identifier, `DD-MM-YYYY` dates, file naming, footer count excluding
header and footer, and per-record validation including every `[VERIFY]` case.
Then a live run against real rows, and clean-up of the test rows afterwards.

## 9. Before first real lodgement

- [ ] DETSI bulk upload approval and an allocated 3-letter identifier
- [ ] Replace the placeholder header row from the department's template (V-6)
- [ ] Resolve V-1 to V-5 with DETSI
- [ ] Re-confirm Appendix A and B codes are current (§2.1)
- [ ] Agent agreements in place with each transporter and receiving facility (D-14)
