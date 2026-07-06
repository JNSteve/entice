-- 0030_swms_two.sql
-- SWMS 2.0: rebuild the SWMS document model around the anatomy of a real
-- professional SWMS (document control, HRCW trigger checklist, minimum
-- competency/PPE/equipment/monitoring, work-step risk table with H/M/L
-- initial/residual ratings, stop-work triggers, emergency response scenarios,
-- references) plus instance-level project-specific details captured at issue.
--
-- Shapes are documented and validated in src/lib/swms.ts (zod). Risk ratings
-- are practical H/M/L by design — NOT the risk register's 5×5 numerics; the
-- numeric matrix appears as static reference text in the PDF only.
--
-- Legacy data: existing templates/instances keep body + hazards untouched
-- (nothing dropped); their hazard rows are mapped into steps below.

------------------------------------------------------------------------------
-- 1. swms_templates: structured sections
------------------------------------------------------------------------------

alter table swms_templates
  add column doc_control jsonb not null default '{}'::jsonb,          -- {prepared_by, approved_by, scope_note}
  add column hrcw_items jsonb not null default '[]'::jsonb,           -- [{id, label, suggested}]
  add column requirements jsonb not null default '{}'::jsonb,         -- {competency, licences_permits, ppe, equipment, monitoring}
  add column steps jsonb not null default '[]'::jsonb,                -- [{step, hazards, initial_risk, controls, residual_risk, responsible}]
  add column stop_work_triggers jsonb not null default '[]'::jsonb,   -- [string]
  add column emergency_scenarios jsonb not null default '[]'::jsonb,  -- [{scenario, immediate_action, notification}]
  add column references_list jsonb not null default '[]'::jsonb,      -- [string]
  add constraint swms_templates_doc_control_object check (jsonb_typeof(doc_control) = 'object'),
  add constraint swms_templates_hrcw_items_array check (jsonb_typeof(hrcw_items) = 'array'),
  add constraint swms_templates_requirements_object check (jsonb_typeof(requirements) = 'object'),
  add constraint swms_templates_steps_array check (jsonb_typeof(steps) = 'array'),
  add constraint swms_templates_stop_work_array check (jsonb_typeof(stop_work_triggers) = 'array'),
  add constraint swms_templates_emergency_array check (jsonb_typeof(emergency_scenarios) = 'array'),
  add constraint swms_templates_references_array check (jsonb_typeof(references_list) = 'array');

------------------------------------------------------------------------------
-- 2. swms_instances: snapshot columns + project-specific sections
------------------------------------------------------------------------------

alter table swms_instances
  add column doc_control jsonb not null default '{}'::jsonb,
  add column hrcw_items jsonb not null default '[]'::jsonb,
  add column requirements jsonb not null default '{}'::jsonb,
  add column steps jsonb not null default '[]'::jsonb,
  add column stop_work_triggers jsonb not null default '[]'::jsonb,
  add column emergency_scenarios jsonb not null default '[]'::jsonb,
  add column references_list jsonb not null default '[]'::jsonb,
  add column project_details jsonb not null default '{}'::jsonb,      -- {work_location, work_dates, workers_roles, other_pcbus, client_contact, nearest_hospital, comms_arrangements, known_hazards_info, permits_required}
  add column hrcw_answers jsonb not null default '{}'::jsonb,         -- {[itemId]: 'yes'|'no'|'na'}
  add column emergency_contacts jsonb not null default '{}'::jsonb,   -- {coordinator, first_aid, assembly_point}
  add constraint swms_instances_doc_control_object check (jsonb_typeof(doc_control) = 'object'),
  add constraint swms_instances_hrcw_items_array check (jsonb_typeof(hrcw_items) = 'array'),
  add constraint swms_instances_requirements_object check (jsonb_typeof(requirements) = 'object'),
  add constraint swms_instances_steps_array check (jsonb_typeof(steps) = 'array'),
  add constraint swms_instances_stop_work_array check (jsonb_typeof(stop_work_triggers) = 'array'),
  add constraint swms_instances_emergency_array check (jsonb_typeof(emergency_scenarios) = 'array'),
  add constraint swms_instances_references_array check (jsonb_typeof(references_list) = 'array'),
  add constraint swms_instances_project_details_object check (jsonb_typeof(project_details) = 'object'),
  add constraint swms_instances_hrcw_answers_object check (jsonb_typeof(hrcw_answers) = 'object'),
  add constraint swms_instances_emergency_contacts_object check (jsonb_typeof(emergency_contacts) = 'object');

------------------------------------------------------------------------------
-- 3. Audit trigger: mark the new large jsonb payloads instead of diffing them
------------------------------------------------------------------------------

create or replace function audit_whs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_row jsonb;
  v_old jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_detail jsonb;
  v_entity uuid;
  k text;
begin
  select full_name into v_actor_name from profiles where id = v_actor;
  v_actor_name := coalesce(v_actor_name, 'system');

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    v_entity := old.id;
  else
    v_row := to_jsonb(new);
    v_entity := new.id;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    for k in select jsonb_object_keys(v_row) loop
      if v_old -> k is distinct from v_row -> k then
        if k = 'signature_data' then
          -- never store signature payloads in the log
          v_changed := v_changed || jsonb_build_object(k, '[signature changed]');
        elsif k in ('schema','hazards','data','body',
                    'doc_control','hrcw_items','requirements','steps',
                    'stop_work_triggers','emergency_scenarios','references_list',
                    'project_details','hrcw_answers','emergency_contacts') then
          -- large jsonb/text payloads: marker only
          v_changed := v_changed || jsonb_build_object(k, '[' || k || ' changed]');
        else
          v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_row -> k));
        end if;
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;  -- no effective change; skip the noise
    end if;
    v_detail := jsonb_build_object('changed', v_changed);
  else
    -- INSERT / DELETE: summary of identifying fields when present
    v_detail := jsonb_strip_nulls(jsonb_build_object(
      'title',  v_row ->> 'title',
      'name',   v_row ->> 'name',
      'status', v_row ->> 'status',
      'number', v_row ->> 'number',
      'kind',   v_row ->> 'kind',
      'label',  v_row ->> 'label'));
  end if;

  insert into audit_log (actor_id, actor_name, entity_type, entity_id, project_id, action, detail)
  values (v_actor, v_actor_name, tg_table_name, v_entity,
          nullif(v_row ->> 'project_id', '')::uuid, lower(tg_op), v_detail);
  return null;
