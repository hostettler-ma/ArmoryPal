-- Free-text notes about a store's Armory (e.g. "Pre-register at …"), shown on the
-- store and event pages. Admin-editable like the rest of the store.
alter table public.stores add column notes text check (char_length(notes) <= 500);
