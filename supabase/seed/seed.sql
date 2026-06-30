-- ============================================================================
-- Demo seed data — full company scenario ("Entice" civil/remedial contractor)
-- ============================================================================
-- Re-running: delete demo rows first / for fresh installs only.
-- The script assumes every table except profiles (admin + office), settings,
-- cost_codes and sequences is EMPTY. The guard below aborts if clients has
-- rows. All money figures are hand-computed so UI recomputations (quote
-- totals, claim engine, profitability) reconcile exactly.
--
-- Existing rows this script depends on:
--   profiles: one admin (admin@entice.local)  — looked up by role
--   cost_codes: codes 10,20,30,40,50,60,70,80,90,99 — looked up by code
--
-- Demo logins created here (password Entice!234):
--   super@entice.local  (Sam Field, supervisor)
--   field1@entice.local (Jack Labour, field)
--   field2@entice.local (Mia Operator, field)
--
-- After running, upload the shared signature placeholder PNG:
--   node supabase/seed/upload-signature-placeholder.mjs
-- (uploads attachments/seed/sig-placeholder.png used by all seed signatures)
-- ============================================================================

-- ─── Guard: only run against an empty install ───────────────────────────────
do $$
begin
  if (select count(*) from clients) > 0 then
    raise exception 'Seed aborted: clients table is not empty. This seed is for fresh installs only — delete demo rows first.';
  end if;
end $$;

-- ─── 1. Users (direct auth inserts, same pattern as admin_create_user) ──────
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('aa000000-0000-4000-a000-000000000001'::uuid, 'super@entice.local',  'Sam Field',    'supervisor', 65.00, '0412 700 154'),
      ('aa000000-0000-4000-a000-000000000002'::uuid, 'field1@entice.local', 'Jack Labour',  'field',      55.00, '0401 882 367'),
      ('aa000000-0000-4000-a000-000000000003'::uuid, 'field2@entice.local', 'Mia Operator', 'field',      60.00, '0432 519 740')
    ) as t(id, email, full_name, role, hourly_cost, phone)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      lower(u.email), extensions.crypt('Entice!234', extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', lower(u.email), 'email_verified', true),
      'email', now(), now(), now()
    );
    insert into public.profiles (id, full_name, role, hourly_cost, phone)
    values (u.id, u.full_name, u.role, u.hourly_cost, u.phone);
  end loop;
end $$;

-- ─── 2. Rate items (18) ──────────────────────────────────────────────────────
insert into rate_items (kind, name, unit, cost, default_markup_pct) values
  ('labour',   'Labourer',                       'hr',    55.00, 35),
  ('labour',   'Leading Hand',                   'hr',    68.00, 35),
  ('labour',   'Supervisor',                     'hr',    85.00, 30),
  ('plant',    'Excavator 5t wet hire',          'day',  950.00, 25),
  ('plant',    'Excavator 13t wet hire',         'day', 1450.00, 25),
  ('plant',    'Bobcat + operator',              'day',  880.00, 25),
  ('plant',    'Tipper hire',                    'day',  750.00, 20),
  ('material', 'Concrete N32',                   'm3',   285.00, 30),
  ('material', 'Reo mesh SL82',                  'sheet', 95.00, 35),
  ('material', 'Formwork ply',                   'm2',    38.00, 40),
  ('material', 'Waterproof membrane',            'm2',    42.00, 45),
  ('material', 'Spalling repair mortar',         'bag',   48.00, 50),
  ('subbie',   'Traffic control crew',           'day', 1350.00, 15),
  ('other',    'Tipping fees — clean fill',      't',     35.00, 25),
  ('other',    'Tipping fees — contaminated',    't',    285.00, 20),
  ('subbie',   'Asbestos removal',               'm2',    85.00, 20),
  ('plant',    'Scaffold hire',                  'week', 1200.00, 18),
  ('other',    'Site shed',                      'month', 650.00, 15);

-- ─── 3. Plant (6) ────────────────────────────────────────────────────────────
insert into plant (id, name, type, rego, ownership, hourly_rate) values
  ('bb000000-0000-4000-a000-000000000001', 'Excavator 5t — Kubota KX057',  'Excavator',  null,     'owned',  95.00),
  ('bb000000-0000-4000-a000-000000000002', 'Excavator 13t — Cat 313GC',    'Excavator',  null,     'owned', 145.00),
  ('bb000000-0000-4000-a000-000000000003', 'Bobcat S70',                   'Skid steer', null,     'owned',  75.00),
  ('bb000000-0000-4000-a000-000000000004', 'Tipper truck — Isuzu FVZ 240', 'Truck',      'BW21KD', 'owned', 110.00),
  ('bb000000-0000-4000-a000-000000000005', 'Compactor plate — Wacker DPU', 'Compaction', null,     'owned',  25.00),
  ('bb000000-0000-4000-a000-000000000006', 'Genie boom 45ft — Z-45',       'EWP',        null,     'hired',  85.00);

-- ─── 4. Clients, sites, contacts ─────────────────────────────────────────────
insert into clients (id, name, type, abn, payment_terms_days, notes) values
  ('c1000000-0000-4000-a000-000000000001', 'Meridian Construct',            'builder',          '46118274903', 30, 'Tier-2 builder, mostly D&C residential. PM-driven, quick decisions.'),
  ('c1000000-0000-4000-a000-000000000002', 'Harbourview Strata Management', 'strata',           '83552901447', 30, 'Manages ~40 schemes in the eastern suburbs.'),
  ('c1000000-0000-4000-a000-000000000003', 'Bayside Council',               'council',          '29347820115', 30, 'Panel contractor — civil & foreshore works. Order numbers required on all invoices.'),
  ('c1000000-0000-4000-a000-000000000004', 'CoreFM Facilities',             'facility_manager', '61209783341', 45, 'National FM provider, work orders via their portal.'),
  ('c1000000-0000-4000-a000-000000000005', 'SureBuild Insurance Repairs',   'insurer',          '57883104226', 30, 'Insurance builder — storm/impact damage make-safe and rebuilds.'),
  ('c1000000-0000-4000-a000-000000000006', 'Pinnacle Strata Group',         'strata',           '90415667382', 30, 'Remedial-heavy portfolio on the lower north shore.');

insert into sites (id, client_id, name, address, suburb, state, postcode) values
  ('c2000000-0000-4000-a000-000000000011', 'c1000000-0000-4000-a000-000000000001', 'Lakeview Apartments site',         '14 Garigal Rd',     'Frenchs Forest', 'NSW', '2086'),
  ('c2000000-0000-4000-a000-000000000021', 'c1000000-0000-4000-a000-000000000002', 'The Anchorage — Building A',       '8 Yarranabbe Rd',   'Darling Point',  'NSW', '2027'),
  ('c2000000-0000-4000-a000-000000000031', 'c1000000-0000-4000-a000-000000000003', 'Cooks River foreshore — Reach 4',  'Riverine Park, Levey St', 'Wolli Creek', 'NSW', '2205'),
  ('c2000000-0000-4000-a000-000000000032', 'c1000000-0000-4000-a000-000000000003', 'Works depot — Banksia',            '12 Skidmore Ave',   'Banksia',        'NSW', '2216'),
  ('c2000000-0000-4000-a000-000000000041', 'c1000000-0000-4000-a000-000000000004', 'Eastgardens carpark — Level 2',    '152 Bunnerong Rd',  'Eastgardens',    'NSW', '2036'),
  ('c2000000-0000-4000-a000-000000000051', 'c1000000-0000-4000-a000-000000000005', 'Residence — Northbridge',          '23 Coolawin Rd',    'Northbridge',    'NSW', '2063'),
  ('c2000000-0000-4000-a000-000000000061', 'c1000000-0000-4000-a000-000000000006', 'Harbourview Towers',               '30 Alfred St',      'Milsons Point',  'NSW', '2061'),
  ('c2000000-0000-4000-a000-000000000062', 'c1000000-0000-4000-a000-000000000006', 'The Crest — basement carpark',     '5 Help St',         'Chatswood',      'NSW', '2067');

insert into contacts (id, client_id, name, role, email, phone) values
  ('c3000000-0000-4000-a000-000000000011', 'c1000000-0000-4000-a000-000000000001', 'Dave Chen',      'Project Manager',       'dave.chen@meridianconstruct.com.au',      '0412 334 556'),
  ('c3000000-0000-4000-a000-000000000012', 'c1000000-0000-4000-a000-000000000001', 'Priya Sharma',   'Contracts Administrator','priya.sharma@meridianconstruct.com.au',  '0423 880 119'),
  ('c3000000-0000-4000-a000-000000000021', 'c1000000-0000-4000-a000-000000000002', 'Karen Willis',   'Strata Manager',        'karen.willis@harbourviewstrata.com.au',   '0410 224 887'),
  ('c3000000-0000-4000-a000-000000000031', 'c1000000-0000-4000-a000-000000000003', 'Tom Nguyen',     'Project Engineer',      'tnguyen@bayside.nsw.gov.au',              '02 9562 1144'),
  ('c3000000-0000-4000-a000-000000000032', 'c1000000-0000-4000-a000-000000000003', 'Leanne Park',    'Contracts Officer',     'lpark@bayside.nsw.gov.au',                '02 9562 1167'),
  ('c3000000-0000-4000-a000-000000000041', 'c1000000-0000-4000-a000-000000000004', 'Steve Doyle',    'Facilities Manager',    'steve.doyle@corefm.com.au',               '0433 901 277'),
  ('c3000000-0000-4000-a000-000000000051', 'c1000000-0000-4000-a000-000000000005', 'Rachel Moore',   'Claims Supervisor',     'rachel.moore@surebuild.com.au',           '0401 552 384'),
  ('c3000000-0000-4000-a000-000000000061', 'c1000000-0000-4000-a000-000000000006', 'Greg Hartley',   'Senior Strata Manager', 'greg.hartley@pinnaclestrata.com.au',      '0418 660 432'),
  ('c3000000-0000-4000-a000-000000000062', 'c1000000-0000-4000-a000-000000000006', 'Sophie Lin',     'Assistant Strata Manager','sophie.lin@pinnaclestrata.com.au',      '02 9410 8855');

