-- =============================================================================
-- Træning: per-set timing log and suggested kg per set (decided with the user 2026-10-12).
-- All additive: the code on main (28a7334) keeps running against this schema until the deploy
-- (new tables only; public.exercise_log is untouched and the deployed app keeps writing it).
-- 1. exercise_set_log: start/end/skip per SET from the Træning screen, the per-set successor of
--    exercise_log. Data collection only: nothing computes from it, Python never reads it, and
--    it can't be rebuilt. Existing exercise_log rows are copied in below; rows written after
--    this migration are copied by supabase/followups/20261012140000_drop_exercise_log.sql,
--    which then drops exercise_log (apply it only right after the new web code is deployed).
-- 2. planned_sets: suggested kg per set of the run day's ISO week and later, rebuilt by compute
--    (domain.planned_sets owns the calculation; the web only reads it).
-- No functions, triggers or RPC. Access model unchanged: RLS on, no policies,
-- anon/authenticated revoked, service_role granted only what the writers need.
--
-- State transitions and data-loss risk (tables that can't be rebuilt from a source)
-- exercise_set_log (key = date + the session number + the sheet row + the set number, the
--   user's spec; exercise_id is stored on every row, so the history stays right even if the
--   coach later inserts a row and sheet rows shift):
--   Sheet order = rows by sheet_row, sets 1..n. "Next set" = the next set in sheet order; a
--   skipped one gets no timestamp (a skipped set refuses them, see the check). T = the server's now() at the
--   tap; every field one tap writes holds T, and undo clears a field only while it still holds T.
--   (none) -> started  "Begynd træning": the first set that is neither done nor skipped gets
--                      started_at = T if null. Otherwise the previous set's done or skip does.
--   started -> done    done on set k: k.ended_at = T if null; k.started_at = T if null (the very
--                      first set without a begin); the next set's started_at = T if null. So a
--                      set's span includes the rest before it (intended).
--   any -> skipped     skip on set k: k.skipped = true, both timestamps null, updated_at = T; the
--                      next set's started_at = T if null. A started_at the previous done wrote
--                      on k is cleared; undoing the skip restores it from that set's ended_at.
--   done -> earlier    undo of done on k: clears k.ended_at; k.started_at if it equals the
--                      cleared ended_at; the next set's started_at if it equals it.
--   skipped -> (none)  undo of skip on k: clears skipped; the next set's started_at if it equals
--                      k.updated_at.
--   any -> deleted     a row left with no timestamps and not skipped is deleted (the delete
--                      filters on exactly that, so it never removes timing).
--                      Risk: a cleared timestamp is gone; a re-tap writes a new T.
--   exercise_log -> here  copied as set 1 of the exercise's first sheet row in that session; its
--                      span covers the whole exercise, not set 1. A row with no such sheet row
--                      stays in exercise_log (the follow-up refuses to drop it then). On conflict do nothing: a set the
--                      new app already logged wins, and the old span for it is lost once
--                      exercise_log is dropped (only if both apps logged the same session).
--   Risk: deleting the table or a row loses real timing that no source holds.
-- planned_sets: rebuilt from strength_sets + strength_weeks + exercises by every compute run.
--   Risk: none; the next compute recreates every row.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. exercise_set_log: timing taps per set from the Træning screen
-- Written only by the Next.js server action (service key, server-side), behind Vercel
-- Authentication. Timestamps are the server's clock at the tap, never sent by the client.
-- Upsert on the primary key; undo is an update that clears fields, and a row left with no
-- timestamps and not skipped is deleted. The screen reads its session's rows back (by the
-- primary key's leading columns), so ticks survive a reload.
-- -----------------------------------------------------------------------------
create table public.exercise_set_log (
  date        date        not null,
  session_no  smallint    not null check (session_no >= 1),
  row_no      integer     not null check (row_no >= 1),
  set_no      smallint    not null check (set_no >= 1),
  exercise_id bigint      not null references public.exercises (id) on delete restrict,
  started_at  timestamptz,
  ended_at    timestamptz,
  skipped     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (date, session_no, row_no, set_no),
  check (started_at is null or ended_at is null or ended_at >= started_at),
  check (not skipped or (started_at is null and ended_at is null))
);

-- Foreign key; also "which sessions logged exercise X". Reads by (date, session_no) use the
-- primary key's leading columns.
create index exercise_set_log_exercise_id_idx on public.exercise_set_log (exercise_id);

comment on table public.exercise_set_log is
  'Start/end of each set in a strength session, tapped on the Træning screen; the per-set successor of exercise_log. Data collection only: nothing computes from it, Python never reads it, and it can''t be rebuilt. Purpose: later split the Garmin HR stream of a strength session per set. Written only by the Next.js server action (service key, server-side), behind Vercel Authentication. Keyed by date, session, sheet row and set number; exercise_id records which exercise it was. Tap rules (T = server time of the tap; "next set" = the next set in sheet order, which gets no timestamp if skipped): begin sets the first open set''s started_at; done on k sets k.ended_at, k.started_at if null, and the next set''s started_at if null; skip on k sets skipped, clears k''s timestamps and sets the next set''s started_at if null; undo clears only what that tap wrote (fields still equal to T); a row left with no timestamps and not skipped is deleted. Full rules: migration 20261012130000.';
comment on column public.exercise_set_log.date is
  'Europe/Copenhagen date of the session (the Træning screen''s date at the tap).';
comment on column public.exercise_set_log.session_no is
  'The n-th strength session of the ISO week, as shown on the screen at the tap (= strength_sets.session). Not re-numbered if intervals.icu later dates sessions differently; the timestamps stay right.';
comment on column public.exercise_set_log.exercise_id is
  'The exercise of the set''s sheet row (public.exercises, name or aliases, case-insensitive, trimmed). Restrict: an exercise with logged sets can''t be deleted; merging two spellings = add the alias, re-point these rows, then delete.';
comment on column public.exercise_set_log.row_no is
  '= strength_sets.sheet_row of the set''s prescription row in the coach''s tab. It shifts if the coach later inserts a row; exercise_id keeps the history right.';
comment on column public.exercise_set_log.set_no is
  '= strength_sets.set_no: 1-based set number within the sheet row.';
comment on column public.exercise_set_log.started_at is
  'Server time the set started: the begin tap, the previous set''s done or skip, or this set''s own done when nothing started it (then = ended_at). Includes the rest before the set. Null = not started (or undone, or skipped).';
comment on column public.exercise_set_log.ended_at is
  'Server time of the set''s done tap. Null = not done (or undone, or skipped).';
comment on column public.exercise_set_log.skipped is
  'True = the user skipped the set; it then has no timestamps. False is a real "not skipped", never "unknown".';
comment on column public.exercise_set_log.created_at is
  'First write of the row (exercise_log.created_at for rows copied from it).';
comment on column public.exercise_set_log.updated_at is
  'Set by the writer on every write to this row, to the tap''s server time T (no trigger). Undo of a skip compares the next set''s started_at with it.';

-- Copy the deployed app's per-exercise rows (0 rows on 2026-10-12) as set 1 of the exercise's
-- first sheet row in that session (name or alias, case-insensitive, trimmed). A row without such
-- a sheet row is not copied and stays in exercise_log. The span is the whole exercise, not set 1.
-- exercise_log itself stays as is: the deployed app writes it until the new code is deployed;
-- supabase/followups/20261012140000_drop_exercise_log.sql copies later rows and drops it.
insert into public.exercise_set_log
  (date, session_no, row_no, set_no, exercise_id, started_at, ended_at, skipped, created_at, updated_at)
select el.date, el.session_no, first_row.row_no, 1, el.exercise_id, el.started_at, el.ended_at, false,
       el.created_at, el.updated_at
from public.exercise_log el
join public.exercises e on e.id = el.exercise_id
join lateral (
  select min(s.sheet_row) as row_no
  from public.strength_sets s
  where s.week_start = date_trunc('week', el.date)::date
    and s.session = el.session_no
    and (lower(btrim(s.name)) = lower(btrim(e.name))
         or lower(btrim(s.name)) in (select lower(btrim(a)) from unnest(e.aliases) a))
) first_row on first_row.row_no is not null
on conflict do nothing;


-- -----------------------------------------------------------------------------
-- 2. planned_sets: suggested kg per set, rebuilt by compute (Python), read by the web
-- Idempotency (like ride_metrics): upsert on the strength_sets key with this run's computed_at,
-- then delete rows with an older computed_at (weeks that have passed, sets that left the sheet).
-- -----------------------------------------------------------------------------
create table public.planned_sets (
  sheet_id     text             not null,
  block        text             not null,
  sheet_row    integer          not null check (sheet_row > 0),
  week         integer          not null check (week > 0),
  set_no       integer          not null check (set_no > 0),
  week_start   date             not null check (extract(isodow from week_start) = 1),
  session      smallint         not null check (session > 0),
  exercise_id  bigint           references public.exercises (id) on delete set null,
  e1rm_lift    text             check (e1rm_lift is null or e1rm_lift in ('SQUAT', 'BENCH', 'DEADLIFT')),
  e1rm_kg      double precision check (e1rm_kg is null or e1rm_kg between 20 and 400),
  rpe          double precision check (rpe is null or rpe between 1 and 10),
  reps         double precision not null check (reps >= 0),
  pct          double precision check (pct is null or (pct > 0 and pct <= 1)),
  -- mod() has no double precision form in Postgres, hence the numeric cast (exact for multiples of 2.5).
  suggested_kg double precision check (suggested_kg is null or (suggested_kg > 0 and mod((suggested_kg * 10)::numeric, 25) = 0)),
  basis        text             not null check (basis in ('rpe_e1rm', 'not_rpe', 'no_e1rm', 'no_lift')),
  computed_at  timestamptz      not null,
  primary key (sheet_id, block, sheet_row, week, set_no),
  check ((rpe is null) = (pct is null)),
  check (e1rm_kg is null or e1rm_lift is not null),
  check (suggested_kg is null or basis = 'rpe_e1rm'),
  check (basis <> 'rpe_e1rm' or (e1rm_lift is not null and e1rm_kg is not null and rpe is not null and pct is not null))
);

-- The Træning screen reads one session: where week_start = ? and session = ? order by sheet_row, set_no.
create index planned_sets_session_idx on public.planned_sets (week_start, session, sheet_row, set_no);
-- Foreign key (on delete set null looks rows up by it).
create index planned_sets_exercise_id_idx on public.planned_sets (exercise_id);
-- compute's delete of rows from older runs: where computed_at < this run's.
create index planned_sets_computed_at_idx on public.planned_sets (computed_at);

comment on table public.planned_sets is
  'Rebuilt by compute (domain.planned_sets owns the calculation; the web only reads it): one row per strength_sets row of the run day''s ISO week and later, with a suggested kg for the Træning screen. suggested_kg = rolling e1RM of the exercise''s parent lift x pct(RPE, reps), rounded to 2.5 kg. Upserted with the run''s computed_at, then rows with an older computed_at are deleted. No history: the next compute recreates every row.';
comment on column public.planned_sets.week_start is
  '= strength_sets.week_start (the ISO week''s Monday).';
comment on column public.planned_sets.session is
  '= strength_sets.session (session 1..N of the ISO week).';
comment on column public.planned_sets.exercise_id is
  'The exercise the sheet name resolves to (public.exercises name or aliases, case-insensitive, trimmed). Null: the name is not in the catalogue (collect-strength inserts unknown names, so this is rare), or the exercise was deleted by hand (set null; the next compute fills it again).';
comment on column public.planned_sets.e1rm_lift is
  'The exercise''s parent_lift (public.exercises), whose e1RM is used; a main lift is its own parent. Set whenever the exercise has one, also without a suggestion. Null: no parent lift, or the name is not in the catalogue.';
comment on column public.planned_sets.e1rm_kg is
  'The rolling e1RM used: the highest weekly best e1RM (strength_weeks.e1rm_kg, lifted kg only) of e1rm_lift in the ROLLING_E1RM_WEEKS (4) ISO weeks ending with the run day''s week. Set only when basis = rpe_e1rm; null otherwise (no_e1rm = none in the window).';
comment on column public.planned_sets.rpe is
  'The prescribed RPE from the coach''s load cell (domain.planned_load.prescribed_rpe), the mid of a range ("RPE 5 - 7" -> 6). Null: not RPE-based, or an RPE cell that isn''t whole or half values. Never strength_sets.rpe (that holds a 6.0 fallback and %e1RM-derived values).';
comment on column public.planned_sets.reps is
  '= strength_sets.reps: reps per set, the mid of a range ("8 - 12" -> 10). 0 only where strength_sets has 0.';
comment on column public.planned_sets.pct is
  '1 / (1 + 0.0333 x (reps + 10 - rpe)) (domain.planned_sets.pct_of_e1rm): the e1RM relation /analyse uses (strength_weeks.e1rm_kg), so a suggestion is its exact inverse. The coach''s sheet has no RPE table. Null exactly when rpe is null.';
comment on column public.planned_sets.suggested_kg is
  'e1rm_kg x pct, rounded to the nearest 2.5 kg (halves up). Null = no suggestion (basis says why), never 0.';
comment on column public.planned_sets.basis is
  'Why there is or isn''t a suggestion (first match wins, domain.planned_sets): not_rpe (no RPE prescription, e.g. "-12.5%" or no load cell), no_lift (no parent lift: an accessory, or an unknown name), no_e1rm (no e1RM for the lift in the window), rpe_e1rm (suggested).';
comment on column public.planned_sets.computed_at is
  'UTC start time of the compute run that wrote this row; identical on every row of one run.';


-- -----------------------------------------------------------------------------
-- Access control (same pattern as 20261012100000: only what the writers need)
-- exercise_set_log: the server action reads a session's rows, upserts, clears fields, and
--   deletes rows that undo left with no timestamps and not skipped.
-- planned_sets: compute upserts and deletes rows from older runs; the web reads.
-- service_role is revoked first: the default privileges (auto-expose) may already have given
-- it ALL on new tables, and only the narrow grants below should hold for these two.
-- -----------------------------------------------------------------------------
alter table public.exercise_set_log enable row level security;
alter table public.planned_sets     enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.

revoke all on table public.exercise_set_log, public.planned_sets from anon, authenticated, service_role;

grant select, insert, update, delete on table public.exercise_set_log to service_role;
grant select, insert, update, delete on table public.planned_sets     to service_role;
