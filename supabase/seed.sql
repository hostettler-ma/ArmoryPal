-- Local sample data. These stores are fictional; real stores get added by an admin.

insert into public.stores (id, name, city, region, country, address, timezone, created_by) values
  ('00000000-0000-4000-a000-000000000001', 'Pitch Perfect Games', 'Portland', 'OR', 'USA', '123 Sample St', 'America/Los_Angeles', null),
  ('00000000-0000-4000-a000-000000000002', 'The Arsenal Card Shop', 'Chicago', 'IL', 'USA', '45 Example Ave', 'America/Chicago', null),
  ('00000000-0000-4000-a000-000000000003', 'Crucible Tabletop', 'Manchester', null, 'UK', '7 Placeholder Rd', 'Europe/London', null),
  ('00000000-0000-4000-a000-000000000004', 'Rathe & Ruin Games', 'Melbourne', 'VIC', 'Australia', null, 'Australia/Melbourne', null);

insert into public.store_schedules (store_id, label, weekday, start_time) values
  ('00000000-0000-4000-a000-000000000001', 'Armory', 2, '18:30'),
  ('00000000-0000-4000-a000-000000000002', 'Armory', 4, '19:00'),
  ('00000000-0000-4000-a000-000000000002', 'Saturday Armory', 6, '13:00'),
  ('00000000-0000-4000-a000-000000000003', 'Armory', 3, '18:00'),
  ('00000000-0000-4000-a000-000000000004', 'Armory', 5, '18:30');
