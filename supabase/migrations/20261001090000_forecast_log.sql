-- =============================================================================
-- Strength forecast from the coach's plan + a log of every forecast (decided 2026-10-01).
-- 1. strength_sets.e1rm: the tab's estimated 1RM for the set's lift (main lifts only), so
--    compute can turn a prescribed RPE into planned kg with the score formula's own table.
-- 2. daily_projection: an uncertainty band (null inside the block, where the plan is used)
--    and the strength method of the day ('plan' or 'recent').
-- 3. forecast_log: append-only history of each run's 56-day forecast and a naive baseline,
--    so forecast error can be measured later (Phase 2). Never rebuilt: past forecasts can't
--    be recreated honestly. The last run of a day replaces that day's rows.
-- Access model unchanged: RLS on, no policies, anon/authenticated revoked, service_role only.
-- =============================================================================

alter table public.strength_sets
  add column e1rm double precision check (e1rm is null or e1rm between 20 and 400);

comment on column public.strength_sets.e1rm is
  'The tab''s estimated 1RM (kg) for this set''s lift (SQUAT/BENCH/DEADLIFT), from the 1RM table at the top of the tab; null for other lifts or when implausible (outside 20-400 kg).';

alter table public.daily_projection
  add column strength_method text not null default 'plan' check (strength_method in ('plan', 'recent')),
  add column ctl_low  double precision,
  add column ctl_high double precision,
  add column atl_low  double precision,
  add column atl_high double precision,
  add column tsb_low  double precision,
  add column tsb_high double precision;

comment on column public.daily_projection.strength_method is
  'plan = strength from the coach''s prescription (inside the block); recent = recent weekly average after the block ends.';
comment on column public.daily_projection.ctl_low is
  'Band (low/high per metric): null inside the block; after it, the runs with the recent weeks'' min and max strength TSS.';

create table public.forecast_log (
  made_on         date             not null,
  target_date     date             not null check (target_date > made_on),
  method          text             not null check (method in ('model', 'naive')),
  cycling_tss     double precision not null,
  strength_tss    double precision not null,
  ctl             double precision not null,
  atl             double precision not null,
  tsb             double precision not null,
  ctl_low         double precision,
  ctl_high        double precision,
  atl_low         double precision,
  atl_high        double precision,
  tsb_low         double precision,
  tsb_high        double precision,
  strength_method text             check (strength_method is null or strength_method in ('plan', 'recent')),
  params          jsonb            not null,
  computed_at     timestamptz      not null,
  primary key (made_on, target_date, method)
);

comment on table public.forecast_log is
  'Every compute run''s 56-day forecast (method model) next to a naive baseline (method naive: the mean daily load of the 28 days before made_on, held flat). Append-only per made_on; used to measure forecast error later.';
comment on column public.forecast_log.params is
  'What produced the forecast: model_version, strength_k, decay. Compare errors only within the same params.';

alter table public.forecast_log enable row level security;
revoke all on table public.forecast_log from anon, authenticated;
grant select, insert, update, delete on table public.forecast_log to service_role;
