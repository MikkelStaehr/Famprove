-- Exercise variants (user, 2026-10-14, slice variants). The user writes "V: <variant>" (or
-- "Variant:") in a week's NOTES cell of the coach's sheet; it carries forward for the rest of the
-- block until a new "V:". A variant has the exercise's per-exercise scoring inputs as optional
-- overrides (null = inherit from the exercise). Suggestions, e1RM, progression and the feel lines
-- group per (exercise, variant); null on a set = "ukendt", never mixed with a named variant.
-- Access model as public.exercises: RLS on, no policies; the service role may select and insert
-- only (collect-strength adds unknown variants; values are hand-edited, code never overwrites).

create table public.exercise_variants (
  id                  bigint           generated always as identity primary key,
  exercise_id         bigint           not null references public.exercises (id) on delete cascade,
  name                text             not null
                                       check (length(name) > 0 and name = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))),
  display_name        text             not null check (length(btrim(display_name)) > 0),
  aliases             text[]           not null default '{}',
  muscle_factor       double precision check (muscle_factor is null or (muscle_factor > 0 and muscle_factor <= 2)),
  bodyweight_fraction double precision check (bodyweight_fraction is null or bodyweight_fraction between 0 and 1),
  no_bodyweight       boolean          not null default false,
  per_side            boolean,
  kg_per_dumbbell     boolean,
  suggests            boolean          not null default true,
  created_at          timestamptz      not null default now(),
  unique (exercise_id, name),
  check (not (no_bodyweight and bodyweight_fraction is not null))
);

comment on table public.exercise_variants is
  'Variants of an exercise, from "V: <variant>" lines in the sheet''s NOTES (user, 2026-10-14). collect-strength inserts unknown ones (insert-only); the user edits the values. Every scoring field is an override: null = inherit from public.exercises.';
comment on column public.exercise_variants.name is
  'The normalised variant name: trimmed, lower case, whitespace collapsed. Matched together with aliases.';
comment on column public.exercise_variants.display_name is
  'Shown on Træning and Fokus instead of the exercise name (first spelling seen, spaces collapsed; editable).';
comment on column public.exercise_variants.aliases is
  'Other normalised spellings of the same variant (e.g. "single armcable triceps pushdown").';
comment on column public.exercise_variants.muscle_factor is
  'Override of exercises.muscle_factor; null = inherit.';
comment on column public.exercise_variants.bodyweight_fraction is
  'Override of exercises.bodyweight_fraction; null = inherit (unless no_bodyweight).';
comment on column public.exercise_variants.no_bodyweight is
  'True: this variant adds no bodyweight even if the exercise has a fraction (e.g. lat pulldown done in place of pull-ups).';
comment on column public.exercise_variants.per_side is
  'Override of exercises.per_side; null = inherit.';
comment on column public.exercise_variants.kg_per_dumbbell is
  'Override of exercises.kg_per_dumbbell; null = inherit.';
comment on column public.exercise_variants.suggests is
  'False: no suggested kg for this variant (e.g. a multi-exercise variant such as "palloff + ghd").';

alter table public.exercise_variants enable row level security;
revoke all on table public.exercise_variants from anon, authenticated, service_role;
revoke all on sequence public.exercise_variants_id_seq from anon, authenticated;
grant select, insert on table public.exercise_variants to service_role;

-- The variant each set was done in (null = ukendt). collect-strength sets it on every run from
-- the sheet, so a deleted variant row only nulls it until the next run.
alter table public.strength_sets
  add column variant_id bigint references public.exercise_variants (id) on delete set null;
comment on column public.strength_sets.variant_id is
  'The exercise variant from the sheet''s "V:" line in force that week (null = ukendt, never mixed with a named variant).';

-- The kg history keeps its key (it can't be rebuilt); the variant is an attribute.
alter table public.strength_set_kg
  add column variant_id bigint references public.exercise_variants (id) on delete set null;
comment on column public.strength_set_kg.variant_id is
  'The variant in force when the kg was seen (attribute only, not part of the key).';

-- One feel line per (exercise, variant); null variant = ukendt is its own line.
alter table public.exercise_feel
  add column variant_id bigint references public.exercise_variants (id) on delete cascade,
  drop constraint exercise_feel_pkey,
  add constraint exercise_feel_exercise_variant_key unique nulls not distinct (exercise_id, variant_id);
comment on table public.exercise_feel is
  'One line per (exercise, variant) for Analyse > Styrke, from exercise_set_log.felt_rpe: only pairs with 4+ rated sets have a row. Rebuilt by compute (upsert, then delete older rows). verdict_text is Danish and shown verbatim, worded "trænerens RPE" (no coach name: the repo is public).';

-- A variant with no logged kg last week has no suggestion yet.
alter table public.planned_sets
  drop constraint planned_sets_basis_check,
  add constraint planned_sets_basis_check
    check (basis in ('rpe_e1rm', 'not_rpe', 'no_e1rm', 'no_lift', 'progression', 'new_variant'));
