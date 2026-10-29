-- Set codes each card was printed in (newest set first), shown on requests so
-- players can look the card up. Filled by scripts/import-cards.mts.
alter table public.cards add column set_ids text[] not null default '{}';
