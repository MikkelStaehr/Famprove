-- =============================================================================
-- Analyse / Styrke, storage (task e1, decided with the user 2026-10-01). All additive.
-- 1. strength_sets.raw / logged_rpe: the week's cells as written (SETS .. Mean Weight, incl.
--    WEIGHT text and NOTES) and the user's logged RPE (LSRPE; whole or half values only).
-- 2. blocks.phase: the program phase of each block (in_season up to blok 11, off_season from
--    blok 12; a constant map in domain.strength_analysis). Null until compute fills it.
-- 3. strength_weeks: rebuilt by compute. One row per ISO week x competition lift from the first
--    block's start to the current week: tonnage of lifted sets (0 = nothing lifted) and the
--    week's best e1RM, from lifted kg only.
-- 4. strength_set_kg: persistent kg history per set, updated by compute and NEVER rebuilt (it
--    can't be recreated): the planned kg (first and last seen before the session was done)
--    and the lifted kg (once the session is done), with timestamps.
-- Access model unchanged: RLS on, no policies, anon/authenticated revoked, service_role only.
-- =============================================================================

alter table public.strength_sets
  add column raw jsonb,
  add column logged_rpe double precision
    check (logged_rpe is null or (logged_rpe between 1 and 10 and logged_rpe * 2 = round(logged_rpe * 2)));

comment on column public.strength_sets.raw is
  'The week''s cells as written in the sheet: sets, reps, load, weight, lsrpe, notes, mean_weight (null until collect-strength runs again).';
comment on column public.strength_sets.logged_rpe is
  'The user''s logged RPE (LSRPE column) for the row; null when blank or not a whole/half value 1-10 (counted by the parser).';

alter table public.blocks
  add column phase text check (phase is null or phase in ('in_season', 'off_season'));

comment on column public.blocks.phase is
  'Program phase (domain.strength_analysis.PHASES): compare progression within a phase; charts mark a change.';

create table public.strength_weeks (
  week_start      date             not null check (extract(isodow from week_start) = 1),
  lift            text             not null check (lift in ('SQUAT', 'BENCH', 'DEADLIFT')),
  block           text,
  block_no        integer,
  phase           text             check (phase is null or phase in ('in_season', 'off_season')),
  status          text             check (status is null or status in ('lifted', 'pre_log')),
  sets_lifted     integer          not null check (sets_lifted >= 0),
  tonnage_kg      double precision not null check (tonnage_kg >= 0),
  e1rm_kg         double precision check (e1rm_kg is null or e1rm_kg between 20 and 400),
  e1rm_load_kg    double precision,
  e1rm_reps       double precision,
  e1rm_rpe        double precision,
  e1rm_rpe_source text             check (e1rm_rpe_source is null or e1rm_rpe_source in ('logged', 'prescribed')),
  is_block_best   boolean          not null,
  computed_at     timestamptz      not null,
  primary key (week_start, lift),
  check ((e1rm_kg is null) = (e1rm_rpe_source is null)),
  check ((e1rm_kg is null) = (e1rm_load_kg is null) and (e1rm_kg is null) = (e1rm_reps is null) and (e1rm_kg is null) = (e1rm_rpe is null)),
  check (e1rm_kg is not null or not is_block_best),
  check ((sets_lifted = 0) = (status is null)),
  check ((block is null) = (block_no is null))
);

comment on table public.strength_weeks is
  'Rebuilt by compute (domain.strength_analysis): every ISO week x SQUAT/BENCH/DEADLIFT from the first block''s start to the current week. Only lifted kg counts (session matched to an activity, or a pre-log block whose week has passed); planned kg never does.';
comment on column public.strength_weeks.status is
  'lifted = sessions matched to intervals.icu activities; pre_log = a block before the activity log (blok 11), counted once its week has passed; null = nothing lifted that week.';
comment on column public.strength_weeks.tonnage_kg is
  'Sum of kg x reps over the lift type''s lifted sets that week (variants such as tempo included), as the sheet''s TONNAGE.';
comment on column public.strength_weeks.e1rm_kg is
  'The week''s best set e1RM = kg x (1 + 0.0333 x (reps + 10 - RPE)) on competition-name sets with an RPE prescription, reps <= 8. Uses the logged RPE when the week has any, else the prescribed RPE (e1rm_rpe_source). Never planned kg.';
comment on column public.strength_weeks.is_block_best is
  'The block''s best e1rm_kg for this lift (one per block and lift that has any).';

alter table public.strength_weeks enable row level security;
revoke all on table public.strength_weeks from anon, authenticated;
grant select, insert, update, delete on table public.strength_weeks to service_role;

create table public.strength_set_kg (
  sheet_id           text             not null,
  block              text             not null,
  week               smallint         not null check (week > 0),
  session            smallint         not null check (session > 0),
  name               text             not null,
  occurrence         smallint         not null check (occurrence > 0),
  set_no             smallint         not null check (set_no > 0),
  sheet_row          integer          not null check (sheet_row > 0),
  type               text             not null,
  reps_text          text,
  prescribed         text,
  week_start         date             not null,
  planned_first_kg   double precision,
  planned_first_at   timestamptz,
  planned_last_kg    double precision,
  planned_last_at    timestamptz,
  lifted_kg          double precision,
  lifted_first_at    timestamptz,
  lifted_changed_at  timestamptz,
  first_seen_at      timestamptz      not null,
  primary key (sheet_id, block, week, session, name, occurrence, set_no),
  check ((planned_first_kg is null) = (planned_first_at is null)),
  check ((planned_last_kg is null) = (planned_last_at is null)),
  check ((planned_first_kg is null) = (planned_last_kg is null)),
  check (lifted_kg is null or lifted_first_at is not null)
);

comment on table public.strength_set_kg is
  'Persistent kg history per set (domain.kg_history), updated by compute and never rebuilt. planned_first = first kg seen before the session was done (never overwritten); planned_last = last kg seen before it was done (frozen once done); lifted = kg while the session is done (follows corrections). Planned null = not observed, never "no adjustment". Keyed by what the set is (tab, week, session, exercise name, its occurrence among same-name rows in the session, set number), not by its sheet row: an inserted row keeps its history; a renamed or moved set gets a new row and the old one stays. Rows are never overwritten by another set or deleted.';

alter table public.strength_set_kg enable row level security;
revoke all on table public.strength_set_kg from anon, authenticated;
grant select, insert, update, delete on table public.strength_set_kg to service_role;