end $$;

revoke execute on function audit_whs() from anon, authenticated, public;

------------------------------------------------------------------------------
-- 4. get_shared_doc: external sign-on read-through carries the full structure
------------------------------------------------------------------------------

create or replace function get_shared_doc(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l share_links%rowtype;
  v_doc jsonb;
  v_project_name text;
begin
  select * into l from share_links
   where token = p_token and active
     and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  if l.kind = 'signon' and l.swms_instance_id is not null then
    select jsonb_build_object(
             'type','swms',
             'title', s.title, 'body', s.body,
             'hazards', s.hazards, 'version', s.version,
             'doc_control', s.doc_control,
             'hrcw_items', s.hrcw_items,
             'hrcw_answers', s.hrcw_answers,
             'requirements', s.requirements,
             'steps', s.steps,
             'stop_work_triggers', s.stop_work_triggers,
             'emergency_scenarios', s.emergency_scenarios,
             'emergency_contacts', s.emergency_contacts,
             'project_details', s.project_details,
             'references_list', s.references_list),
           p.name
      into v_doc, v_project_name
      from swms_instances s
      left join projects p on p.id = s.project_id
     where s.id = l.swms_instance_id;
  elsif l.kind = 'signon' then
    select jsonb_build_object(
             'type','form',
             'name', t.name, 'kind', fs.kind,
             'schema', t.schema, 'version', fs.template_version,
             'requires_signon', t.requires_signon,
             'data', fs.data, 'submitted_at', fs.submitted_at),
           p.name
      into v_doc, v_project_name
      from form_submissions fs
      join form_templates t on t.id = fs.template_id
      left join projects p on p.id = fs.project_id
     where fs.id = l.form_submission_id;
  else -- subbie_swms
    select p.name into v_project_name from projects p where p.id = l.project_id;
    v_doc := jsonb_build_object('type','subbie_swms');
  end if;

  if v_doc is null then
    return null;
  end if;

  return jsonb_build_object(
    'kind', l.kind, 'label', l.label,
    'project_name', v_project_name, 'doc', v_doc);
end $$;

grant execute on function get_shared_doc(text) to anon, authenticated;

------------------------------------------------------------------------------
-- 5. Legacy mapping: hazards → steps, body → doc_control.scope_note
--    (body and hazards columns stay untouched — nothing dropped)
------------------------------------------------------------------------------

update swms_templates set
  steps = coalesce((
    select jsonb_agg(jsonb_build_object(
      'step', h ->> 'task',
      'hazards', h ->> 'hazards',
      'initial_risk', coalesce(h ->> 'risk', 'M'),
      'controls', h ->> 'controls',
      'residual_risk', coalesce(h ->> 'residual_risk', 'L'),
      'responsible', 'Site Supervisor'))
    from jsonb_array_elements(hazards) h
  ), '[]'::jsonb),
  doc_control = jsonb_build_object(
    'prepared_by', '', 'approved_by', '', 'scope_note', coalesce(body, ''))
where steps = '[]'::jsonb;

update swms_instances set
  steps = coalesce((
    select jsonb_agg(jsonb_build_object(
      'step', h ->> 'task',
      'hazards', h ->> 'hazards',
      'initial_risk', coalesce(h ->> 'risk', 'M'),
      'controls', h ->> 'controls',
      'residual_risk', coalesce(h ->> 'residual_risk', 'L'),
      'responsible', 'Site Supervisor'))
    from jsonb_array_elements(hazards) h
  ), '[]'::jsonb),
  doc_control = jsonb_build_object(
    'prepared_by', '', 'approved_by', '', 'scope_note', coalesce(body, ''))
where steps = '[]'::jsonb;

------------------------------------------------------------------------------
-- 6. ECR templates (Rev A) — 3 legacy civil templates rewritten in the full
--    structure + 4 contractor-flavoured new templates. Style: short sentences,
--    active voice, responsibilities to named positions.
------------------------------------------------------------------------------

-- 6.1 Excavation >1.5m & trenching (rewrite)
update swms_templates set
  version = version + 1,
  doc_control = jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Bulk and trench excavation deeper than 1.5 m, including benching, battering, shoring and work near underground services. Applies to ECR self-performed excavation on civil and remediation projects. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  hrcw_items = '[
    {"id":"excavation","label":"Work in, near or above excavations, trenches, pits or unstable ground.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"yes"},
    {"id":"contaminated_soil","label":"Disturbance of contaminated or potentially contaminated soil, water or other material.","suggested":"no"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"no"},
    {"id":"extreme_conditions","label":"Work in extreme heat, storms or flood-affected areas.","suggested":"no"}
  ]'::jsonb,
  requirements = jsonb_build_object(
    'competency', 'General construction induction (white card) for all workers. Plant operators verified competent for the plant used. The Site Supervisor briefs the crew on this SWMS before work starts. Competency records held in the training register.',
    'licences_permits', 'High-risk work licences where required for the plant used. Permit to dig signed daily before ground is broken. Current Before You Dig Australia plans on site.',
    'ppe', 'Hard hat, safety boots, high-visibility clothing, gloves and eye protection. Hearing protection near operating plant.',
    'equipment', 'Shoring or trench shields rated for the ground conditions. Access ladders. Edge barricading and signage. Dewatering pump on standby. Service locator.',
    'monitoring', 'A competent person inspects the excavation daily and after rain, vibration or any change in ground conditions. Inspections recorded on the daily pre-start.'),
  steps = '[
    {"step":"Plan the excavation and confirm services","hazards":"Unlocated services, wrong ground assumptions, unplanned high-risk work","initial_risk":"H","controls":"Obtain current Before You Dig Australia plans. Scan with a service locator. Pothole by hand within 500 mm of marked services. Confirm geotech requirements for benching, battering or shoring. Sign the permit to dig before ground is broken.","residual_risk":"M","responsible":"Director — Site Delivery / signed permit to dig"},
    {"step":"Excavate trench or bank cut deeper than 1.5 m","hazards":"Trench or bank collapse, engulfment","initial_risk":"H","controls":"Bench, batter or shore to the geotech requirements. No entry to an unprotected excavation. Keep spoil and plant at least 1 m from the edge. A competent person inspects daily and after rain.","residual_risk":"M","responsible":"Site Supervisor / daily inspection record"},
    {"step":"Operate plant near the excavation","hazards":"Plant rollover into the excavation, workers struck by slewing plant","initial_risk":"H","controls":"Keep a 3 m exclusion zone with a spotter. Use two-way radio between operator and ground crew. Run plant travel paths parallel to the edge.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Access and egress","hazards":"Falls into the excavation","initial_risk":"M","controls":"Provide ladder access within 9 m of any worker in the trench. Barricade and sign all open edges. Provide task lighting for early starts.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Manage water after rain","hazards":"Flooded excavation, bank instability","initial_risk":"M","controls":"Keep a dewatering pump on standby. Inspect batters after rain before anyone re-enters. Stop work if water is rising.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Backfill and close out","hazards":"Open excavation left unattended","initial_risk":"M","controls":"Backfill, or cover and barricade, before leaving site. Report residual hazards to the client contact. Record any changes to this SWMS.","residual_risk":"L","responsible":"Site Supervisor / close-out record"}
  ]'::jsonb,
  stop_work_triggers = '[
    "Ground conditions change, water enters the excavation or a face shows cracking or movement.",
    "An unlocated service is found or struck.",
    "Unexpected fill, odour, staining, buried waste or suspect asbestos material is uncovered.",
    "The protection system does not match the geotech requirements.",
    "Any person or plant item enters the exclusion zone without authorisation."
  ]'::jsonb,
  emergency_scenarios = '[
    {"scenario":"Trench collapse with a person engulfed","immediate_action":"Call 000. Do not enter the excavation. Keep everyone clear of the failed face. Start rescue only under emergency services direction.","notification":"Notify the Director — Site Delivery immediately. Preserve the scene. Notify the regulator if the incident is notifiable."},
    {"scenario":"Service strike (electrical or gas)","immediate_action":"Stop work. Keep everyone clear. Treat all services as live. Call the asset owner emergency line, and 000 if there is fire, arcing or gas release.","notification":"Notify the Director — Site Delivery. Do not resume until the asset owner confirms the service is safe."},
    {"scenario":"Injury or near miss","immediate_action":"Make the area safe. Give first aid. Call 000 if required.","notification":"Notify the Site Supervisor. Record the incident in the register. Review this SWMS before work restarts."}
  ]'::jsonb,
  references_list = '[
    "Work Health and Safety Regulation 2011 (Qld) — high-risk construction work and excavation duties.",
    "Safe Work Australia Code of Practice: Excavation work.",
    "Safe Work Australia guidance: Safe work method statements for high-risk construction work.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
