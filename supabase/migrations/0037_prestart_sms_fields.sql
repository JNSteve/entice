-- 0037_prestart_sms_fields.sql
-- Aligns the seeded "Daily Pre-Start Meeting" template (from 0036) to ECR's
-- controlled form SMS-F-11 "Pre-Start Meeting Record": briefing header, the
-- 8-item daily-checks table (Yes/No/N/A), comments/action refs, and issues
-- raised. The SMS "Attendance" table (Name/Company/Signature) is captured by
-- the built-in sign-on (requires_signon), and Project/site + Date come from the
-- submission itself, so they are not duplicated as fields.
--
-- Safe to replace the schema in place (version stays 1): the template has no
-- submissions yet, so there is no snapshotted data to preserve.

update form_templates set
  name = 'Daily Pre-Start Meeting',
  description = 'Daily crew pre-start meeting (ref SMS-F-11). Record the briefing and daily checks, then collect crew sign-on (Name / Company / Signature) for the day.',
  schema = '[
    {"key":"led_by","label":"Led by","type":"text","required":true},
    {"key":"weather","label":"Weather / site conditions","type":"text","required":false},
    {"key":"activities","label":"Today''s activities and areas of work","type":"textarea","required":true},
    {"key":"hazards_changed","label":"Hazards introduced or changed today (deliveries, plant movements, concurrent trades, occupant interfaces, weather)","type":"textarea","required":true},
    {"key":"chk_swms","label":"SWMS / ARCP for today''s work current and on site","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_permits","label":"Permits required today in place","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_plant","label":"Plant daily pre-start checks completed","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_enclosure","label":"Enclosure, NPU and decontamination checked (removal sites)","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_air_monitoring","label":"Air monitoring in place for today''s removal work","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_barriers","label":"Barriers, signage and exclusion zones in place","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_ppe","label":"PPE and RPE available and worn; fit checks done","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"chk_first_aider","label":"First aider on site; emergency plan unchanged","type":"select","options":["Yes","No","N/A"],"required":true},
    {"key":"comments","label":"Comments / action references","type":"textarea","required":false},
    {"key":"issues_raised","label":"Issues raised by workers and responses","type":"textarea","required":false}
  ]'::jsonb
where id = 'fa000000-0000-4000-a000-0000000000a1';