-- ─── 5. Vendors + compliance docs ────────────────────────────────────────────
-- Expiries vs today (2026-06-12): mostly +6..11 months;
--   DigDeep PL expires +12 days (2026-06-24) — "expiring soon" on dashboard;
--   DemoWorks workers comp expired -20 days (2026-05-23) — "expired".
insert into vendors (id, name, abn, trades, contact_name, email, phone, payment_terms_days) values
  ('dd000000-0000-4000-a000-000000000001', 'Apex Traffic Control',            '70218459336', '{traffic}',              'Mick Donato',   'mick@apextraffic.com.au',        '0412 998 113', 30),
  ('dd000000-0000-4000-a000-000000000002', 'DigDeep Earthmoving',             '34902167845', '{earthworks}',           'Col Barrett',   'col@digdeepearth.com.au',        '0419 224 901', 30),
  ('dd000000-0000-4000-a000-000000000003', 'SteelFix Reinforcement',          '88761023954', '{steel}',                'Anh Tran',      'anh@steelfix.net.au',            '0438 117 765', 30),
  ('dd000000-0000-4000-a000-000000000004', 'AquaSeal Waterproofing',          '52336190478', '{waterproofing}',        'Marco Bellini', 'marco@aquaseal.com.au',          '0402 663 218', 14),
  ('dd000000-0000-4000-a000-000000000005', 'DemoWorks Demolition & Asbestos', '19584032761', '{demolition,asbestos}',  'Shane Kovac',   'shane@demoworks.com.au',         '0421 478 332', 30),
  ('dd000000-0000-4000-a000-000000000006', 'GreenTip Waste',                  '63870219455', '{haulage,tipping}',      'Tanya Reeves',  'accounts@greentipwaste.com.au',  '02 9709 4410', 14),
  ('dd000000-0000-4000-a000-000000000007', 'ProForm Concrete',                '41129586073', '{concrete}',             'Joe Mancini',   'joe@proformconcrete.com.au',     '0415 309 884', 30),
  ('dd000000-0000-4000-a000-000000000008', 'SparkSafe Electrical',            '77640318529', '{electrical}',           'Renee Walsh',   'renee@sparksafe.com.au',         '0407 551 296', 14);

insert into vendor_compliance_docs (vendor_id, kind, reference, expiry_date) values
  ('dd000000-0000-4000-a000-000000000001', 'public_liability', 'CGU PL 20M — POL-7741820',      '2027-03-18'),
  ('dd000000-0000-4000-a000-000000000001', 'workers_comp',     'icare WC — WC110238456',        '2026-12-09'),
  ('dd000000-0000-4000-a000-000000000002', 'public_liability', 'Allianz PL 20M — AL-5520934',   '2026-06-24'),
  ('dd000000-0000-4000-a000-000000000002', 'workers_comp',     'icare WC — WC109884712',        '2027-02-14'),
  ('dd000000-0000-4000-a000-000000000003', 'public_liability', 'QBE PL 10M — QBE-8830127',      '2027-01-22'),
  ('dd000000-0000-4000-a000-000000000003', 'workers_comp',     'icare WC — WC111572390',        '2026-12-30'),
  ('dd000000-0000-4000-a000-000000000004', 'public_liability', 'Zurich PL 20M — ZU-6618204',    '2027-04-08'),
  ('dd000000-0000-4000-a000-000000000004', 'workers_comp',     'icare WC — WC112049867',        '2027-01-15'),
  ('dd000000-0000-4000-a000-000000000005', 'public_liability', 'GIO PL 20M — GIO-9914382',      '2027-02-02'),
  ('dd000000-0000-4000-a000-000000000005', 'workers_comp',     'icare WC — WC108441523',        '2026-05-23'),
  ('dd000000-0000-4000-a000-000000000005', 'licence',          'SafeWork NSW AS Class A — AD212884', '2027-08-01'),
  ('dd000000-0000-4000-a000-000000000006', 'public_liability', 'CGU PL 20M — POL-8052916',      '2026-12-18'),
  ('dd000000-0000-4000-a000-000000000006', 'workers_comp',     'icare WC — WC113228075',        '2027-03-05'),
  ('dd000000-0000-4000-a000-000000000007', 'public_liability', 'Allianz PL 20M — AL-7741098',   '2027-05-11'),
  ('dd000000-0000-4000-a000-000000000007', 'workers_comp',     'icare WC — WC110937244',        '2027-02-26'),
  ('dd000000-0000-4000-a000-000000000008', 'public_liability', 'QBE PL 20M — QBE-9102375',      '2027-03-29'),
  ('dd000000-0000-4000-a000-000000000008', 'workers_comp',     'icare WC — WC112660198',        '2026-12-22');

-- ─── 6. Quotes ───────────────────────────────────────────────────────────────
-- unit_sell = round2(unit_cost × (1 + markup/100)) everywhere.
insert into quotes (id, number, client_id, site_id, contact_id, title, description, status, gst_rate, valid_days, sent_at, decided_at, converted_to, converted_id, created_by, created_at) values
  ('e1000000-0000-4000-a000-000000000001', 'Q-0001', 'c1000000-0000-4000-a000-000000000001', 'c2000000-0000-4000-a000-000000000011', 'c3000000-0000-4000-a000-000000000011',
   'Stormwater diversion works', 'Divert existing 375 RCP around new building footprint, incl. pits and reinstatement.', 'draft', 10, 30, null, null, null, null,
   (select id from profiles where role = 'admin' order by created_at limit 1), '2026-06-09 14:10+10'),
  ('e1000000-0000-4000-a000-000000000002', 'Q-0002', 'c1000000-0000-4000-a000-000000000002', 'c2000000-0000-4000-a000-000000000021', 'c3000000-0000-4000-a000-000000000021',
   'Balcony membrane remediation — Bldg A', 'Strip failed tiling/membrane to 14 balconies, re-membrane, screed and re-tile.', 'sent', 10, 30, '2026-06-07 09:30+10', null, null, null,
   (select id from profiles where role = 'admin' order by created_at limit 1), '2026-06-04 11:05+10'),
  ('e1000000-0000-4000-a000-000000000003', 'Q-0003', 'c1000000-0000-4000-a000-000000000004', 'c2000000-0000-4000-a000-000000000041', 'c3000000-0000-4000-a000-000000000041',
   'Carpark expansion joint repairs', 'Cut out failed expansion joint seals on Level 2 deck and install new proprietary joint system.', 'sent', 10, 30, '2026-05-27 16:20+10', null, null, null,
   (select id from profiles where role = 'admin' order by created_at limit 1), '2026-05-26 09:40+10'),
  ('e1000000-0000-4000-a000-000000000004', 'Q-0004', 'c1000000-0000-4000-a000-000000000005', 'c2000000-0000-4000-a000-000000000051', 'c3000000-0000-4000-a000-000000000051',
   'Storm damage retaining wall rebuild', 'Demolish storm-collapsed masonry wall and rebuild as 1.8m concrete sleeper wall with drainage.', 'accepted', 10, 30, '2026-05-05 10:00+10', '2026-05-19 13:45+10', 'job', 'f1000000-0000-4000-a000-000000000001',
   (select id from profiles where role = 'admin' order by created_at limit 1), '2026-05-04 15:30+10'),
  ('e1000000-0000-4000-a000-000000000005', 'Q-0005', 'c1000000-0000-4000-a000-000000000003', 'c2000000-0000-4000-a000-000000000031', 'c3000000-0000-4000-a000-000000000031',
   'Riverbank Stabilisation Stage 2', 'Rock revetment and gabion stabilisation of 1.2km reach incl. environmental controls, per RFT BC-RFT-2025-114.', 'accepted', 10, 45, '2026-02-02 12:00+11', '2026-02-16 09:15+11', 'project', 'a1000000-0000-4000-a000-000000000001',
   (select id from profiles where role = 'admin' order by created_at limit 1), '2026-01-28 10:20+11');

insert into quote_sections (id, quote_id, position, title) values
  ('e2000000-0000-4000-a000-000000000011', 'e1000000-0000-4000-a000-000000000001', 0, 'Excavation & drainage'),
  ('e2000000-0000-4000-a000-000000000012', 'e1000000-0000-4000-a000-000000000001', 1, 'Reinstatement'),
  ('e2000000-0000-4000-a000-000000000021', 'e1000000-0000-4000-a000-000000000002', 0, 'Preparation & access'),
  ('e2000000-0000-4000-a000-000000000022', 'e1000000-0000-4000-a000-000000000002', 1, 'Membrane & finishes'),
  ('e2000000-0000-4000-a000-000000000031', 'e1000000-0000-4000-a000-000000000003', 0, 'Expansion joint works'),
  ('e2000000-0000-4000-a000-000000000041', 'e1000000-0000-4000-a000-000000000004', 0, 'Demolition & excavation'),
  ('e2000000-0000-4000-a000-000000000042', 'e1000000-0000-4000-a000-000000000004', 1, 'New wall construction'),
  ('e2000000-0000-4000-a000-000000000051', 'e1000000-0000-4000-a000-000000000005', 0, 'Bank stabilisation works'),
  ('e2000000-0000-4000-a000-000000000052', 'e1000000-0000-4000-a000-000000000005', 1, 'Preliminaries, environment & traffic');

-- Q-0001 lines (total sell 48,428.10)
insert into quote_lines (quote_id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell) values
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000011', 0, 'Excavator 13t wet hire — trench excavation', 4, 'day', 1450.00, 25, 1812.50),
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000011', 1, 'Labourer — pipe laying crew', 64, 'hr', 55.00, 35, 74.25),
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000011', 2, 'Leading hand', 32, 'hr', 68.00, 35, 91.80),
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000011', 3, '375mm RCP supply & lay', 48, 'm', 185.00, 30, 240.50),
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000011', 4, 'Stormwater pit construction 900x900', 4, 'ea', 1450.00, 30, 1885.00),
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000012', 0, 'Concrete N32 reinstatement', 18, 'm3', 285.00, 30, 370.50),
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000012', 1, 'Reo mesh SL82', 24, 'sheet', 95.00, 35, 128.25),
  ('e1000000-0000-4000-a000-000000000001', 'e2000000-0000-4000-a000-000000000012', 2, 'Traffic control', 3, 'day', 1350.00, 15, 1552.50);