where id = 'a7000000-0000-4000-a000-000000000001';

-- 6.2 Concrete spalling repair — height work (rewrite)
update swms_templates set
  version = version + 1,
  doc_control = jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Concrete spalling repair from rope access or elevating work platform, including breakout, reinforcement treatment and reinstatement. Applies to ECR self-performed remedial works, often above occupied or public areas. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  hrcw_items = '[
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"yes"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, elevating work platforms or powered equipment.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, fuels, solvents, lead, silica, mould or biological hazards.","suggested":"yes"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"no"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"no"}
  ]'::jsonb,
  requirements = jsonb_build_object(
    'competency', 'General construction induction (white card). IRATA certification for rope access technicians. High-risk work licence for boom-type elevating work platforms over 11 m. The Site Supervisor briefs the crew on this SWMS before work starts.',
    'licences_permits', 'Elevating work platform high-risk work licence where required. Client permits for work above occupied or public areas. Building access permits as required.',
    'ppe', 'Hard hat with chin strap, safety boots, high-visibility clothing, gloves and safety glasses. Fit-tested P2 respirator for concrete breakout. Full-body harness with inspected lanyards for height work.',
    'equipment', 'Twin-rope systems with independent anchors, or an elevating work platform with current inspection. On-tool dust extraction or wet-cutting equipment. Tool lanyards. Overhead protection and drop-zone barricading. Eye wash. Safety data sheets on site.',
    'monitoring', 'Daily harness, rope and anchor inspection before use. Visual dust checks during breakout — stop and re-wet if visible dust leaves the work area.'),
  steps = '[
    {"step":"Set up rope access or position the elevating work platform","hazards":"Fall from height","initial_risk":"H","controls":"IRATA-certified technicians only on ropes. Use twin-rope systems with independent anchors. Elevating work platform operators hold the required high-risk work licence. Inspect harnesses and lanyards daily before use.","residual_risk":"M","responsible":"Site Supervisor / daily inspection record"},
    {"step":"Establish drop zones below the work area","hazards":"Falling objects striking the public or workers","initial_risk":"H","controls":"Install overhead protection or hoarding where required. Barricade drop zones and post a spotter. Fit lanyards to all hand tools.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Break out spalled concrete","hazards":"Respirable crystalline silica dust","initial_risk":"H","controls":"Use on-tool dust extraction or wet cutting. No dry cutting or dry grinding. Wear fit-tested P2 respirators. Keep the exclusion zone below the work clear.","residual_risk":"M","responsible":"Site Supervisor / fit-test records"},
    {"step":"Treat reinforcement and apply epoxy or repair mortar","hazards":"Skin and eye contact with hazardous chemicals","initial_risk":"M","controls":"Keep safety data sheets on site. Wear nitrile gloves and safety glasses. Mix in a ventilated area. Keep the eye wash within reach.","residual_risk":"L","responsible":"All workers"},
    {"step":"Handle repair materials","hazards":"Musculoskeletal strain","initial_risk":"M","controls":"Apply a 20 kg bag limit per person. Lift materials to the work deck mechanically. Use team lifts for awkward loads.","residual_risk":"L","responsible":"All workers"}
  ]'::jsonb,
  stop_work_triggers = '[
    "Wind or weather exceeds the limits for the elevating work platform or rope access plan.",
    "A rope, anchor, harness or lanyard fails inspection or is damaged in use.",
    "A member of the public enters a drop zone.",
    "Suspect asbestos-containing material is found in the substrate or coatings — escalate under the ACM disturbance response SWMS.",
    "Visible dust leaves the work area during breakout."
  ]'::jsonb,
  emergency_scenarios = '[
    {"scenario":"Worker suspended in harness after a fall","immediate_action":"Call 000. Start the rope rescue plan immediately — do not leave the worker suspended. Keep the area below clear.","notification":"Notify the Director — Site Delivery. Quarantine the equipment involved. Record the incident and review this SWMS."},
    {"scenario":"Falling object strikes a person below","immediate_action":"Make the area safe. Give first aid and call 000 if required. Stop overhead work.","notification":"Notify the Director — Site Delivery and the client contact. Do not restart until drop-zone controls are reviewed."},
    {"scenario":"Chemical splash to skin or eyes","immediate_action":"Rinse with water or eye wash for at least 15 minutes. Remove contaminated clothing. Seek medical advice with the safety data sheet.","notification":"Notify the Site Supervisor. Record the exposure and arrange health monitoring if required."}
  ]'::jsonb,
  references_list = '[
    "Work Health and Safety Regulation 2011 (Qld) — falls and high-risk construction work duties.",
    "Safe Work Australia Code of Practice: Managing the risk of falls at workplaces.",
    "WorkSafe Queensland guidance: managing respirable crystalline silica dust in construction.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
