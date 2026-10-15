-- The Fokus feedback round (user, 2026-10-15; tech-lead plan): one migration for the round.
-- 1. exercise_set_log.timing_ok: a set's timestamps usable for statistics (slice log-fix-1015).
-- 2. planned_sets.today_kg / today_basis: Fokus's "I DAG" kg (slice fokus-kg, domain/today_kg.py).
-- 3. planned_sets.rest_min_s / rest_max_s: the rest window by exercise type (slice rest-by-type).
-- 4. superset_pairs: supersets chosen in the app (slice supersets); written by the web only.

-- 1. exercise_set_log.timing_ok ------------------------------------------------------------------
alter table public.exercise_set_log
  add column timing_ok boolean not null default true;
comment on column public.exercise_set_log.timing_ok is
  'false = this set''s timestamps and the rest before it are unusable for statistics (e.g. logged in quick series after the fact; user, 2026-10-15). Python never reads timestamps for a calculation; reps_done, felt_rpe and skipped stay valid.';

-- 2. planned_sets.today_kg / today_basis --------------------------------------------------------
alter table public.planned_sets
  add column today_kg double precision check (today_kg is null or today_kg >= 0),
  add column today_basis text check (today_basis is null or today_basis in ('sheet', 'derived', 'e1rm', 'last')),
  add constraint planned_sets_today_together check ((today_kg is null) = (today_basis is null));
comment on column public.planned_sets.today_kg is
  'Fokus''s "I DAG" kg (domain/today_kg.py): the sheet''s kg this week; else derived from another set of the exercise that session (e1RM relation, or a -x % back-off of the heaviest kg), rounded to 2.5; else the e1RM suggestion; else last week''s kg. 0 only on a bodyweight exercise (bodyweight alone). Null = no kg to show.';
comment on column public.planned_sets.today_basis is
  'sheet | derived | e1rm (shown "~") | last ("samme som sidst"); null exactly when today_kg is null.';

-- 3. the rest window by exercise type ---------------------------------------------------------
comment on column public.planned_sets.rest_min_s is
  'Recommended rest after the set, by the exercise''s type only (user, 2026-10-15): a main lift or its variant 180-300 s; isolation and abs 60-120 s; every other exercise 90-180 s.';
comment on column public.planned_sets.rest_max_s is
  'The upper end of the rest window (see rest_min_s).';

-- 4. superset_pairs -----------------------------------------------------------------------------
create table public.superset_pairs (
  date        date        not null,
  session_no  smallint    not null check (session_no >= 1),
  row_a       integer     not null check (row_a >= 1),
  row_b       integer     not null check (row_b > row_a),
  exercise_a  bigint      not null references public.exercises (id) on delete restrict,
  variant_a   bigint      references public.exercise_variants (id) on delete restrict,
  exercise_b  bigint      not null references public.exercises (id) on delete restrict,
  variant_b   bigint      references public.exercise_variants (id) on delete restrict,
  paired      boolean     not null,
  updated_at  timestamptz not null default now(),
  primary key (date, session_no, row_a)
);
create index superset_pairs_by_exercises on public.superset_pairs (exercise_a, variant_a, exercise_b, variant_b, date desc);

comment on table public.superset_pairs is
  'Supersets chosen in the app (user, 2026-10-15): two consecutive exercise runs of a session (rows = the runs'' first sheet rows) done as A1, B1, rest, A2, B2 ... paired = false records an explicit "no" (the suggestion from an earlier day switched off). Written only by the web''s server action; Python never reads it (no TSS change). Cannot be rebuilt, so its foreign keys restrict: an exercise or variant that has been paired cannot be deleted (correct a mistyped one in place, or delete its pairs first).';
comment on column public.superset_pairs.paired is
  'true = done as a superset that day; false = the suggestion was switched off.';

alter table public.superset_pairs enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.
revoke all on table public.superset_pairs from anon, authenticated, service_role;
grant select, insert, update on table public.superset_pairs to service_role;
