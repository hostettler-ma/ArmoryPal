-- One-row table describing the imported card catalog (written by scripts/import-cards.mts).

create table public.catalog_meta (
  id boolean primary key default true check (id), -- enforces a single row
  dataset_tag text not null,
  latest_set_id text not null,
  latest_set_name text not null,
  latest_set_released_on date,
  imported_at timestamptz not null default now()
);

alter table public.catalog_meta enable row level security;

create policy "catalog meta is readable by signed-in users"
  on public.catalog_meta for select to authenticated using (true);