where id = 'a7000000-0000-4000-a000-000000000002';

-- 6.3 Working near live traffic (rewrite)
update swms_templates set
  version = version + 1,
  doc_control = jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Works on or adjacent to trafficked roadways under an approved Traffic Control Plan. Applies to ECR self-performed civil works. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  hrcw_items = '[
    {"id":"traffic","label":"Work on or adjacent to a road or other trafficked area.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"no"},
    {"id":"extreme_conditions","label":"Work at night, in storms or in other low-visibility conditions.","suggested":"no"}
  ]'::jsonb,
  requirements = jsonb_build_object(
    'competency', 'General construction induction (white card). Accredited traffic controllers for all stop/slow and traffic management duties. The Site Supervisor briefs the crew on the Traffic Control Plan and this SWMS before each shift.',
    'licences_permits', 'Approved Traffic Management Plan and Traffic Control Plan for the site. Road corridor permits where required by the road authority.',
    'ppe', 'Class D or D/N high-visibility garments for all workers on or near the road. Hard hat, safety boots, gloves and eye protection.',
    'equipment', 'Advance warning signage, cones, delineation and physical barriers per the Traffic Control Plan. Shadow vehicle for setup where required. Tower lighting for night work. Two-way radios.',
    'monitoring', 'The Site Supervisor checks the traffic control setup against the Traffic Control Plan at the start of each shift and after any change. Review the plan after every near miss or intrusion.'),
  steps = '[
    {"step":"Set up and pack down traffic control","hazards":"Workers struck by live traffic","initial_risk":"H","controls":"Work to the approved Traffic Control Plan. Use accredited traffic controllers. Place advance warning signage first. Set up against the traffic flow with a shadow vehicle where required.","residual_risk":"M","responsible":"Site Supervisor / TCP checklist"},
    {"step":"Work within the coned-off work zone","hazards":"Vehicle intrusion into the work area","initial_risk":"H","controls":"Use physical barriers where the posted speed is over 60 km/h. Keep buffer and taper lengths per the Traffic Control Plan. No work outside the delineated zone. Wear Class D or D/N garments.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Move plant in and out of the site","hazards":"Collision with passing vehicles or pedestrians","initial_risk":"M","controls":"A traffic controller manages every site access movement. Reverse only with a spotter. Keep flashing beacons and reversing alarms operational.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Work at night or in low visibility","hazards":"Drivers fail to see workers or the work zone","initial_risk":"M","controls":"Use tower lighting positioned to avoid glare to traffic. Wear retroreflective D/N garments. Review the Traffic Control Plan for night conditions before the shift.","residual_risk":"L","responsible":"Director — Site Delivery"}
  ]'::jsonb,
  stop_work_triggers = '[
    "A vehicle intrudes into the work zone.",
    "The Traffic Control Plan cannot be maintained as approved.",
    "A traffic controller is not accredited or leaves position without relief.",
    "Visibility drops below safe levels due to weather, dust or lighting failure."
  ]'::jsonb,
  emergency_scenarios = '[
    {"scenario":"Vehicle strikes a worker or enters the work zone","immediate_action":"Call 000. Make the scene safe without entering live traffic. Give first aid. Stop all work.","notification":"Notify the Director — Site Delivery and the road authority. Preserve the scene. Notify the regulator if the incident is notifiable."},
    {"scenario":"Plant collision with a passing vehicle","immediate_action":"Stop work. Check for injuries and give first aid. Isolate the plant. Restore traffic control before anything else moves.","notification":"Notify the Director — Site Delivery. Record the incident and review the Traffic Control Plan before restart."}
  ]'::jsonb,
  references_list = '[
    "Work Health and Safety Regulation 2011 (Qld) — high-risk construction work duties.",
    "Queensland MUTCD Part 3 and the approved Traffic Management Plan for the site.",
    "Safe Work Australia guidance: traffic management in workplaces.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