-- Q-0002 lines (total sell 86,242.00)
insert into quote_lines (quote_id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell) values
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000021', 0, 'Scaffold hire — 6 weeks', 6, 'week', 1200.00, 18, 1416.00),
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000021', 1, 'Demolish existing tiles & screed', 120, 'm2', 65.00, 35, 87.75),
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000021', 2, 'Labourer — preparation', 90, 'hr', 55.00, 35, 74.25),
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000022', 0, 'Waterproof membrane system, two coats', 380, 'm2', 42.00, 45, 60.90),
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000022', 1, 'Screed to falls', 120, 'm2', 85.00, 35, 114.75),
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000022', 2, 'Tile supply & lay', 120, 'm2', 110.00, 35, 148.50),
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000022', 3, 'Balustrade refix & seal', 22, 'ea', 145.00, 35, 195.75),
  ('e1000000-0000-4000-a000-000000000002', 'e2000000-0000-4000-a000-000000000022', 4, 'Site shed', 2, 'month', 650.00, 15, 747.50);

-- Q-0003 lines (total sell 23,040.00)
insert into quote_lines (quote_id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell) values
  ('e1000000-0000-4000-a000-000000000003', 'e2000000-0000-4000-a000-000000000031', 0, 'Saw cut & remove failed joint seals', 180, 'm', 28.00, 40, 39.20),
  ('e1000000-0000-4000-a000-000000000003', 'e2000000-0000-4000-a000-000000000031', 1, 'Spalling repair mortar to joint edges', 40, 'bag', 48.00, 50, 72.00),
  ('e1000000-0000-4000-a000-000000000003', 'e2000000-0000-4000-a000-000000000031', 2, 'Install proprietary expansion joint system', 180, 'm', 52.00, 40, 72.80);

-- Q-0004 lines (total sell 63,615.00)
insert into quote_lines (quote_id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell) values
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000041', 0, 'Demolish failed wall & cart away', 1, 'ea', 4800.00, 30, 6240.00),
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000041', 1, 'Excavator 5t wet hire', 5, 'day', 950.00, 25, 1187.50),
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000041', 2, 'Tipping fees — clean fill', 60, 't', 35.00, 25, 43.75),
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000042', 0, 'Concrete sleeper retaining wall H1.8m supply & install', 32, 'm', 780.00, 35, 1053.00),
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000042', 1, 'Drainage aggregate & ag line', 32, 'm', 95.00, 30, 123.50),
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000042', 2, 'Labourer', 80, 'hr', 55.00, 35, 74.25),
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000042', 3, 'Leading hand', 40, 'hr', 68.00, 35, 91.80),
  ('e1000000-0000-4000-a000-000000000004', 'e2000000-0000-4000-a000-000000000042', 4, 'Traffic control', 1, 'day', 1350.00, 15, 1552.50);

-- Q-0005 lines (total sell exactly 850,000.00 = P-0001 contract sum)
insert into quote_lines (quote_id, section_id, position, description, qty, unit, unit_cost, markup_pct, unit_sell) values
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000051', 0, 'Excavation & shaping of bank — 1.2km reach', 1, 'ea', 120000.00, 25, 150000.00),
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000051', 1, 'Rock revetment supply & place', 2600, 't', 95.00, 30, 123.50),
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000051', 2, 'Gabion baskets supply & install', 420, 'm2', 210.00, 35, 283.50),
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000051', 3, 'Geotextile & bedding', 5200, 'm2', 8.50, 40, 11.90),
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000052', 0, 'Site establishment & preliminaries', 1, 'ea', 62000.00, 30, 80600.00),
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000052', 1, 'Traffic management', 1, 'ea', 56000.00, 15, 64400.00),
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000052', 2, 'Environmental controls & dewatering', 1, 'ea', 28000.00, 35, 37800.00),
  ('e1000000-0000-4000-a000-000000000005', 'e2000000-0000-4000-a000-000000000052', 3, 'Revegetation & topsoil', 1, 'ea', 12120.00, 25, 15150.00);

-- ─── 7. Jobs ─────────────────────────────────────────────────────────────────
insert into jobs (id, number, client_id, site_id, quote_id, title, description, status, scheduled_start, scheduled_end, completed_at, supervisor_id) values
  ('f1000000-0000-4000-a000-000000000001', 'J-0001', 'c1000000-0000-4000-a000-000000000005', 'c2000000-0000-4000-a000-000000000051', 'e1000000-0000-4000-a000-000000000004',
   'Storm damage retaining wall rebuild', 'Rebuild collapsed wall per accepted quote Q-0004. Insurance claim ref SB-2026-08831.', 'scheduled', '2026-06-15', '2026-06-19', null, 'aa000000-0000-4000-a000-000000000001'),
  ('f1000000-0000-4000-a000-000000000002', 'J-0002', 'c1000000-0000-4000-a000-000000000006', 'c2000000-0000-4000-a000-000000000061', null,
   'Facade crack injection — Pinnacle', 'Epoxy injection of structural cracks, east elevation levels 2-4. Rope access.', 'in_progress', '2026-06-04', '2026-06-17', null, 'aa000000-0000-4000-a000-000000000001'),
  ('f1000000-0000-4000-a000-000000000003', 'J-0003', 'c1000000-0000-4000-a000-000000000003', 'c2000000-0000-4000-a000-000000000032', null,
   'Driveway culvert replacement', 'Replace crushed 450 RCP culvert under depot access driveway, incl. headwalls.', 'scheduled', '2026-06-22', '2026-06-24', null, 'aa000000-0000-4000-a000-000000000001'),
  ('f1000000-0000-4000-a000-000000000004', 'J-0004', 'c1000000-0000-4000-a000-000000000006', 'c2000000-0000-4000-a000-000000000062', null,
   'Basement waterproofing remediation', 'Injection and membrane repairs to leaking basement carpark walls, bays 12-18.', 'in_progress', '2026-06-01', '2026-06-19', null, 'aa000000-0000-4000-a000-000000000001'),
  ('f1000000-0000-4000-a000-000000000005', 'J-0005', 'c1000000-0000-4000-a000-000000000004', 'c2000000-0000-4000-a000-000000000041', null,
   'Loading dock spalling repairs', 'Concrete spalling repairs to loading dock soffit and columns per CoreFM WO-118842.', 'completed', '2026-05-26', '2026-06-03', '2026-06-04 16:00+10', 'aa000000-0000-4000-a000-000000000001'),
  ('f1000000-0000-4000-a000-000000000006', 'J-0006', 'c1000000-0000-4000-a000-000000000001', 'c2000000-0000-4000-a000-000000000011', null,
   'Trip hazard grinding & path repairs', 'Grind trip hazards and replace cracked path panels around Lakeview site perimeter.', 'invoiced', '2026-05-18', '2026-05-21', '2026-05-22 15:30+10', 'aa000000-0000-4000-a000-000000000001');

-- J-0002 checklist (2 of 4 done), work log, costs
insert into job_checklist_items (job_id, position, text, done, done_by, done_at) values
  ('f1000000-0000-4000-a000-000000000002', 0, 'Site induction & SWMS signed', true, 'aa000000-0000-4000-a000-000000000001', '2026-06-04 08:10+10'),
  ('f1000000-0000-4000-a000-000000000002', 1, 'Rope access anchors installed & certification sighted', true, 'aa000000-0000-4000-a000-000000000001', '2026-06-05 14:40+10'),
  ('f1000000-0000-4000-a000-000000000002', 2, 'Crack injection — east elevation complete', false, null, null),
  ('f1000000-0000-4000-a000-000000000002', 3, 'Final inspection, photos & strata sign-off', false, null, null);

insert into work_logs (job_id, date, notes, created_by) values
  ('f1000000-0000-4000-a000-000000000002', '2026-06-05', 'Anchors installed and proof-tested. Commenced crack mapping on east elevation.', 'aa000000-0000-4000-a000-000000000001'),
  ('f1000000-0000-4000-a000-000000000002', '2026-06-10', 'Injection ~60% complete on east elevation. Two additional cracks found near level 3 slab edge — flagged for possible variation.', 'aa000000-0000-4000-a000-000000000001');

insert into costs (parent_type, parent_id, cost_code_id, date, description, amount, source, created_by) values
  ('job', 'f1000000-0000-4000-a000-000000000002', (select id from cost_codes where code = '30'), '2026-06-05', 'Epoxy injection resin & packers', 1800.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('job', 'f1000000-0000-4000-a000-000000000002', (select id from cost_codes where code = '40'), '2026-06-09', 'Rope access crew — week 1', 3200.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1));

-- ─── 8. Invoice INV-0001 for J-0006 (sent 18 days ago, 14-day terms, OVERDUE,
--        total 12,399.75 inc GST, part-paid 6,000) ───────────────────────────
insert into invoices (id, number, job_id, client_id, status, issue_date, due_date, gst_rate, sent_at) values
  ('ee000000-0000-4000-a000-000000000001', 'INV-0001', 'f1000000-0000-4000-a000-000000000006', 'c1000000-0000-4000-a000-000000000001',
   'sent', '2026-05-25', '2026-06-08', 10, '2026-05-25 10:15+10');

-- subtotal 11,272.50 / GST 1,127.25 / total 12,399.75
insert into invoice_lines (invoice_id, position, description, qty, unit, unit_sell) values
  ('ee000000-0000-4000-a000-000000000001', 0, 'Grind concrete trip hazards', 42, 'ea', 95.00),
  ('ee000000-0000-4000-a000-000000000001', 1, 'Remove & replace cracked path panels', 18, 'm2', 285.00),
  ('ee000000-0000-4000-a000-000000000001', 2, 'Traffic control during works', 1, 'day', 1552.50),
  ('ee000000-0000-4000-a000-000000000001', 3, 'Tipping & disposal', 1, 'ea', 600.00);

insert into payments (invoice_id, date, amount, method, reference) values
  ('ee000000-0000-4000-a000-000000000001', '2026-06-02', 6000.00, 'eft', 'EFT-88231');

