-- Local seed data: New York area stores running a weekly Flesh and Blood Armory.
-- Addresses are left empty on purpose (add them via the admin page once verified).
-- Weekday: 0 = Sunday … 6 = Saturday. All times are store-local (America/New_York).

insert into public.stores (id, name, city, region, country, timezone, created_by) values
  ('00000000-0000-4000-b000-000000000001', 'Uncommons',                     'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000002', 'Action City Comics',            'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000003', 'Solacido Games & Collectables', 'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000004', 'Sip & Play',                    'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000005', 'Gamestoria',                    'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000006', 'Hex West',                      'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000007', 'Silk Road',                     'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000008', 'New Kawaii',                    'Irvington',     'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000009', 'Neutral Ground',                'New York City', 'NY', 'USA', 'America/New_York', null),
  ('00000000-0000-4000-b000-000000000010', 'Surreal Creamery',              'New York City', 'NY', 'USA', 'America/New_York', null);

insert into public.store_schedules (store_id, label, weekday, start_time) values
  ('00000000-0000-4000-b000-000000000001', 'Armory (All Formats)',         1, '18:30'), -- Mon
  ('00000000-0000-4000-b000-000000000002', 'Armory (All Formats)',         2, '19:00'), -- Tue
  ('00000000-0000-4000-b000-000000000003', 'Armory (All Formats)',         3, '19:00'), -- Wed
  ('00000000-0000-4000-b000-000000000004', 'Armory (CC-centric)',          4, '19:00'), -- Thu
  ('00000000-0000-4000-b000-000000000005', 'Armory (CC-centric)',          4, '19:00'), -- Thu
  ('00000000-0000-4000-b000-000000000006', 'Armory (All Formats)',         5, '19:00'), -- Fri
  ('00000000-0000-4000-b000-000000000007', 'Armory (All Formats)',         6, '14:00'), -- Sat
  ('00000000-0000-4000-b000-000000000008', 'Armory (All Formats)',         0, '13:00'), -- Sun
  ('00000000-0000-4000-b000-000000000009', 'Armory (All Formats)',         0, '12:00'), -- Sun
  ('00000000-0000-4000-b000-000000000010', 'Armory (Classic Constructed)', 0, '19:00'); -- Sun

update public.stores set notes = 'Pre-register at actioncitycomics.com'
where id = '00000000-0000-4000-b000-000000000002';