where id = 'a7000000-0000-4000-a000-000000000003';

-- 6.4 Asbestos removal support works & ACM disturbance response (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000004',
  'Asbestos removal support works & ACM disturbance response',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Support works for licensed asbestos removal (exclusion zones, waste handling support, decontamination support) and response to unexpected finds of suspect asbestos-containing material during ECR works. ECR does not remove asbestos under this SWMS — a licensed removalist performs removal under its own SWMS and asbestos removal control plan. Clearance certificates are hold points: no reoccupation before a clearance certificate is issued. Rev A — review before adoption.'),
  '[
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"yes"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, lead, silica, mould or biological hazards.","suggested":"no"},
    {"id":"demolition","label":"Demolition of a load-bearing element or work affecting structural stability.","suggested":"no"},
    {"id":"confined_space","label":"Work in or near a confined space, ceiling void or poorly ventilated area.","suggested":"no"},
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'Asbestos awareness training for all workers. General construction induction (white card). Site-specific induction covering the asbestos register and the removalist control plan. The Director — Compliance and Technical reviews competency records before mobilisation.',
    'licences_permits', 'A licensed asbestos removalist is engaged for all removal work — Class A for friable, Class A or B for non-friable as applicable. ECR workers do not remove asbestos under this SWMS. Client permits and site inductions as required.',
    'ppe', 'Disposable coveralls (type 5/6) and fit-tested P2 respirator as a minimum where disturbance of asbestos-containing material is credible. Gloves and decontaminable safety boots or boot covers. Inside any removal zone, PPE per the removalist control plan.',
    'equipment', 'Barricading and asbestos warning signage for exclusion zones. Wetting agent and sealant. Heavy-duty asbestos waste bags and labels. Decontamination supplies. Spill kit.',
    'monitoring', 'Air monitoring by an independent licensed asbestos assessor where required by the removal control plan. Stop and review if any result is at or above 0.01 fibres/mL. Clearance inspection and certificate before reoccupation — this is a hold point.'),
  '[
    {"step":"Review the asbestos register and removal control plan before start","hazards":"Unidentified asbestos-containing material, wrong work scope","initial_risk":"H","controls":"Review the asbestos register, survey reports and the removalist control plan. Confirm the removal boundary, exclusion zones and clearance hold points. Brief the crew before mobilisation.","residual_risk":"M","responsible":"Director — Compliance and Technical / pre-start briefing record"},
    {"step":"Set up exclusion zones and signage","hazards":"Workers or the public entering a contaminated area","initial_risk":"H","controls":"Barricade the work area per the control plan. Post asbestos warning signage. Control access through one point. Keep occupants and the public clear at all times.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Support licensed removal from outside the removal zone","hazards":"Fibre exposure at the zone boundary","initial_risk":"H","controls":"Stay outside the removal zone unless inducted under the removalist control plan. Follow the removalist decontamination arrangements. Do not handle asbestos waste unless trained and equipped for it.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Respond to an unexpected find of suspect ACM","hazards":"Uncontrolled fibre release","initial_risk":"H","controls":"Stop work immediately. Isolate the area and keep everyone out. Keep the material damp if safe to do so. Do not dry sweep or use compressed air. Report to the Site Supervisor at once.","residual_risk":"M","responsible":"All workers"},
    {"step":"Escalate the find and arrange licensed controls","hazards":"Disturbance spreading, wrong controls applied","initial_risk":"H","controls":"The Site Supervisor notifies the Director — Compliance and Technical. Arrange sampling by a competent person, or treat the material as asbestos. Engage a licensed removalist for any removal. Work does not restart in the area until controls are confirmed.","residual_risk":"M","responsible":"Director — Compliance and Technical"},
    {"step":"Support waste handling and decontamination","hazards":"Secondary contamination leaving the zone","initial_risk":"M","controls":"Double-bag and label asbestos waste. Follow the decontamination sequence before leaving the zone. Bag disposable PPE as asbestos waste. Dispose only at a licensed facility with waste tracking.","residual_risk":"L","responsible":"Site Supervisor / waste records"},
    {"step":"Clearance and reoccupation","hazards":"Reoccupation of a contaminated area","initial_risk":"H","controls":"Hold point: no reoccupation until an independent licensed asbestos assessor or competent person issues a clearance certificate. The Director — Compliance and Technical confirms the certificate is on file before handback.","residual_risk":"L","responsible":"Director — Compliance and Technical / clearance certificate"}
  ]'::jsonb,
  '[
    "Unexpected friable or suspect asbestos-containing material is found or disturbed.",
    "Asbestos warning signage or barricades are removed or breached.",
    "An air monitoring result is at or above 0.01 fibres/mL.",
    "The work drifts toward asbestos removal — only a licensed removalist removes asbestos.",
    "A worker is not fit-tested, trained or equipped for the task."
  ]'::jsonb,
  '[
    {"scenario":"Suspected asbestos fibre release","immediate_action":"Stop work. Isolate the area and prevent access. Keep the material damp if safe. Do not dry sweep or use compressed air.","notification":"Notify the Director — Compliance and Technical and the client. Engage a licensed removalist if removal is required. Notify the regulator if the incident is notifiable. Review this SWMS."},
    {"scenario":"PPE breach or suspected exposure inside a zone","immediate_action":"Leave the zone through the decontamination sequence. Do not spread contamination. Wash exposed skin.","notification":"Notify the Site Supervisor and the Director — Compliance and Technical. Record the exposure and arrange health monitoring."},
    {"scenario":"Unauthorised person enters an exclusion zone","immediate_action":"Stop work. Escort the person out through the decontamination point. Re-secure the zone.","notification":"Notify the Site Supervisor and the client contact. Review access controls before restart."}
  ]'::jsonb,
  '[
    "Work Health and Safety Regulation 2011 (Qld) Chapter 8 — asbestos duties.",
    "Safe Work Australia Code of Practice: How to manage and control asbestos in the workplace.",
    "Safe Work Australia Code of Practice: How to safely remove asbestos.",
    "ECR WHS Management System procedure SMS-13 and the asbestos registers."
  ]'::jsonb
) on conflict (id) do nothing;

