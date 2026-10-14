-- Unilateral and dumbbell exercises (user, 2026-10-14, slice bodyweight-fractions): two more
-- per-exercise inputs to the coach's strength formula, next to muscle_factor and
-- bodyweight_fraction (the formula itself is unchanged; CLAUDE.md, the 2026-10-12 exception).
--   per_side         the sheet's reps are per side (split squat, single-leg ...): the set score
--                    counts both sides, reps x 2.
--   kg_per_dumbbell  the logged kg is per dumbbell and two are held: the external load is
--                    2 x the logged kg (a single dumbbell or a barbell: false).
-- Both default false, so nothing is scored differently until a row is marked (a separate data
-- migration, after the user has seen the lists). strength_sets records what each set was scored
-- with, as it does for muscle_factor.

alter table public.exercises
  add column per_side        boolean not null default false,
  add column kg_per_dumbbell boolean not null default false;

comment on column public.exercises.per_side is
  'True: the sheet''s reps are per side (a unilateral exercise); the set score counts both sides (reps x 2). User, 2026-10-14.';
comment on column public.exercises.kg_per_dumbbell is
  'True: the logged kg is per dumbbell and two are held, so the external load is 2 x the logged kg (one dumbbell or a barbell: false). User, 2026-10-14.';

alter table public.strength_sets
  add column sides     smallint not null default 1 check (sides in (1, 2)),
  add column kg_factor smallint not null default 1 check (kg_factor in (1, 2));

comment on column public.strength_sets.sides is
  'What the set was scored with (public.exercises.per_side at collect time): 2 = reps per side, both counted.';
comment on column public.strength_sets.kg_factor is
  'What the set was scored with (public.exercises.kg_per_dumbbell at collect time): 2 = logged kg per dumbbell, two held; kg (effective) = kg_factor x logged_kg + bodyweight share.';
