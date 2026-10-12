-- =============================================================================
-- exercises.suggestion_scale (decided with the user 2026-10-12): a per-exercise multiplier on the
-- suggested kg (planned_sets.suggested_kg = rolling e1RM of the parent lift x pct(RPE, reps) x
-- suggestion_scale, rounded to 2.5). Tempo variants inherit the competition lift's e1RM, which
-- suggested them about 20 % too heavy on real data (tempo squat 140-145 kg vs 115-120 kg logged),
-- so they start at 0.8; everything else at 1.0. The user tunes the values in the table editor;
-- the next compute recomputes the suggestions.
-- Additive: a new not-null column with a default, so the code on main keeps running.
-- State transitions: hand-edited like the rest of exercises; nothing can't be rebuilt.
-- =============================================================================

alter table public.exercises
  add column suggestion_scale double precision not null default 1.0
    check (suggestion_scale > 0 and suggestion_scale <= 2);

comment on column public.exercises.suggestion_scale is
  'Multiplies the suggested kg for this exercise (planned_sets, compute): rolling e1RM of the parent lift x pct(RPE, reps) x suggestion_scale, rounded to 2.5. 1.0 = the parent lift''s e1RM as is; tempo variants start at 0.8 (they inherit the competition lift''s e1RM). Editing it takes effect at the next compute.';

-- Tempo variants (today: "3.0.0 Tempo squat", "3.2.0 tempo squat", "3.2.0 Tempo bænk").
update public.exercises set suggestion_scale = 0.8 where lower(name) like '%tempo%';