-- 6.5 Demolition works — partial & strip-out (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000005',
  'Demolition works — partial & strip-out',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Partial demolition and internal strip-out of structures: soft strip, non-structural removal and controlled removal of minor structural elements under the demolition work plan. AS 2601 applies. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  '[
    {"id":"demolition","label":"Demolition of a load-bearing element or work affecting structural stability.","suggested":"yes"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, lead, silica, mould or biological hazards.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'General construction induction (white card). Asbestos awareness training. Demolition briefing against the demolition work plan before start. Plant operators verified competent.',
    'licences_permits', 'Demolition licence or notification where the work is licensable or notifiable in the jurisdiction. Services isolation confirmed by the Director — Site Delivery before strip-out starts. Client permits as required.',
    'ppe', 'Hard hat, safety boots, high-visibility clothing, gloves, eye protection and hearing protection. Fit-tested P2 respirator for dusty work.',
    'equipment', 'Props and shoring per the engineered sequence. Barricading and signage for exclusion zones. Water for dust suppression. Lock-out tag-out kit. Waste segregation bins.',
    'monitoring', 'The Site Supervisor checks structural condition at the start of each shift and after each structural element is removed. Watch for movement, cracking and unexpected load paths. Dust checks at the site boundary.'),
  '[
    {"step":"Review the demolition work plan and asbestos register","hazards":"Hidden asbestos-containing material, wrong demolition sequence","initial_risk":"H","controls":"Confirm the structure has a current asbestos register review or clearance before strip-out. Review the demolition sequence against AS 2601. Confirm structural assumptions with the engineer where required.","residual_risk":"M","responsible":"Director — Site Delivery / demolition work plan"},
    {"step":"Isolate services","hazards":"Electrocution, gas release, flooding","initial_risk":"H","controls":"The Director — Site Delivery confirms electrical, gas, water and communications isolation before work starts. Lock out and tag isolation points. Treat all services as live until verified dead.","residual_risk":"M","responsible":"Director — Site Delivery / isolation certificates"},
    {"step":"Establish exclusion zones","hazards":"Workers or the public struck by falling debris","initial_risk":"H","controls":"Barricade the work area and drop zones. Size the exclusion zone to the element being removed. No entry below overhead work at any time.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Soft strip and non-structural removal","hazards":"Manual handling injuries, sharps, dust","initial_risk":"M","controls":"Strip in the planned sequence. De-nail or fold sharps as they are produced. Wet down dusty materials before and during removal. Use mechanical aids for heavy elements.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Remove minor structural elements","hazards":"Uncontrolled collapse","initial_risk":"H","controls":"Follow the engineered sequence. Prop or shore before cutting. Remove one element at a time. Stop if unexpected movement, cracking or load paths are found.","residual_risk":"M","responsible":"Director — Site Delivery"},
    {"step":"Segregate and remove waste","hazards":"Contaminated waste mixed with general waste, plant interaction","initial_risk":"M","controls":"Segregate waste streams at source. Track regulated waste. Load trucks with a spotter. Keep pedestrian routes separated from plant routes.","residual_risk":"L","responsible":"Site Supervisor / waste dockets"}
  ]'::jsonb,
  '[
    "Unexpected asbestos-containing material or other hazardous material is found.",
    "Structural movement, cracking or an unexpected load path appears.",
    "A service assumed isolated is found live.",
    "An exclusion zone is breached.",
    "High wind or weather makes debris control ineffective."
  ]'::jsonb,
  '[
    {"scenario":"Structural movement or partial collapse","immediate_action":"Evacuate the structure and exclusion zone. Call 000 if anyone is trapped or injured. Do not re-enter.","notification":"Notify the Director — Site Delivery. Obtain engineering advice before any re-entry. Notify the regulator if the incident is notifiable."},
    {"scenario":"Contact with a live service","immediate_action":"Do not touch the casualty until the source is isolated. Isolate at the main if safe. Give first aid and call 000.","notification":"Notify the Director — Site Delivery. Re-verify every isolation before work restarts."},
    {"scenario":"Unexpected asbestos find","immediate_action":"Stop work in the area. Isolate and keep the material damp if safe. Follow the ACM disturbance response SWMS.","notification":"Notify the Director — Compliance and Technical. Engage a licensed removalist if removal is required."}
  ]'::jsonb,
  '[
    "AS 2601 — The demolition of structures.",
    "Safe Work Australia Code of Practice: Demolition work.",
    "Work Health and Safety Regulation 2011 (Qld) — demolition and asbestos duties.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
) on conflict (id) do nothing;

