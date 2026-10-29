-- Card catalog imported from the-fab-cube/flesh-and-blood-cards (scripts/import-cards.mts).
-- One row per unique card = name + pitch. Printings are intentionally not stored.

create table public.cards (
  id text primary key, -- fab-cube unique_id (stable across dataset releases)
  name text not null,
  pitch smallint check (pitch between 1 and 3),
  color text check (color in ('Red', 'Yellow', 'Blue')),
  types text[] not null default '{}',
  image_url text,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (name, pitch)
);

create index cards_name_trgm on public.cards using gin (name extensions.gin_trgm_ops);

alter table public.cards enable row level security;

-- Read-only for users; only the service role (import script) writes.
create policy "cards are readable by signed-in users"
  on public.cards for select to authenticated using (true);

-- Autocomplete. Ranks card *names* (exact, then prefix, then substring, then
-- typo matches) and returns every pitch variant of the top `max_results` names,
-- grouped by name in rank order and by pitch within a name. The UI shows one
-- entry per name and asks for the color afterwards.
--
-- Typo matching uses an explicit word_similarity threshold rather than `<%`
-- (default 0.6), which misses short typos like "snach" → "Snatch". The catalog
-- is ~5k rows, so a scan is cheap. strict_word_similarity breaks the frequent
-- word_similarity ties ("snach" scores 0.5 against both Snatch and Cold Snap).
create function public.search_cards(q text, max_results int default 20)
returns setof public.cards
language sql
stable
set search_path = public, extensions
as $$
  with input as (
    select btrim(q) as term,
           -- Escape LIKE wildcards so "%" or "_" in the query match literally.
           replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') as pattern
  ),
  matches as (
    select c.*
    from public.cards c, input i
    where char_length(i.term) >= 2
      and (c.name ilike '%' || i.pattern || '%' or word_similarity(i.term, c.name) >= 0.45)
  ),
  ranked_names as (
    select n.name,
           row_number() over (order by
             lower(n.name) = lower(i.term) desc,
             n.name ilike i.pattern || '%' desc,
             n.name ilike '%' || i.pattern || '%' desc,
             strict_word_similarity(i.term, n.name) desc,
             similarity(i.term, n.name) desc,
             n.name
           ) as rnk
    from (select distinct name from matches) n, input i
  )
  select m.*
  from matches m
  join ranked_names r on r.name = m.name
  where r.rnk <= least(greatest(max_results, 1), 50)
  order by r.rnk, m.pitch nulls first;
$$;
