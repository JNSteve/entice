-- 0036_prestart_meeting.sql
-- Adds the 'prestart_meeting' WHS form kind: a crew DAILY PRE-START MEETING
-- (briefing + crew sign-on) — a sibling to 'toolbox'. Deliberately DISTINCT from
-- the existing plant/machine 'prestart' kind (which is bound to a plant item and
-- collects no attendance). Mirrors the 0020 'audit' pattern for the kind checks,
-- then seeds a system "Daily Pre-Start Meeting" template with requires_signon=true.

------------------------------------------------------------------------------
-- 1. Allow the new kind on both forms-engine tables
------------------------------------------------------------------------------

alter table form_templates drop constraint form_templates_kind_check;
alter table form_templates add constraint form_templates_kind_check
  check (kind in ('prestart','take5','toolbox','induction','incident','custom','audit','prestart_meeting'));

alter table form_submissions drop constraint form_submissions_kind_check;
alter table form_submissions add constraint form_submissions_kind_check
  check (kind in ('prestart','take5','toolbox','induction','incident','custom','audit','prestart_meeting'));

------------------------------------------------------------------------------
-- 2. System Daily Pre-Start Meeting template (a default, not demo data).
--    requires_signon=true so it collects the day's crew sign-on (in-app + QR),
--    exactly like the Toolbox Talk template. Fields are a starting point — an
--    admin can tailor them to ECR's SMS pre-start form in Settings → WHS Forms.
------------------------------------------------------------------------------

insert into form_templates (id, kind, name, description, schema, version, active, requires_signon) values
  ('fa000000-0000-4000-a000-0000000000a1', 'prestart_meeting', 'Daily Pre-Start Meeting',
   'Daily crew pre-start held before work begins. Record the briefing, then collect crew sign-on for the day.',
   '[
     {"key":"weather","label":"Weather / site conditions","type":"text","required":false},
     {"key":"work_planned","label":"Work planned today","type":"textarea","required":true},
     {"key":"key_hazards","label":"Key hazards today","type":"textarea","required":true},
     {"key":"controls","label":"Controls in place","type":"textarea","required":true},
     {"key":"swms_referenced","label":"SWMS / SDS referenced today","type":"text","required":false},
     {"key":"permits","label":"Permits in place (asbestos removal control plan, hot work, confined space)","type":"text","required":false},
     {"key":"plant_equipment","label":"Plant & equipment in use today","type":"textarea","required":false},
     {"key":"emergency_confirmed","label":"Emergency arrangements confirmed (assembly point, first aider, spill kit)","type":"checkbox","required":true},
     {"key":"matters_raised","label":"Matters raised by crew","type":"textarea","required":false},
     {"key":"conducted_by","label":"Conducted by","type":"text","required":true}
   ]'::jsonb, 1, true, true)
on conflict (id) do nothing;
