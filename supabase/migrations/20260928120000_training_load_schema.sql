-- =============================================================================
-- Famprove M1: training-load schema
-- =============================================================================
-- Tables (all in public)
--   activities     cycling activities mirrored from intervals.icu (Ride / VirtualRide only)
--   strength_sets  every prescribed set parsed from the coach's workbook (plan + logged kg)
--   blocks         one row per "Program - blok N" tab, derived by `compute`
--   daily_load     one row per local date 2026-01-01 .. today, derived by `compute`
-- View
--   weekly_load    ISO-week (Mon-Sun) sums over daily_load
--
-- Calculation ownership: Python owns every number (strength score, STRENGTH_K, daily TSS,
-- CTL/ATL/TSB, block dates). The only arithmetic in SQL is the ISO-week SUM in weekly_load
-- (agreed decision). No functions, triggers or RPC.
--
-- Access model (single user, no auth UI): RLS is enabled on every table with NO policies,
-- and anon / authenticated hold no privileges. Only service_role (BYPASSRLS) reads and
-- writes: the Python jobs today, the Next.js server in M2. Privileges for service_role are
-- granted explicitly because new tables are not guaranteed to be auto-exposed to the
-- Data API roles (see api.auto_expose_new_tables in supabase/config.toml).
--
-- Future tables (e.g. Garmin's daily_wellness keyed by date) must repeat the
-- enable-RLS + revoke + grant block at the bottom of this file.
-- =============================================================================


-- Safety net: objects that `postgres` creates in public later start with no privileges
-- for the client-facing roles.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;


-- -----------------------------------------------------------------------------
-- activities: cycling from intervals.icu
-- Idempotency: upsert on id (PostgREST on_conflict=id). Deletions are mirrored by
-- collect-intervals for start_date_local inside the fetched window only.
-- -----------------------------------------------------------------------------
create table public.activities (
  id                 text      primary key,
  start_date_local   timestamp not null,
  type               text      not null,
  name               text,
  training_load      integer,
  weighted_avg_watts integer,
  intensity_pct      double precision,
  ftp                integer,
  moving_time_s      integer,
  elapsed_time_s     integer,
  power_load         integer,
  hr_load            integer
);

-- Window filter for mirrored deletions (start_date_local >= since and < today + 1).
create index activities_start_date_local_idx on public.activities (start_date_local);

comment on table public.activities is
  'Cycling activities mirrored from intervals.icu. Only types Ride and VirtualRide are stored; the filter lives in Python (training_load.domain.cycling).';
comment on column public.activities.id is 'intervals.icu activity id, e.g. i55751783.';
comment on column public.activities.start_date_local is 'Athlete-local wall-clock start (intervals.icu start_date_local, no time zone). Its date is the day the load is bucketed to.';
comment on column public.activities.type is 'intervals.icu activity type (Ride or VirtualRide).';
comment on column public.activities.training_load is 'intervals.icu icu_training_load: power TSS, or HR-based estimate when there is no power. Null is kept and counted as 0 load.';
comment on column public.activities.weighted_avg_watts is 'intervals.icu icu_weighted_avg_watts (normalized power).';
comment on column public.activities.intensity_pct is 'intervals.icu icu_intensity, a PERCENT (85.3 means IF 0.853). Stored as delivered.';
comment on column public.activities.ftp is 'intervals.icu icu_ftp at the time of the activity (W).';
comment on column public.activities.moving_time_s is 'Moving time in seconds.';
comment on column public.activities.elapsed_time_s is 'Elapsed time in seconds.';
comment on column public.activities.power_load is 'intervals.icu power_load (informational).';
comment on column public.activities.hr_load is 'intervals.icu hr_load (informational).';


-- -----------------------------------------------------------------------------
-- strength_sets: one row per prescribed set in the coach's workbook
-- Idempotency: collect-strength deletes all rows for the sheet_id, then inserts the fresh
-- parse. It refuses to do so when the parse yields 0 rows. The natural primary key makes an
-- accidental double insert fail loudly (409) instead of duplicating sets.
-- -----------------------------------------------------------------------------
create table public.strength_sets (
  sheet_id    text             not null,
  block       text             not null,
  sheet_row   integer          not null check (sheet_row > 0),
  week        smallint         not null check (week > 0),
  set_no      smallint         not null check (set_no > 0),
  date        date             not null,
  type        text             not null,
  name        text             not null,
  reps        double precision not null,
  logged_kg   double precision not null,
  kg          double precision not null,
  bodyweight  boolean          not null,
  rpe         double precision,
  score       double precision not null,
  primary key (sheet_id, block, sheet_row, week, set_no)
);
-- The primary key index serves both access paths: DELETE ... WHERE sheet_id = ? (leading
-- column) and the paginated full read ORDER BY the primary-key columns.

comment on table public.strength_sets is
  'Every prescribed set parsed from the coach''s Google Sheet (plan + logged kg), all weeks, past and future. Which sets count toward strength TSS (filled week, date <= today) is decided in Python (training_load.domain.strength), not here.';
comment on column public.strength_sets.sheet_id is 'Google Sheet (Drive file) id the row was parsed from. Replace scope for idempotent re-runs.';
comment on column public.strength_sets.block is 'Workbook tab name, e.g. "Program - blok 11 ...".';
comment on column public.strength_sets.sheet_row is '1-based worksheet row the exercise was read from.';
comment on column public.strength_sets.week is '1-based week index within the tab.';
comment on column public.strength_sets.set_no is '1-based set number within the exercise row and week.';
comment on column public.strength_sets.date is 'Session date from the tab''s date row.';
comment on column public.strength_sets.type is 'Exercise type / muscle group from the sheet (SQUAT, BENCH, ..., ABS).';
comment on column public.strength_sets.reps is 'Reps per set (midpoint of a prescribed range, e.g. "8 - 12" -> 10).';
comment on column public.strength_sets.logged_kg is 'kg as logged in the sheet (0 when blank), before BODYWEIGHT is added.';
comment on column public.strength_sets.kg is 'Effective kg used in the score: logged_kg + BODYWEIGHT for bodyweight exercises, else logged_kg.';
comment on column public.strength_sets.bodyweight is 'True for bodyweight exercises (dips, chins, pull-ups, push-ups).';
comment on column public.strength_sets.rpe is 'RPE used in the score (from %e1RM, prescribed RPE, or 6.0 fallback). Null for ABS sets.';
comment on column public.strength_sets.score is 'Raw per-set score from the strength_collector formula, BEFORE STRENGTH_K is applied.';


-- -----------------------------------------------------------------------------
-- blocks: one row per "Program - blok N" tab, derived by `compute` from strength_sets
-- Idempotency: upsert on (sheet_id, name); rows whose key is no longer derived are deleted.
-- Deload flag: deload_start is not null. The deload week is [deload_start, end_date].
-- -----------------------------------------------------------------------------
create table public.blocks (
  sheet_id     text    not null,
  name         text    not null,
  block_no     integer not null,
  start_date   date    not null,
  end_date     date,
  deload_start date,
  primary key (sheet_id, name),
  constraint blocks_end_after_start
    check (end_date is null or end_date >= start_date),
  constraint blocks_deload_inside_block
    check (deload_start is null or (end_date is not null and deload_start between start_date and end_date))
);

-- M2 orders and range-filters block markers by date.
create index blocks_start_date_idx on public.blocks (start_date);

comment on table public.blocks is
  'Strength blocks, one per workbook tab, derived in Python (training_load.domain.strength.derive_blocks). No hand-kept list.';
comment on column public.blocks.name is 'Workbook tab name.';
comment on column public.blocks.block_no is 'N parsed from "Program - blok N ...". Orders blocks within a sheet.';
comment on column public.blocks.start_date is 'Start date of the first week that has any prescribed sets.';
comment on column public.blocks.end_date is 'Start date of the last filled week + 6 days. Null while no week is filled.';
comment on column public.blocks.deload_start is 'Deload flag + date. Null until the block is finished; then the start date of its last filled week, and the deload week runs deload_start .. end_date.';


-- -----------------------------------------------------------------------------
-- daily_load: the series the dashboard reads
-- Idempotency: `compute` rebuilds 2026-01-01 .. today (Europe/Copenhagen) from
-- activities + strength_sets, upserts on date and deletes rows outside that range.
-- -----------------------------------------------------------------------------
create table public.daily_load (
  date          date             primary key,
  cycling_tss   double precision not null,
  strength_tss  double precision not null,
  total_tss     double precision not null,
  ctl           double precision not null,
  atl           double precision not null,
  tsb           double precision not null
);

comment on table public.daily_load is
  'One row per local date from 2026-01-01 to today (Europe/Copenhagen), fully recomputed by `compute`. Every value is computed in Python; store-as-is, round only for display.';
comment on column public.daily_load.cycling_tss is 'Sum of intervals.icu icu_training_load for Ride/VirtualRide on this local date.';
comment on column public.daily_load.strength_tss is 'Sum of per-set scores x STRENGTH_K for counted sets (filled week, date <= today).';
comment on column public.daily_load.total_tss is 'cycling_tss + strength_tss (computed in Python); the load fed into CTL/ATL.';
comment on column public.daily_load.ctl is 'Chronic training load (tau 42 d), starts at 0 on 2026-01-01. Includes this day''s load.';
comment on column public.daily_load.atl is 'Acute training load (tau 7 d), starts at 0 on 2026-01-01. Includes this day''s load.';
comment on column public.daily_load.tsb is 'ctl - atl of the same day.';


-- -----------------------------------------------------------------------------
-- weekly_load: ISO-week key figure (security_invoker so the caller's rights apply)
-- -----------------------------------------------------------------------------
create view public.weekly_load
with (security_invoker = true) as
select
  date_trunc('week', d.date::timestamp)::date     as week_start,
  date_trunc('week', d.date::timestamp)::date + 6 as week_end,
  extract(isoyear from d.date)::integer           as iso_year,
  extract(week from d.date)::integer              as iso_week,
  sum(d.cycling_tss)                              as cycling_tss,
  sum(d.strength_tss)                             as strength_tss,
  sum(d.total_tss)                                as total_tss,
  count(*)::integer                               as days
from public.daily_load d
group by 1, 2, 3, 4;

comment on view public.weekly_load is
  'Total TSS per ISO week (Mon-Sun) over daily_load. The only arithmetic owned by SQL (agreed decision). days < 7 marks a partial week (the current one, or the first week of 2026).';


-- -----------------------------------------------------------------------------
-- Access control
-- -----------------------------------------------------------------------------
alter table public.activities    enable row level security;
alter table public.strength_sets enable row level security;
alter table public.blocks        enable row level security;
alter table public.daily_load    enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.

revoke all on table
  public.activities,
  public.strength_sets,
  public.blocks,
  public.daily_load,
  public.weekly_load
from anon, authenticated;

grant select, insert, update, delete on table
  public.activities,
  public.strength_sets,
  public.blocks,
  public.daily_load
to service_role;

grant select on table public.weekly_load to service_role;
