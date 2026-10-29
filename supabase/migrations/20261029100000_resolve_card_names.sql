-- Bulk import: resolve pasted card names to catalog names.

-- Comparison key for card names: lowercase, punctuation removed, spaces collapsed.
-- "Titans Fist" and "Titan's Fist" both become "titans fist".
create function public.card_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(lower(p_name), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'));
$$;

-- btree for exact key matches; trigram GIN so typo matches (%) use an index too.
create index cards_name_key on public.cards (public.card_name_key(name));
create index cards_name_key_trgm on public.cards using gin (public.card_name_key(name) extensions.gin_trgm_ops);

-- For each input name (in order): the best catalog name, and whether it was an
-- exact (key) match or a typo match (trigram similarity >= 0.5 on the keys).
-- name is null when nothing is close enough. At most 200 names per call.
create function public.resolve_card_names(p_names text[])
returns table (idx int, input text, name text, match text)
language sql
stable
set search_path = public, extensions
set pg_trgm.similarity_threshold = 0.5
as $$
  with inputs as (
    select (t.ord)::int as idx, t.n as input, public.card_name_key(t.n) as key
    from unnest(p_names[1:200]) with ordinality as t(n, ord)
  )
  select i.idx, i.input, m.name, m.match
  from inputs i
  left join lateral (
    select c.name, case when public.card_name_key(c.name) = i.key then 'exact' else 'typo' end as match
    from public.cards c
    where i.key <> '' and (public.card_name_key(c.name) = i.key or public.card_name_key(c.name) % i.key)
    order by public.card_name_key(c.name) = i.key desc, similarity(public.card_name_key(c.name), i.key) desc, c.name
    limit 1
  ) m on true
  order by i.idx;
$$;

revoke execute on function public.resolve_card_names(text[]) from public, anon;
