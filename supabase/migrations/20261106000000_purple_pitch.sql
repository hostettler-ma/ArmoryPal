-- Usurp the Shadow Throne adds Soul of Existence, a Purple gem that pitches for 4.
alter table public.cards drop constraint cards_pitch_check;
alter table public.cards add constraint cards_pitch_check check (pitch between 1 and 4);

alter table public.cards drop constraint cards_color_check;
alter table public.cards add constraint cards_color_check check (color in ('Red', 'Yellow', 'Blue', 'Purple'));