-- ─── 9. Projects ─────────────────────────────────────────────────────────────
insert into projects (id, number, client_id, site_id, quote_id, name, description, status, contract_type, contract_sum,
                      retention_pct, retention_cap_pct, pc_release_fraction, dlp_months, client_ref, superintendent,
                      start_date, claim_day, supervisor_id) values
  ('a1000000-0000-4000-a000-000000000001', 'P-0001', 'c1000000-0000-4000-a000-000000000003', 'c2000000-0000-4000-a000-000000000031', 'e1000000-0000-4000-a000-000000000005',
   'Riverbank Stabilisation Stage 2', 'Rock revetment and gabion stabilisation of 1.2km reach of the Cooks River foreshore, incl. environmental controls and revegetation.',
   'active', 'Lump sum (AS 4000)', 850000.00, 10, 5, 0.5, 12, 'BC-RFT-2025-114', 'M. Calloway — Bayside Council Infrastructure',
   '2026-02-23', 25, 'aa000000-0000-4000-a000-000000000001'),
  ('a1000000-0000-4000-a000-000000000002', 'P-0002', 'c1000000-0000-4000-a000-000000000006', 'c2000000-0000-4000-a000-000000000061', null,
   'Carpark Remediation — Harbourview', 'Remediation of failed topping slab and waterproofing to podium carpark deck, Harbourview Towers.',
   'active', 'Lump sum', 240000.00, 10, 5, 0.5, 12, 'PSG-2026-077', 'R. Whitfield — Coster Consulting',
   '2026-05-22', 15, 'aa000000-0000-4000-a000-000000000001');

-- Budget — P-0001 (sums to 850,000)
insert into budget_lines (id, project_id, cost_code_id, description, budget_amount, position) values
  ('b1000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '10'), 'Site labour', 180000.00, 1),
  ('b1000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '20'), 'Plant & equipment', 160000.00, 2),
  ('b1000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '30'), 'Materials — rock, gabions, geotextile', 145000.00, 3),
  ('b1000000-0000-4000-a000-000000000004', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '40'), 'Subcontractors', 220000.00, 4),
  ('b1000000-0000-4000-a000-000000000005', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '60'), 'Traffic control', 65000.00, 5),
  ('b1000000-0000-4000-a000-000000000006', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '90'), 'Preliminaries & site establishment', 80000.00, 6);

-- Budget — P-0002 (sums to 240,000)
insert into budget_lines (id, project_id, cost_code_id, description, budget_amount, position) values
  ('b2000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000002', (select id from cost_codes where code = '10'), 'Labour & access', 48000.00, 1),
  ('b2000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000002', (select id from cost_codes where code = '30'), 'Materials & membrane', 64000.00, 2),
  ('b2000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000002', (select id from cost_codes where code = '40'), 'Subcontractors', 98000.00, 3),
  ('b2000000-0000-4000-a000-000000000004', 'a1000000-0000-4000-a000-000000000002', (select id from cost_codes where code = '90'), 'Preliminaries', 30000.00, 4);

-- ─── 10. Variations (P-0001) ────────────────────────────────────────────────
insert into variations (id, project_id, number, title, description, status, cost_estimate, sell_amount, client_ref, time_bar_date, submitted_at, decided_at) values
  ('da000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', 1, 'Rock excavation latent condition',
   'Latent rock encountered in cut CH 420-480; hydraulic breaker and additional excavation required.', 'approved',
   31500.00, 42500.00, 'SI-014', '2026-04-18', '2026-04-10 09:00+10', '2026-04-24 14:30+10'),
  ('da000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', 2, 'Additional gabion course',
   'Superintendent direction to add a fourth gabion course CH 300-380 following revised flood modelling.', 'submitted',
   13800.00, 18750.00, 'SI-019', '2026-06-26', '2026-06-05 11:20+10', null),
  ('da000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000001', 3, 'Dewatering extension',
   'Extended dewatering required after May rainfall; pumping beyond allowance in contract.', 'notified',
   9000.00, 12000.00, null, '2026-06-16', null, null);

-- ─── 11. Claims (P-0001) — engine-exact snapshots ───────────────────────────
-- Claim 1 (certified): gross 118,000 / retention 11,800 (10%, cap headroom
-- 42,500 on base 850k) / subtotal 106,200 / GST 10,620 / total 116,820 /
-- claimed-to-date 118,000. Certified in full (inc GST).
-- Claim 2 (submitted): gross 96,500 / retention 9,650 (cap 5% × 892,500 =
-- 44,625, headroom 32,825) / subtotal 86,850 / GST 8,685 / total 95,535 /
-- claimed-to-date 214,500.
insert into claims (id, project_id, number, status, reference_date, gst_rate,
                    gross_this_claim, retention_this_claim, subtotal, gst, total_inc_gst, total_claimed_to_date,
                    submitted_at, certified_amount, certified_at, schedule_received_at, paid_at) values
  ('ca000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', 1, 'certified', '2026-04-25', 10,
   118000.00, 11800.00, 106200.00, 10620.00, 116820.00, 118000.00,
   '2026-04-23 15:00+10', 116820.00, '2026-05-04 10:30+10', '2026-05-04', null),
  ('ca000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', 2, 'submitted', '2026-05-25', 10,
   96500.00, 9650.00, 86850.00, 8685.00, 95535.00, 214500.00,
   '2026-05-26 11:00+10', null, null, null, null);

-- Claim 1 lines (budget lines only — V1 approved after submission)
insert into claim_lines (claim_id, source_type, source_id, description, line_value, pct_complete, previous_claimed, claimed_to_date, this_claim) values
  ('ca000000-0000-4000-a000-000000000001', 'budget_line', 'b1000000-0000-4000-a000-000000000001', 'Site labour', 180000.00, 15, 0, 27000.00, 27000.00),
  ('ca000000-0000-4000-a000-000000000001', 'budget_line', 'b1000000-0000-4000-a000-000000000002', 'Plant & equipment', 160000.00, 18, 0, 28800.00, 28800.00),
  ('ca000000-0000-4000-a000-000000000001', 'budget_line', 'b1000000-0000-4000-a000-000000000003', 'Materials — rock, gabions, geotextile', 145000.00, 12, 0, 17400.00, 17400.00),
  ('ca000000-0000-4000-a000-000000000001', 'budget_line', 'b1000000-0000-4000-a000-000000000004', 'Subcontractors', 220000.00, 12, 0, 26400.00, 26400.00),
  ('ca000000-0000-4000-a000-000000000001', 'budget_line', 'b1000000-0000-4000-a000-000000000005', 'Traffic control', 65000.00, 16, 0, 10400.00, 10400.00),
  ('ca000000-0000-4000-a000-000000000001', 'budget_line', 'b1000000-0000-4000-a000-000000000006', 'Preliminaries & site establishment', 80000.00, 10, 0, 8000.00, 8000.00);

-- Claim 2 lines (previous = claim 1 claimed-to-date; V1 enters at 40%)
insert into claim_lines (claim_id, source_type, source_id, description, line_value, pct_complete, previous_claimed, claimed_to_date, this_claim) values
  ('ca000000-0000-4000-a000-000000000002', 'budget_line', 'b1000000-0000-4000-a000-000000000001', 'Site labour', 180000.00, 24, 27000.00, 43200.00, 16200.00),
  ('ca000000-0000-4000-a000-000000000002', 'budget_line', 'b1000000-0000-4000-a000-000000000002', 'Plant & equipment', 160000.00, 28, 28800.00, 44800.00, 16000.00),
  ('ca000000-0000-4000-a000-000000000002', 'budget_line', 'b1000000-0000-4000-a000-000000000003', 'Materials — rock, gabions, geotextile', 145000.00, 22, 17400.00, 31900.00, 14500.00),
  ('ca000000-0000-4000-a000-000000000002', 'budget_line', 'b1000000-0000-4000-a000-000000000004', 'Subcontractors', 220000.00, 20.5, 26400.00, 45100.00, 18700.00),
  ('ca000000-0000-4000-a000-000000000002', 'budget_line', 'b1000000-0000-4000-a000-000000000005', 'Traffic control', 65000.00, 26, 10400.00, 16900.00, 6500.00),
  ('ca000000-0000-4000-a000-000000000002', 'budget_line', 'b1000000-0000-4000-a000-000000000006', 'Preliminaries & site establishment', 80000.00, 19.5, 8000.00, 15600.00, 7600.00),
  ('ca000000-0000-4000-a000-000000000002', 'variation',   'da000000-0000-4000-a000-000000000001', 'V1 — Rock excavation latent condition', 42500.00, 40, 0, 17000.00, 17000.00);

insert into retention_entries (project_id, claim_id, kind, amount, date, notes) values
  ('a1000000-0000-4000-a000-000000000001', 'ca000000-0000-4000-a000-000000000001', 'withheld', 11800.00, '2026-04-23', 'Withheld on claim 1'),
  ('a1000000-0000-4000-a000-000000000001', 'ca000000-0000-4000-a000-000000000002', 'withheld', 9650.00, '2026-05-26', 'Withheld on claim 2');

-- P-0002 claim 1 (draft — totals stay null until submission)
insert into claims (id, project_id, number, status, reference_date, gst_rate) values
  ('ca000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000002', 1, 'draft', '2026-06-15', 10);

insert into claim_lines (claim_id, source_type, source_id, description, line_value, pct_complete, previous_claimed, claimed_to_date, this_claim) values
  ('ca000000-0000-4000-a000-000000000003', 'budget_line', 'b2000000-0000-4000-a000-000000000001', 'Labour & access', 48000.00, 0, 0, 0, 0),
  ('ca000000-0000-4000-a000-000000000003', 'budget_line', 'b2000000-0000-4000-a000-000000000002', 'Materials & membrane', 64000.00, 0, 0, 0, 0),
  ('ca000000-0000-4000-a000-000000000003', 'budget_line', 'b2000000-0000-4000-a000-000000000003', 'Subcontractors', 98000.00, 0, 0, 0, 0),
  ('ca000000-0000-4000-a000-000000000003', 'budget_line', 'b2000000-0000-4000-a000-000000000004', 'Preliminaries', 30000.00, 8, 0, 2400.00, 2400.00);

-- ─── 12. Packages, RFQs, package quotes, commitments ────────────────────────
insert into packages (id, project_id, name, budget_amount, cost_code_id, owner_id, let_by_date, status, notes) values
  ('a2000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', 'Traffic management', 65000.00,
   (select id from cost_codes where code = '60'), 'aa000000-0000-4000-a000-000000000001', '2026-03-06', 'awarded',
   'Awarded to Apex — best price and council-approved TCPs.'),
  ('a2000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', 'Gabion supply & install', 110000.00,
   (select id from cost_codes where code = '40'), 'aa000000-0000-4000-a000-000000000001', '2026-06-26', 'quotes_in',
   'DigDeep quote in and under budget. Chasing SteelFix for a second price.'),
  ('a2000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000001', 'Revegetation works', 28000.00,
   (select id from cost_codes where code = '80'), 'aa000000-0000-4000-a000-000000000001', '2026-07-03', 'planned', null),
  ('a2000000-0000-4000-a000-000000000004', 'a1000000-0000-4000-a000-000000000002', 'Waterproofing membrane subbie', 38000.00,
   (select id from cost_codes where code = '40'), 'aa000000-0000-4000-a000-000000000001', '2026-06-22', 'quotes_in',
   'AquaSeal priced 31,900 vs 38,000 budget. ProForm yet to respond.');

