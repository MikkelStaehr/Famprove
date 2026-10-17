-- The Fokus round of 2026-10-17 (user; tech-lead plan): one migration for the round.
-- 1. session_order: a session's run order after a jump in Fokus's sheet (slice fokus-sheet).
-- 2. exercise_variant_parts: the parts of a combined variant, hand-edited (slice combo-parts).
-- 3. exercise_set_parts: each part's kg, reps and per-side for a done set (slice combo-parts).
-- 4. Variant "Palloff 10 kg + weighted situps 5 kg" renamed "Palloff + weighted situps" (the
--    user's yes, 2026-10-17), the old name kept as an alias, and its two parts.
-- Python reads none of these tables, so TSS is unchanged. No functions, triggers or RPC.
-- RLS on, no policies; service_role only.

-- 1. session_order -----------------------------------------------------------------------------
create table public.session_order (
  date        date        not null,
  session_no  smallint    not null check (session_no >= 1),
  run_rows    integer[]   not null check (cardinality(run_rows) >= 1),
  updated_at  timestamptz not null default now(),
  primary key (date, session_no)
);
comment on table public.session_order is
  'A session''s wanted run order after a jump in Fokus (user, 2026-10-17): run_rows = the runs'' first sheet rows (the key superset_pairs uses), in order. A jumped-to run moves to just after the finished runs; everything else keeps its order. Only for that date and session; a row number not in the session is ignored (the sheet''s order is the fallback). Written by the set-log action''s jump tap; the server orders taps by it, so a reload keeps it. Python never reads it. Cannot be rebuilt.';

alter table public.session_order enable row level security;
revoke all on table public.session_order from anon, authenticated, service_role;
grant select, insert, update on table public.session_order to service_role;

-- 2. exercise_variant_parts ------------------------------------------------------------------
create table public.exercise_variant_parts (
  variant_id  bigint   not null references public.exercise_variants (id) on delete cascade,
  part_no     smallint not null check (part_no >= 1),
  name        text     not null check (length(btrim(name)) > 0),
  per_side    boolean  not null default false,
  primary key (variant_id, part_no)
);
comment on table public.exercise_variant_parts is
  'The parts of a combined variant (e.g. Palloff + weighted situps), hand-edited by the user like exercise_variants: the name Fokus shows per part and whether its reps count per side by default. Python never reads it.';

alter table public.exercise_variant_parts enable row level security;
revoke all on table public.exercise_variant_parts from anon, authenticated, service_role;
grant select, insert on table public.exercise_variant_parts to service_role;

-- 3. exercise_set_parts ----------------------------------------------------------------------
create table public.exercise_set_parts (
  date        date             not null,
  session_no  smallint         not null,
  row_no      integer          not null,
  set_no      smallint         not null check (set_no >= 1),
  part_no     smallint         not null check (part_no >= 1),
  variant_id  bigint           not null references public.exercise_variants (id) on delete restrict,
  kg          double precision check (kg is null or kg >= 0),
  reps        double precision check (reps is null or reps > 0),
  per_side    boolean          not null,
  updated_at  timestamptz      not null default now(),
  primary key (date, session_no, row_no, set_no, part_no),
  foreign key (date, session_no, row_no, set_no)
    references public.exercise_set_log (date, session_no, row_no, set_no) on delete cascade
);
create index exercise_set_parts_by_variant on public.exercise_set_parts (variant_id, part_no, date desc);
comment on table public.exercise_set_parts is
  'Each part of a combined variant''s done set, logged in Fokus (user, 2026-10-17): the sheet has one WEIGHT cell, so the parts live in the app. Written by the parts action (one bulk upsert of all parts). Python never reads it: the ABS score is fixed, so TSS is unchanged. Cannot be rebuilt; goes with its set-log row.';
comment on column public.exercise_set_parts.kg is
  'The part''s kg; 0 = no added weight (a real zero); null = not logged.';
comment on column public.exercise_set_parts.reps is
  'The part''s reps (per side when per_side); null = not logged; never 0.';
comment on column public.exercise_set_parts.per_side is
  'The reps count per side ("tæller pr. side"), as the user marked it for this set.';

alter table public.exercise_set_parts enable row level security;
revoke all on table public.exercise_set_parts from anon, authenticated, service_role;
grant select, insert, update on table public.exercise_set_parts to service_role;

-- 4. The variant without kg in its name, and its parts --------------------------------------
update public.exercise_variants
  set name = 'palloff + weighted situps',
      display_name = 'Palloff + weighted situps',
      aliases = array_append(aliases, 'palloff 10 kg + weighted situps 5 kg')
  where name = 'palloff 10 kg + weighted situps 5 kg'
    and exercise_id = (select id from public.exercises where name = 'Abs of choice');

insert into public.exercise_variant_parts (variant_id, part_no, name, per_side)
  select v.id, p.part_no, p.name, p.per_side
  from public.exercise_variants v
  cross join (values (1, 'Palloff', true), (2, 'Weighted situps', false)) as p (part_no, name, per_side)
  where v.name = 'palloff + weighted situps'
    and v.exercise_id = (select id from public.exercises where name = 'Abs of choice');