-- 6.6 Contaminated soil excavation & handling (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000006',
  'Contaminated soil excavation & handling',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Excavation, handling, stockpiling and off-site disposal of contaminated or potentially contaminated soil on remediation projects. Works follow the remediation action plan and waste classification for the site. Subcontractors prepare their own SWMS. Rev A — review before adoption.'),
  '[
    {"id":"contaminated_soil","label":"Disturbance of contaminated or potentially contaminated soil, water or other material.","suggested":"yes"},
    {"id":"excavation","label":"Work in, near or above excavations, trenches, pits or unstable ground.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant, excavators, trucks or powered equipment.","suggested":"yes"},
    {"id":"services","label":"Work on or near energised electrical services or underground services.","suggested":"yes"},
    {"id":"hazardous_chemicals","label":"Work involving hazardous chemicals, fuels, solvents, lead, silica, mould or biological hazards.","suggested":"yes"},
    {"id":"asbestos","label":"Work on or near asbestos or asbestos-containing material.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'General construction induction (white card). Briefing on the remediation action plan and waste classification before start. Plant operators verified competent. Asbestos awareness training where fill may contain asbestos.',
    'licences_permits', 'Permit to dig signed before excavation. Licensed waste carriers for off-site disposal. Disposal facility approvals matching the waste classification. Regulated waste transport documentation.',
    'ppe', 'Safety boots, long sleeves and pants, high-visibility clothing, nitrile gloves under work gloves and safety glasses. Disposable coveralls where contact with contaminated material is credible. Fit-tested P2 respirator where dust or vapour exposure is credible.',
    'equipment', 'Water cart or hose for dust suppression. Stockpile liner and covers. Bunding. Decontamination station. Spill kit. Gas monitor where volatile contamination is possible.',
    'monitoring', 'Visual dust checks at the work face and site boundary. Vapour monitoring where volatile contamination is possible. Air monitoring where required by the remediation action plan. Stop and review on any alarm or odour.'),
  '[
    {"step":"Review contamination information and locate services","hazards":"Unknown contaminants, service strike","initial_risk":"H","controls":"Review the remediation action plan, site assessment reports and waste classification. Obtain service plans, scan and pothole before excavation. Confirm excavation extents and clean/dirty zones.","residual_risk":"M","responsible":"Director — Compliance and Technical / RAP and permit to dig"},
    {"step":"Excavate contaminated soil","hazards":"Dust and vapour exposure, engulfment","initial_risk":"H","controls":"Keep workers out of the excavation where practicable. Wet down the face and loads. Work upwind where possible. Stop if odours, free product, buried waste or suspect asbestos material appear.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Stockpile and cover","hazards":"Contaminated run-off, dust, cross contamination","initial_risk":"M","controls":"Stockpile on lined ground within a bunded area. Cover stockpiles at the end of each shift and before rain. Keep clean and dirty zones separated.","residual_risk":"L","responsible":"Site Supervisor"},
    {"step":"Load and transport for disposal","hazards":"Spillage in transit, disposal at the wrong facility","initial_risk":"H","controls":"Confirm the waste classification before loading. Use licensed carriers only. Cover every load. Complete waste tracking documentation. Dispose only at an approved facility.","residual_risk":"M","responsible":"Director — Compliance and Technical / waste tracking records"},
    {"step":"Decontaminate plant and personnel","hazards":"Contamination tracked off site","initial_risk":"M","controls":"Decontaminate plant, tools and boots at the decontamination station before leaving the dirty zone. Bag disposable PPE as contaminated waste. No eating, drinking or smoking in the work zone.","residual_risk":"L","responsible":"All workers"},
    {"step":"Validate and close out","hazards":"Residual contamination left in place","initial_risk":"M","controls":"Confirm validation sampling per the remediation action plan before backfill. Record quantities, dockets and variations. Report residual hazards to the client.","residual_risk":"L","responsible":"Director — Compliance and Technical / validation records"}
  ]'::jsonb,
  '[
    "Unexpected odour, staining, free product, buried waste or suspect asbestos material is uncovered.",
    "A gas monitor alarms or a worker reports symptoms.",
    "Dust is visible leaving the site boundary.",
    "Soil is about to leave site without a confirmed waste classification.",
    "Run-off from the work area or a stockpile is escaping containment."
  ]'::jsonb,
  '[
    {"scenario":"Gas or vapour alarm, or strong odour","immediate_action":"Stop work. Move everyone upwind. Remove ignition sources if safe. Do not re-enter until readings are safe.","notification":"Notify the Director — Compliance and Technical. Reassess controls and monitoring before re-entry."},
    {"scenario":"Skin contact with contaminated material","immediate_action":"Wash the area with clean water and soap. Remove contaminated clothing. Seek first aid or medical advice.","notification":"Notify the Site Supervisor. Record the exposure and arrange health monitoring if required."},
    {"scenario":"Spill during loading or transport","immediate_action":"Stop the source if safe. Contain with the spill kit. Prevent entry to drains and waterways.","notification":"Notify the Director — Compliance and Technical and the client. Notify the environmental regulator if required. Dispose of spill waste correctly."}
  ]'::jsonb,
  '[
    "Work Health and Safety Regulation 2011 (Qld) — hazardous chemicals and excavation duties.",
    "Environmental Protection Act 1994 (Qld) — waste tracking and general environmental duty.",
    "Safe Work Australia Code of Practice: Managing risks of hazardous chemicals in the workplace.",
    "The site remediation action plan and waste classification report.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
) on conflict (id) do nothing;