insert into package_rfqs (package_id, vendor_id, status, invited_at) values
  ('a2000000-0000-4000-a000-000000000001', 'dd000000-0000-4000-a000-000000000001', 'quoted',  '2026-02-24 10:00+11'),
  ('a2000000-0000-4000-a000-000000000001', 'dd000000-0000-4000-a000-000000000002', 'quoted',  '2026-02-24 10:05+11'),
  ('a2000000-0000-4000-a000-000000000002', 'dd000000-0000-4000-a000-000000000002', 'quoted',  '2026-06-02 09:00+10'),
  ('a2000000-0000-4000-a000-000000000002', 'dd000000-0000-4000-a000-000000000003', 'invited', '2026-06-02 09:05+10'),
  ('a2000000-0000-4000-a000-000000000004', 'dd000000-0000-4000-a000-000000000004', 'quoted',  '2026-06-04 14:00+10'),
  ('a2000000-0000-4000-a000-000000000004', 'dd000000-0000-4000-a000-000000000007', 'invited', '2026-06-04 14:05+10');

insert into package_quotes (package_id, vendor_id, amount, inclusions, exclusions, recommended, received_at) values
  ('a2000000-0000-4000-a000-000000000001', 'dd000000-0000-4000-a000-000000000001', 58400.00,
   'TCPs, permits, all signage and devices, up to 140 shifts', 'Night works loading, police escorts', true,  '2026-03-02'),
  ('a2000000-0000-4000-a000-000000000001', 'dd000000-0000-4000-a000-000000000002', 61000.00,
   'Signage and devices, 140 shifts', 'TCP design, permits', false, '2026-03-03'),
  ('a2000000-0000-4000-a000-000000000002', 'dd000000-0000-4000-a000-000000000002', 96500.00,
   'Supply, assembly and placement of gabions CH 300-420, rock fill from site stockpile', 'Geotextile, survey set-out', true, '2026-06-08'),
  ('a2000000-0000-4000-a000-000000000004', 'dd000000-0000-4000-a000-000000000004', 31900.00,
   'Two-coat membrane to 480m2 deck, detail to drains and upturns, 10yr warranty', 'Topping slab repairs, tiling', false, '2026-06-09');

insert into commitments (id, project_id, kind, vendor_id, package_id, cost_code_id, description, amount, status, date) values
  ('cc000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', 'subcontract',
   'dd000000-0000-4000-a000-000000000001', 'a2000000-0000-4000-a000-000000000001',
   (select id from cost_codes where code = '60'), 'Traffic management — awarded subcontract (Apex)', 58400.00, 'active', '2026-03-09');

-- ─── 13. Purchase orders ─────────────────────────────────────────────────────
insert into purchase_orders (id, number, project_id, job_id, vendor_id, status, issue_date, notes) values
  ('ab000000-0000-4000-a000-000000000001', 'PO-0001', 'a1000000-0000-4000-a000-000000000001', null, 'dd000000-0000-4000-a000-000000000002', 'issued', '2026-03-02', 'Bulk earthworks plant for bank shaping.'),
  ('ab000000-0000-4000-a000-000000000002', 'PO-0002', 'a1000000-0000-4000-a000-000000000001', null, 'dd000000-0000-4000-a000-000000000006', 'issued', '2026-03-16', 'Spoil cartage and tipping.'),
  ('ab000000-0000-4000-a000-000000000003', 'PO-0003', 'a1000000-0000-4000-a000-000000000001', null, 'dd000000-0000-4000-a000-000000000007', 'draft',  null, 'Capping beam concrete — awaiting final pour quantities.'),
  ('ab000000-0000-4000-a000-000000000004', 'PO-0004', 'a1000000-0000-4000-a000-000000000002', null, 'dd000000-0000-4000-a000-000000000003', 'issued', '2026-06-03', 'Reinforcement for topping slab repairs.');

-- PO-0001 DigDeep — 84,500 (cc 20)
insert into po_lines (po_id, position, description, cost_code_id, qty, unit, unit_cost) values
  ('ab000000-0000-4000-a000-000000000001', 0, 'Excavator 21t + operator — bank shaping', (select id from cost_codes where code = '20'), 28, 'day', 1850.00),
  ('ab000000-0000-4000-a000-000000000001', 1, 'Moxy 6x6 dump truck wet hire', (select id from cost_codes where code = '20'), 18, 'day', 1450.00),
  ('ab000000-0000-4000-a000-000000000001', 2, 'Float mobilisation / demobilisation', (select id from cost_codes where code = '20'), 4, 'ea', 1650.00);

-- PO-0002 GreenTip — 36,200 (cc 70)
insert into po_lines (po_id, position, description, cost_code_id, qty, unit, unit_cost) values
  ('ab000000-0000-4000-a000-000000000002', 0, 'Tipping — clean fill', (select id from cost_codes where code = '70'), 760, 't', 35.00),
  ('ab000000-0000-4000-a000-000000000002', 1, 'Tipping — contaminated spoil', (select id from cost_codes where code = '70'), 24, 't', 285.00),
  ('ab000000-0000-4000-a000-000000000002', 2, 'Bin exchanges — general waste', (select id from cost_codes where code = '70'), 12, 'ea', 230.00);

-- PO-0003 ProForm — 52,000 draft (not counted in committed)
insert into po_lines (po_id, position, description, cost_code_id, qty, unit, unit_cost) values
  ('ab000000-0000-4000-a000-000000000003', 0, 'Supply & place N32 concrete — capping beam', (select id from cost_codes where code = '30'), 130, 'm3', 285.00),
  ('ab000000-0000-4000-a000-000000000003', 1, 'Concrete pump hire', (select id from cost_codes where code = '30'), 5, 'day', 1190.00),
  ('ab000000-0000-4000-a000-000000000003', 2, 'Place & finish crew', (select id from cost_codes where code = '40'), 1, 'ea', 9000.00);

-- PO-0004 SteelFix — 9,800 (cc 30, P-0002)
insert into po_lines (po_id, position, description, cost_code_id, qty, unit, unit_cost) values
  ('ab000000-0000-4000-a000-000000000004', 0, 'SL82 mesh supply', (select id from cost_codes where code = '30'), 64, 'sheet', 95.00),
  ('ab000000-0000-4000-a000-000000000004', 1, 'N12 bar — assorted lengths', (select id from cost_codes where code = '30'), 1.2, 't', 1850.00),
  ('ab000000-0000-4000-a000-000000000004', 2, 'Bar chairs & tie wire', (select id from cost_codes where code = '30'), 1, 'ea', 1500.00);

-- ─── 14. Costs — P-0001 actuals (total exactly 210,000) ──────────────────────
insert into costs (parent_type, parent_id, cost_code_id, date, description, amount, source, created_by) values
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '10'), '2026-03-06', 'Site crew wages — March (fortnight 1)', 14200.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '10'), '2026-03-20', 'Site crew wages — March (fortnight 2)', 15800.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '10'), '2026-04-17', 'Site crew wages — April', 29400.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '10'), '2026-05-15', 'Site crew wages — May', 27600.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '20'), '2026-03-31', 'DigDeep claim 1 — plant hire March (PO-0001)', 28500.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '20'), '2026-04-30', 'DigDeep claim 2 — plant hire April (PO-0001)', 31200.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '30'), '2026-04-08', 'Rock supply — first deliveries', 22400.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '30'), '2026-05-12', 'Gabion baskets & geotextile', 14100.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '60'), '2026-04-30', 'Apex traffic control — progress claim 1', 16400.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('project', 'a1000000-0000-4000-a000-000000000001', (select id from cost_codes where code = '90'), '2026-03-02', 'Site establishment, sheds & fencing', 10400.00, 'manual', (select id from profiles where role = 'admin' order by created_at limit 1));

-- ─── 15. Schedule (this week Mon 2026-06-08 .. Fri 2026-06-12) ───────────────
insert into assignments (id, date, user_id, job_id, project_id, created_by) values
  ('e5000000-0000-4000-a000-000000000001', '2026-06-08', 'aa000000-0000-4000-a000-000000000001', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000002', '2026-06-08', 'aa000000-0000-4000-a000-000000000002', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000003', '2026-06-08', 'aa000000-0000-4000-a000-000000000003', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000004', '2026-06-09', 'aa000000-0000-4000-a000-000000000001', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000005', '2026-06-09', 'aa000000-0000-4000-a000-000000000002', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000006', '2026-06-09', 'aa000000-0000-4000-a000-000000000003', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000007', '2026-06-10', 'aa000000-0000-4000-a000-000000000001', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000008', '2026-06-10', 'aa000000-0000-4000-a000-000000000002', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000009', '2026-06-10', 'aa000000-0000-4000-a000-000000000003', null, 'a1000000-0000-4000-a000-000000000001', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000010', '2026-06-11', 'aa000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000002', null, (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000011', '2026-06-11', 'aa000000-0000-4000-a000-000000000003', 'f1000000-0000-4000-a000-000000000004', null, (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000012', '2026-06-12', 'aa000000-0000-4000-a000-000000000002', 'f1000000-0000-4000-a000-000000000002', null, (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('e5000000-0000-4000-a000-000000000013', '2026-06-12', 'aa000000-0000-4000-a000-000000000001', 'f1000000-0000-4000-a000-000000000001', null, (select id from profiles where role = 'admin' order by created_at limit 1));

-- Timesheets: Jack + Mia, closed entries for Tue-Thu on their assigned targets.
insert into timesheet_entries (user_id, assignment_id, job_id, project_id, date, start_at, end_at, approved) values
  ('aa000000-0000-4000-a000-000000000002', 'e5000000-0000-4000-a000-000000000005', null, 'a1000000-0000-4000-a000-000000000001', '2026-06-09', '2026-06-09 06:30+10', '2026-06-09 15:00+10', false),
  ('aa000000-0000-4000-a000-000000000002', 'e5000000-0000-4000-a000-000000000008', null, 'a1000000-0000-4000-a000-000000000001', '2026-06-10', '2026-06-10 07:00+10', '2026-06-10 15:00+10', false),
  ('aa000000-0000-4000-a000-000000000002', 'e5000000-0000-4000-a000-000000000010', 'f1000000-0000-4000-a000-000000000002', null, '2026-06-11', '2026-06-11 07:00+10', '2026-06-11 14:30+10', false),
  ('aa000000-0000-4000-a000-000000000003', 'e5000000-0000-4000-a000-000000000006', null, 'a1000000-0000-4000-a000-000000000001', '2026-06-09', '2026-06-09 06:30+10', '2026-06-09 15:00+10', false),
  ('aa000000-0000-4000-a000-000000000003', 'e5000000-0000-4000-a000-000000000009', null, 'a1000000-0000-4000-a000-000000000001', '2026-06-10', '2026-06-10 07:00+10', '2026-06-10 15:00+10', false),
  ('aa000000-0000-4000-a000-000000000003', 'e5000000-0000-4000-a000-000000000011', 'f1000000-0000-4000-a000-000000000004', null, '2026-06-11', '2026-06-11 07:30+10', '2026-06-11 15:30+10', false);

-- ─── 16. Diaries ─────────────────────────────────────────────────────────────
-- P-0001: 8 weekday entries over the past two weeks (created by Sam).
insert into diaries (id, project_id, date, weather, work_performed, delays, instructions, visitors, created_by) values
  ('d1000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', '2026-06-01', 'Fine, 24C',
   'Rock placement CH 300-360. Prepared gabion bench at CH 320.', null, null, null, 'aa000000-0000-4000-a000-000000000001'),
  ('d1000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', '2026-06-02', 'Fine',
   'Continued rock placement CH 340-380. Geotextile laid CH 300-340.', null, null, null, 'aa000000-0000-4000-a000-000000000001'),
  ('d1000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000001', '2026-06-03', 'Overcast, light wind',
   'Gabion course 1 assembly CH 300-340. Survey set-out for course 2.', null,
   'Superintendent (M. Calloway) directed relocation of silt fence at CH 450 — confirmation issued in writing.',
   'Superintendent site walk 10:00', 'aa000000-0000-4000-a000-000000000001'),
  ('d1000000-0000-4000-a000-000000000004', 'a1000000-0000-4000-a000-000000000001', '2026-06-04', 'Rain — work stopped',
   'Site secured, erosion and sediment controls inspected.',
   'Heavy rain from 09:30, site unworkable. Crew stood down 11:00. River level up approx 400mm.', null, null, 'aa000000-0000-4000-a000-000000000001'),
  ('d1000000-0000-4000-a000-000000000005', 'a1000000-0000-4000-a000-000000000001', '2026-06-05', 'Showers clearing',
   'Pumped out gabion bench. Recommenced gabion assembly after midday.',
   'Half day lost to waterlogged access track.', null, null, 'aa000000-0000-4000-a000-000000000001'),
  ('d1000000-0000-4000-a000-000000000006', 'a1000000-0000-4000-a000-000000000001', '2026-06-08', 'Fine',
   'Rock revetment CH 360-420. Tipper cycling from stockpile all day.', null, null, null, 'aa000000-0000-4000-a000-000000000001'),
  ('d1000000-0000-4000-a000-000000000007', 'a1000000-0000-4000-a000-000000000001', '2026-06-09', 'Fine, hot',
   'Gabion course 2 install CH 300-360. Survey conformance check CH 300-360.', null,
   'Superintendent requested updated dewatering methodology before extension works proceed (ref V3 notification).',
   null, 'aa000000-0000-4000-a000-000000000001'),
  ('d1000000-0000-4000-a000-000000000008', 'a1000000-0000-4000-a000-000000000001', '2026-06-10', 'Partly cloudy',
   'Completed gabion course 2; commenced course 3. Geotextile to CH 440.', null, null, null, 'aa000000-0000-4000-a000-000000000001');

-- Labour rows (Sam/Jack/Mia; short hours on the rain day)
insert into diary_labour (diary_id, user_id, name, trade, headcount, hours)
select d.id, u.uid, u.name, u.trade, 1, case when d.date = '2026-06-04' then 3 when d.date = '2026-06-05' then 5 else 8 end
from diaries d
cross join (values
  ('aa000000-0000-4000-a000-000000000001'::uuid, 'Sam Field', 'Supervisor'),
  ('aa000000-0000-4000-a000-000000000002'::uuid, 'Jack Labour', 'Labourer'),
  ('aa000000-0000-4000-a000-000000000003'::uuid, 'Mia Operator', 'Plant operator')
) as u(uid, name, trade)
where d.project_id = 'a1000000-0000-4000-a000-000000000001';

-- Plant rows (excavator + tipper; idle on the rain day)
insert into diary_plant (diary_id, plant_id, name, status, hours)
select d.id, p.pid, p.name,
       case when d.date = '2026-06-04' then 'idle' else 'working' end,
       case when d.date = '2026-06-04' then 0 when d.date = '2026-06-05' then 4 else p.hours end
from diaries d
cross join (values
  ('bb000000-0000-4000-a000-000000000002'::uuid, 'Excavator 13t — Cat 313GC', 8.0),
  ('bb000000-0000-4000-a000-000000000004'::uuid, 'Tipper truck — Isuzu FVZ 240', 6.0)
) as p(pid, name, hours)
where d.project_id = 'a1000000-0000-4000-a000-000000000001';

-- P-0002: 3 entries
insert into diaries (id, project_id, date, weather, work_performed, created_by) values
  ('d2000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000002', '2026-05-28', 'Fine',
   'Site establishment. Set out and survey of podium carpark deck. Hoarding to lobby entry.', 'aa000000-0000-4000-a000-000000000001'),
  ('d2000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000002', '2026-06-03', 'Overcast',
   'Demolition of failed topping slab — bays 1-4. Spoil to bins.', 'aa000000-0000-4000-a000-000000000001'),
  ('d2000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000002', '2026-06-10', 'Fine',
   'Concrete repairs to deck soffit. Surface prep for membrane — bays 1-4.', 'aa000000-0000-4000-a000-000000000001');

insert into diary_labour (diary_id, user_id, name, trade, headcount, hours) values
  ('d2000000-0000-4000-a000-000000000001', 'aa000000-0000-4000-a000-000000000001', 'Sam Field', 'Supervisor', 1, 4),
  ('d2000000-0000-4000-a000-000000000002', null, 'DemoWorks crew', 'Demolition', 3, 8),
  ('d2000000-0000-4000-a000-000000000003', null, 'Concrete repair crew', 'Remedial', 2, 8);

-- ─── 17. SWMS ────────────────────────────────────────────────────────────────
insert into swms_templates (id, title, body, hazards, version, active) values
  ('a7000000-0000-4000-a000-000000000001', 'Excavation >1.5m & trenching',
   'Safe work method for bulk and trench excavation deeper than 1.5m, including benching, battering, shoring and work near services.',
   '[
     {"task":"Excavate trench or bank cut >1.5m","hazards":"Trench/bank collapse, engulfment","risk":"H","controls":"Bench, batter or shore to geotech requirements; no entry to unprotected excavation; spoil and plant min 1m from edge; daily inspection by competent person","residual_risk":"M"},
     {"task":"Plant operating near excavation","hazards":"Plant rollover into excavation; workers struck by slewing plant","risk":"H","controls":"3m exclusion zone with spotter; positive comms (two-way) between operator and ground crew; travel paths parallel to edge","residual_risk":"M"},
     {"task":"Breaking ground near services","hazards":"Contact with live electrical, gas or comms services","risk":"H","controls":"Current DBYD plans on site; service locator scan; pothole by hand within 500mm of marked services; permit to dig signed daily","residual_risk":"L"},
     {"task":"Access and egress","hazards":"Falls into excavation","risk":"M","controls":"Ladder access within 9m of any worker; edge barricading and signage; task lighting for early starts","residual_risk":"L"},
     {"task":"Water ingress after rain","hazards":"Flooding of excavation, bank instability","risk":"M","controls":"Dewatering pump on standby; inspect batters after rain before re-entry; stop work if water rising","residual_risk":"L"}
   ]'::jsonb, 1, true),
  ('a7000000-0000-4000-a000-000000000002', 'Concrete spalling repair — height work',
   'Safe work method for concrete spalling repair from rope access or EWP, including breakout, reinforcement treatment and reinstatement.',
   '[
     {"task":"Rope access / EWP positioning","hazards":"Fall from height","risk":"H","controls":"IRATA-certified technicians; twin-rope systems with independent anchors; EWP operators hold HRWL; harness and lanyard inspected daily","residual_risk":"M"},
     {"task":"Concrete breakout","hazards":"Silica dust inhalation","risk":"H","controls":"On-tool dust extraction or wet cutting; P2 respirators fit-tested; exclusion zone below work area","residual_risk":"M"},
     {"task":"Work above public areas","hazards":"Falling objects striking public","risk":"H","controls":"Overhead protection / hoarding; tool lanyards on all hand tools; drop zones barricaded with spotter","residual_risk":"L"},
     {"task":"Epoxy and repair mortar use","hazards":"Skin/eye contact with hazardous chemicals","risk":"M","controls":"SDS on site; nitrile gloves and safety glasses; mix in ventilated area; eye wash available","residual_risk":"L"},
     {"task":"Manual handling of repair materials","hazards":"Musculoskeletal strain","risk":"M","controls":"20kg bag limit per person; mechanical lifting to work deck; team lifts for awkward loads","residual_risk":"L"}
   ]'::jsonb, 1, true),
  ('a7000000-0000-4000-a000-000000000003', 'Working near live traffic',
   'Safe work method for works on or adjacent to trafficked roadways under an approved Traffic Control Plan.',
   '[
     {"task":"Set up / pack down of traffic control","hazards":"Workers struck by live traffic","risk":"H","controls":"Approved TCP and TMP in place; accredited traffic controllers; advance warning signage; setup against traffic flow with shadow vehicle","residual_risk":"M"},
     {"task":"Working within coned-off work zone","hazards":"Vehicle intrusion into work area","risk":"H","controls":"Physical barriers where speed >60km/h; buffer and taper lengths per TCP; no work outside delineated zone; hi-vis Class D/N garments","residual_risk":"M"},
     {"task":"Plant entering / exiting site","hazards":"Collision with passing vehicles or pedestrians","risk":"M","controls":"Traffic controller managed access; reversing only with spotter; flashing beacons and reversing alarms operational","residual_risk":"L"},
     {"task":"Night or low-visibility work","hazards":"Reduced driver visibility of workers","risk":"M","controls":"Tower lighting without glare to traffic; retroreflective garments and delineation; review TCP for night conditions","residual_risk":"L"}
   ]'::jsonb, 1, true);

-- Instances: 2 on P-0001 (v1), 1 on J-0002 (v2 — revised)
insert into swms_instances (id, template_id, project_id, job_id, title, body, hazards, version, status, created_at)
select 'a8000000-0000-4000-a000-000000000001', t.id, 'a1000000-0000-4000-a000-000000000001', null, t.title, t.body, t.hazards, 1, 'active', '2026-02-25 08:00+11'
from swms_templates t where t.id = 'a7000000-0000-4000-a000-000000000001';
insert into swms_instances (id, template_id, project_id, job_id, title, body, hazards, version, status, created_at)
select 'a8000000-0000-4000-a000-000000000002', t.id, 'a1000000-0000-4000-a000-000000000001', null, t.title, t.body, t.hazards, 1, 'active', '2026-02-25 08:05+11'
from swms_templates t where t.id = 'a7000000-0000-4000-a000-000000000003';
insert into swms_instances (id, template_id, project_id, job_id, title, body, hazards, version, status, created_at)
select 'a8000000-0000-4000-a000-000000000003', t.id, null, 'f1000000-0000-4000-a000-000000000002', t.title, t.body, t.hazards, 2, 'active', '2026-06-04 07:30+10'
from swms_templates t where t.id = 'a7000000-0000-4000-a000-000000000002';

-- Signatures: Jack + Mia signed both P-0001 instances at v1.
-- The J-0002 instance (v2) is unsigned — shows as outstanding on the dashboard.
-- Placeholder PNG must exist at attachments/seed/sig-placeholder.png
-- (run supabase/seed/upload-signature-placeholder.mjs).
insert into swms_signatures (swms_instance_id, user_id, name, signature_path, version, signed_at) values
  ('a8000000-0000-4000-a000-000000000001', 'aa000000-0000-4000-a000-000000000002', 'Jack Labour',  'seed/sig-placeholder.png', 1, '2026-06-08 06:45+10'),
  ('a8000000-0000-4000-a000-000000000001', 'aa000000-0000-4000-a000-000000000003', 'Mia Operator', 'seed/sig-placeholder.png', 1, '2026-06-08 06:46+10'),
  ('a8000000-0000-4000-a000-000000000002', 'aa000000-0000-4000-a000-000000000002', 'Jack Labour',  'seed/sig-placeholder.png', 1, '2026-06-08 06:50+10'),
  ('a8000000-0000-4000-a000-000000000002', 'aa000000-0000-4000-a000-000000000003', 'Mia Operator', 'seed/sig-placeholder.png', 1, '2026-06-08 06:51+10');

-- ─── 18. Sequences (next free numbers) ───────────────────────────────────────
update sequences set next_value = 6 where key = 'quote';
update sequences set next_value = 7 where key = 'job';
update sequences set next_value = 3 where key = 'project';
update sequences set next_value = 5 where key = 'po';
update sequences set next_value = 2 where key = 'invoice';

-- ─── 19. Programme (Gantt) tasks ─────────────────────────────────────────────
-- programme
-- P-0001 started ~3.5 months before the demo "today" (2026-06-12): establishment
-- and bulk excavation complete, rock excavation VO and dewatering finished late
-- (behind programme), gabion walls under way, reveg + closeout still to come.
-- P-0002 is ~3 weeks in: prelims done, membrane removal wrapping up.
insert into programme_tasks (id, project_id, name, phase, start_date, end_date, progress_pct, position) values
  -- P-0001 Riverbank Stabilisation Stage 2
  ('e7000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', 'Site establishment',      'Establishment', '2026-02-23', '2026-03-06', 100, 1),
  ('e7000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', 'Survey & set-out',        'Establishment', '2026-03-02', '2026-03-06', 100, 2),
  ('e7000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000001', 'Bulk excavation',         'Bulk works',    '2026-03-09', '2026-03-27', 100, 3),
  ('e7000000-0000-4000-a000-000000000004', 'a1000000-0000-4000-a000-000000000001', 'Rock excavation (VO)',    'Bulk works',    '2026-03-30', '2026-04-10',  90, 4),
  ('e7000000-0000-4000-a000-000000000005', 'a1000000-0000-4000-a000-000000000001', 'Dewatering',              'Bulk works',    '2026-04-06', '2026-05-15',  75, 5),
  ('e7000000-0000-4000-a000-000000000006', 'a1000000-0000-4000-a000-000000000001', 'Gabion walls',            'Structures',    '2026-05-18', '2026-06-19',  40, 6),
  ('e7000000-0000-4000-a000-000000000007', 'a1000000-0000-4000-a000-000000000001', 'Revegetation',            'Structures',    '2026-06-22', '2026-07-03',   0, 7),
  ('e7000000-0000-4000-a000-000000000008', 'a1000000-0000-4000-a000-000000000001', 'Defects & handover',      'Closeout',      '2026-07-06', '2026-07-17',   0, 8),
  -- P-0002 Carpark Remediation — Harbourview
  ('e7000000-0000-4000-a000-000000000009', 'a1000000-0000-4000-a000-000000000002', 'Access & protection',     'Preliminaries', '2026-05-25', '2026-05-29', 100, 1),
  ('e7000000-0000-4000-a000-000000000010', 'a1000000-0000-4000-a000-000000000002', 'Membrane removal',        'Remediation',   '2026-06-01', '2026-06-12',  60, 2),
  ('e7000000-0000-4000-a000-000000000011', 'a1000000-0000-4000-a000-000000000002', 'Substrate repairs',       'Remediation',   '2026-06-08', '2026-06-19',  10, 3),
  ('e7000000-0000-4000-a000-000000000012', 'a1000000-0000-4000-a000-000000000002', 'New membrane install',    'Remediation',   '2026-06-22', '2026-07-03',   0, 4),
  ('e7000000-0000-4000-a000-000000000013', 'a1000000-0000-4000-a000-000000000002', 'Line marking & handover', 'Completion',    '2026-07-06', '2026-07-10',   0, 5);

-- ─── 20. Programme extras (dependencies, baseline, hold points) ──────────────
-- programme extras
-- P-0001: FS chain through the critical path plus dewatering feeding the walls.
-- Baseline mirrors current dates except Gabion walls / Revegetation, whose
-- baselines sit 1 week earlier — both show a red +7d slip against baseline.
insert into programme_links (id, project_id, predecessor_id, successor_id) values
  -- P-0001 Riverbank Stabilisation Stage 2
  ('e8000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', 'e7000000-0000-4000-a000-000000000002', 'e7000000-0000-4000-a000-000000000003'), -- Survey → Bulk excavation
  ('e8000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', 'e7000000-0000-4000-a000-000000000003', 'e7000000-0000-4000-a000-000000000004'), -- Bulk excavation → Rock excavation
  ('e8000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000001', 'e7000000-0000-4000-a000-000000000004', 'e7000000-0000-4000-a000-000000000006'), -- Rock excavation → Gabion walls
  ('e8000000-0000-4000-a000-000000000004', 'a1000000-0000-4000-a000-000000000001', 'e7000000-0000-4000-a000-000000000006', 'e7000000-0000-4000-a000-000000000007'), -- Gabion walls → Revegetation
  ('e8000000-0000-4000-a000-000000000005', 'a1000000-0000-4000-a000-000000000001', 'e7000000-0000-4000-a000-000000000005', 'e7000000-0000-4000-a000-000000000006'), -- Dewatering → Gabion walls
  -- P-0002 Carpark Remediation — Harbourview
  ('e8000000-0000-4000-a000-000000000006', 'a1000000-0000-4000-a000-000000000002', 'e7000000-0000-4000-a000-000000000010', 'e7000000-0000-4000-a000-000000000011'), -- Membrane removal → Substrate repairs
  ('e8000000-0000-4000-a000-000000000007', 'a1000000-0000-4000-a000-000000000002', 'e7000000-0000-4000-a000-000000000011', 'e7000000-0000-4000-a000-000000000012'); -- Substrate repairs → New membrane install

-- Baseline on P-0001 only (P-0002 has none — shows the "no baseline" state).
update programme_tasks set baseline_start = start_date, baseline_end = end_date
  where project_id = 'a1000000-0000-4000-a000-000000000001';
update programme_tasks set baseline_start = '2026-05-11', baseline_end = '2026-06-12'
  where id = 'e7000000-0000-4000-a000-000000000006'; -- Gabion walls slipped a week
update programme_tasks set baseline_start = '2026-06-15', baseline_end = '2026-06-26'
  where id = 'e7000000-0000-4000-a000-000000000007'; -- Revegetation slipped with it

-- Hold points: one notified-but-overdue (release warning fires), one pending
-- in the future, one fully released on P-0002.
insert into hold_points (id, project_id, task_id, title, required_by, date, status, notified_at, released_at, released_by, release_ref, notes) values
  ('e9000000-0000-4000-a000-000000000001', 'a1000000-0000-4000-a000-000000000001', 'e7000000-0000-4000-a000-000000000006',
   'Subgrade inspection — gabion foundation', 'Superintendent', '2026-06-07', 'notified', '2026-06-05 09:00+10', null, null, null,
   'Foundation level + bearing to be witnessed before first gabion course.'),
  ('e9000000-0000-4000-a000-000000000002', 'a1000000-0000-4000-a000-000000000001', 'e7000000-0000-4000-a000-000000000008',
   'Final inspection & survey conformance', 'Superintendent', '2026-07-15', 'pending', null, null, null, null, null),
  ('e9000000-0000-4000-a000-000000000003', 'a1000000-0000-4000-a000-000000000002', 'e7000000-0000-4000-a000-000000000011',
   'Membrane substrate inspection', 'Remedial Engineer', '2026-06-10', 'released', '2026-06-08 14:00+10', '2026-06-10 10:30+10',
   'R. Chen — Remedial Engineer', 'HP-002-A', null);

-- ─── 21. WHS demo — forms register top-up ────────────────────────────────────
-- whs demo
-- Live registers: two Excavator 13t pre-starts by Mia (yesterday + today,
-- all checks pass, hour meter advancing), two Take 5s by Jack on P-0001 and
-- a site induction run by Sam with one internal + two external sign-ons.
-- Dates are relative to the demo "today" (2026-06-12). Signatures reuse the
-- shared placeholder PNG (see upload-signature-placeholder.mjs above).
insert into form_submissions (id, template_id, template_version, kind, project_id, plant_id, data, submitted_by, submitted_at) values
  ('fb000002-0000-4000-a000-000000000001', 'fa000000-0000-4000-a000-000000000001', 1, 'prestart',
   'a1000000-0000-4000-a000-000000000001', 'bb000000-0000-4000-a000-000000000002',
   '{"fluids":"OK","brakes":"OK","lights":"OK","rops":"OK","attachments_secure":"OK","leaks":"OK","hour_meter":4212,"defects":"","safe_to_operate":true}'::jsonb,
   'aa000000-0000-4000-a000-000000000003', '2026-06-11 06:45+10'),
  ('fb000003-0000-4000-a000-000000000001', 'fa000000-0000-4000-a000-000000000001', 1, 'prestart',
   'a1000000-0000-4000-a000-000000000001', 'bb000000-0000-4000-a000-000000000002',
   '{"fluids":"OK","brakes":"OK","lights":"OK","rops":"OK","attachments_secure":"OK","leaks":"OK","hour_meter":4219,"defects":"","safe_to_operate":true}'::jsonb,
   'aa000000-0000-4000-a000-000000000003', '2026-06-12 06:40+10'),
  ('fb000004-0000-4000-a000-000000000001', 'fa000000-0000-4000-a000-000000000002', 1, 'take5',
   'a1000000-0000-4000-a000-000000000001', null,
   '{"stop_think":true,"look_hazards":true,"assess_risk":true,"control_hazards":true,"proceed_safely":true,"hazards_identified":"Wet ground near river edge after overnight rain; slippery batters.","controls":"Kept clear of the batter crest, walked the access track first, footwear checked.","ppe_checked":true}'::jsonb,
   'aa000000-0000-4000-a000-000000000002', '2026-06-11 07:05+10'),
  ('fb000005-0000-4000-a000-000000000001', 'fa000000-0000-4000-a000-000000000002', 1, 'take5',
   'a1000000-0000-4000-a000-000000000001', null,
   '{"stop_think":true,"look_hazards":true,"assess_risk":true,"control_hazards":true,"proceed_safely":true,"hazards_identified":"Working near 13t excavator during gabion basket placement.","controls":"Agreed exclusion zone and hand signals with operator; high-vis and hard hat on.","ppe_checked":true}'::jsonb,
   'aa000000-0000-4000-a000-000000000002', '2026-06-12 07:10+10'),
  ('fb000006-0000-4000-a000-000000000001', 'fa000000-0000-4000-a000-000000000004', 1, 'induction',
   'a1000000-0000-4000-a000-000000000001', null,
   '{"visitor_type":"Worker","ack_amenities":true,"ack_emergency":true,"ack_first_aid":true,"ack_exclusion":true,"ack_ppe":true,"emergency_contact":"Sam Field 0412 700 154"}'::jsonb,
   'aa000000-0000-4000-a000-000000000001', '2026-06-10 07:30+10');

insert into form_signons (id, submission_id, profile_id, name, company, signature_path, signed_at) values
  ('fc000003-0000-4000-a000-000000000001', 'fb000006-0000-4000-a000-000000000001', 'aa000000-0000-4000-a000-000000000001', 'Sam Field',   'Entice Civil Pty Ltd', 'seed/sig-placeholder.png', '2026-06-10 07:40+10'),
  ('fc000004-0000-4000-a000-000000000001', 'fb000006-0000-4000-a000-000000000001', null,                                   'Liam Chen',   'DigDeep Earthmoving',  'seed/sig-placeholder.png', '2026-06-10 07:42+10'),
  ('fc000005-0000-4000-a000-000000000001', 'fb000006-0000-4000-a000-000000000001', null,                                   'Pete Howard', 'GreenTip Waste',       'seed/sig-placeholder.png', '2026-06-10 07:45+10');

-- ─── 22. ISO documents — controlled register starters ───────────────────────
-- iso documents
-- ISO 9001/14001/45001 starter policies & procedures for the company-wide
-- controlled document register. Each is created as a DRAFT with no file yet —
-- the office reviews and adopts them through the approval workflow before they
-- are issued. Stable UUIDs + on conflict do nothing make this idempotent.
-- uploaded_by = the admin profile (looked up by role, matching the rest of seed).
insert into documents
  (id, title, category, system, doc_number, version, status, file_path, filename, review_due, notes, uploaded_by)
values
  ('d0c00000-0000-4000-a000-000000000001', 'Quality Policy',                                 'policy',    'qms',        'QMS-POL-001', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000002', 'Environmental Policy',                           'policy',    'ems',        'EMS-POL-001', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000003', 'WHS / OHS Policy',                               'policy',    'ohs',        'OHS-POL-001', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000004', 'Document & Records Control Procedure',           'procedure', 'integrated', 'INT-PRO-001', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000005', 'Internal Audit Procedure',                       'procedure', 'integrated', 'INT-PRO-002', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000006', 'Management Review Procedure',                    'procedure', 'integrated', 'INT-PRO-003', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000007', 'Nonconformance & Corrective Action Procedure',   'procedure', 'integrated', 'INT-PRO-004', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000008', 'Risk & Opportunity Procedure',                   'procedure', 'integrated', 'INT-PRO-005', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1)),
  ('d0c00000-0000-4000-a000-000000000009', 'Competence & Training Procedure',                'procedure', 'integrated', 'INT-PRO-006', 'Rev A', 'draft', null, null, null, 'Starter — review and adopt before use', (select id from profiles where role = 'admin' order by created_at limit 1))
on conflict (id) do nothing;

-- ─── 23. NCR / CAPA register — ISO 9001/14001 §10.2 ─────────────────────────
-- ncr capa
-- A handful of demo nonconformances across sources so the register and
-- dashboard look alive: a quality NCR (investigating, 1 open CAPA), an
-- environmental NCR (actions, 1 overdue CAPA), and a supplier NCR (open).
-- Stable UUIDs + on conflict do nothing make this idempotent. raised_by uses
-- the seeded supervisor (Sam Field). CAPA due dates are relative to today so
-- the "overdue" demo stays overdue whenever the seed is run.
insert into ncrs
  (id, number, source, category, severity, title, description, immediate_action,
   root_cause, status, project_id, job_id, vendor_id, raised_by, occurred_on)
values
  ('e0c00000-0000-4000-a000-000000000001', 'NCR-0001', 'quality', 'Concrete', 3,
   'Insufficient concrete cover to reinforcement — gabion footing',
   'Cover meter check on the gabion footing pour returned 28-32mm against the 50mm specified in the structural drawings. Affects approx. 6 linear metres of the eastern footing.',
   'Pour halted and area cordoned; superintendent notified. Affected section flagged for assessment before backfill.',
   'Bar chairs spaced too widely and not all replaced after pre-pour adjustment.',
   'investigating',
   'a1000000-0000-4000-a000-000000000001', null, null,
   'aa000000-0000-4000-a000-000000000001', current_date - 6),
  ('e0c00000-0000-4000-a000-000000000002', 'NCR-0002', 'environmental', 'Sediment control', 2,
   'Sediment fence breach after overnight rain',
   'Section of sediment fence along the river batter failed overnight; sediment-laden runoff reached the watercourse edge before being contained.',
   'Emergency sandbag bund installed at first light; affected fence section isolated.',
   'Fence undermined by concentrated flow — no check dam upstream of the run.',
   'actions',
   'a1000000-0000-4000-a000-000000000001', null, null,
   'aa000000-0000-4000-a000-000000000001', current_date - 10),
  ('e0c00000-0000-4000-a000-000000000003', 'NCR-0003', 'supplier', 'Materials', 3,
   'Wrong rebar grade delivered (N12 supplied for D500N spec)',
   'Reinforcement delivery from SteelFix contained N12 bar where the schedule called for D500N. Quantity affected: 1.2 tonnes. Held in the laydown area, not yet fixed.',
   'Delivery quarantined and tagged "DO NOT USE"; supplier notified and replacement requested.',
   null,
   'open',
   'a1000000-0000-4000-a000-000000000001', null,
   'dd000000-0000-4000-a000-000000000003',
   'aa000000-0000-4000-a000-000000000001', current_date - 2)
on conflict (id) do nothing;

insert into capa_actions
  (id, ncr_id, kind, description, assigned_to, due_date, status, completed_at)
values
  -- Quality NCR: one open corrective action due next week.
  ('e1c00000-0000-4000-a000-000000000001', 'e0c00000-0000-4000-a000-000000000001',
   'corrective', 'Engage testing house to core and assess the affected footing section; rectify or replace per engineer''s direction.',
   'aa000000-0000-4000-a000-000000000001', current_date + 7, 'open', null),
  -- Environmental NCR: one OVERDUE corrective action + one preventive.
  ('e1c00000-0000-4000-a000-000000000002', 'e0c00000-0000-4000-a000-000000000002',
   'corrective', 'Reinstate and reinforce the failed sediment fence run and remove deposited sediment from the batter toe.',
   'aa000000-0000-4000-a000-000000000001', current_date - 3, 'open', null),
  ('e1c00000-0000-4000-a000-000000000003', 'e0c00000-0000-4000-a000-000000000002',
   'preventive', 'Add a check dam upstream of each fence run on the river batters; update the ESCP and brief the crew.',
   'aa000000-0000-4000-a000-000000000001', current_date + 14, 'open', null)
on conflict (id) do nothing;

-- Keep the live sequence ahead of the seeded NCR numbers so the app's
-- next_number('ncr') issues NCR-0004 onward (mirrors how numbering works
-- elsewhere; never lower an existing value).
update sequences set next_value = greatest(next_value, 4) where key = 'ncr';