-- 6.7 Silica-generating concrete & masonry work (new)
insert into swms_templates (
  id, title, body, hazards, version, active,
  doc_control, hrcw_items, requirements, steps,
  stop_work_triggers, emergency_scenarios, references_list
) values (
  'a7000000-0000-4000-a000-000000000007',
  'Silica-generating concrete & masonry work',
  null, '[]'::jsonb, 1, true,
  jsonb_build_object(
    'prepared_by', 'Director — Compliance and Technical',
    'approved_by', 'Director — Site Delivery',
    'scope_note', 'Cutting, grinding, drilling, breaking and scabbling of concrete, masonry and stone by ECR crews. Wet methods or on-tool extraction are mandatory. Dry cutting is prohibited. Rev A — review before adoption.'),
  '[
    {"id":"hazardous_chemicals","label":"Work generating respirable crystalline silica dust.","suggested":"yes"},
    {"id":"mobile_plant","label":"Work near mobile plant or powered equipment.","suggested":"no"},
    {"id":"public_access","label":"Work in areas accessible by occupants, tenants, pedestrians or the public.","suggested":"no"},
    {"id":"fall_2m","label":"Work where a person could fall more than 2 m.","suggested":"no"},
    {"id":"services","label":"Work on or near energised electrical services or embedded services.","suggested":"no"}
  ]'::jsonb,
  jsonb_build_object(
    'competency', 'General construction induction (white card). Silica awareness training. Respirator fit testing current for every worker doing or near the task. The Site Supervisor briefs the crew on this SWMS before start.',
    'licences_permits', 'Client permits for cutting or penetrations. Services scan before drilling or cutting into slabs and walls.',
    'ppe', 'Fit-tested P2 respirator as a minimum for the task. Hearing protection, eye protection, gloves, safety boots and high-visibility clothing.',
    'equipment', 'Wet-cutting saws with a working water feed. On-tool extraction shrouds with an M-class or H-class vacuum. Water supply. Sealable bags for dust and filters.',
    'monitoring', 'Visual dust checks during every cut. Air monitoring where the task risk assessment requires it. Respiratory health monitoring for workers with ongoing exposure risk, arranged by the Director — Compliance and Technical.'),
  '[
    {"step":"Plan the task and pick the method","hazards":"Uncontrolled silica dust generation","initial_risk":"H","controls":"Choose the lowest-dust method first: order pre-cut materials, or use wet cutting or on-tool extraction. Dry cutting is prohibited. Confirm water supply and vacuum before start. Scan for embedded services.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Cut, grind or drill with wet methods","hazards":"Respirable crystalline silica exposure","initial_risk":"H","controls":"Keep water flowing to the blade for the whole cut. Wear a fit-tested P2 respirator. Keep other workers out of the dust zone.","residual_risk":"M","responsible":"All workers / fit-test records"},
    {"step":"Use on-tool extraction where wet methods are not practicable","hazards":"Dust escaping the shroud","initial_risk":"H","controls":"Fit the shroud and an M-class or H-class vacuum. Empty the vacuum wet or into sealed bags. Never blow down with compressed air.","residual_risk":"M","responsible":"Site Supervisor"},
    {"step":"Clean up slurry and dust","hazards":"Dried slurry re-suspending as dust","initial_risk":"M","controls":"Remove slurry before it dries. Wet-wipe or vacuum surfaces with an M-class or H-class vacuum. No dry sweeping.","residual_risk":"L","responsible":"All workers"},
    {"step":"Maintain cutting and extraction equipment","hazards":"Failed water feed or extraction going unnoticed","initial_risk":"M","controls":"Check water feed, shrouds, hoses and filters each shift. Tag out defective equipment. Report defects to the Site Supervisor.","residual_risk":"L","responsible":"Site Supervisor / pre-start records"}
  ]'::jsonb,
  '[
    "Visible dust during cutting, grinding or drilling.",
    "The water feed or extraction system fails.",
    "A worker in the dust zone is not wearing a fit-tested P2 respirator.",
    "Dry cutting is observed — stop the task immediately."
  ]'::jsonb,
  '[
    {"scenario":"Uncontrolled dust release","immediate_action":"Stop the task. Wet down the area. Clear workers from the dust zone until it settles.","notification":"Notify the Site Supervisor and the Director — Compliance and Technical. Review controls before restart. Record the event."},
    {"scenario":"Worker reports respiratory symptoms","immediate_action":"Move the worker to fresh air. Give first aid and seek medical advice.","notification":"Notify the Director — Compliance and Technical. Record the exposure and arrange health monitoring."}
  ]'::jsonb,
  '[
    "Work Health and Safety Regulation 2011 (Qld) — respirable crystalline silica provisions.",
    "Managing respirable crystalline silica dust exposure in construction and manufacturing (Qld Code of Practice).",
    "Safe Work Australia guidance: crystalline silica and silicosis.",
    "ECR WHS Management System procedures and registers."
  ]'::jsonb
) on conflict (id) do nothing;
