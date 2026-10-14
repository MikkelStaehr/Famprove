-- Answers round (user, 2026-10-14), one migration for the missing data of two slices:
--   planned-rides-icu    public.planned_events: the intervals.icu calendar mirrored raw by
--                        collect-intervals; compute uses its planned rides instead of the typical
--                        cycling week in any ISO week that has one.
--   board-rolling-e1rm   strength_weeks.rolling_e1rm_kg / rolling_e1rm_week: the suggestions'
--                        rolling 4-week e1RM as of each week, for the Styrke board.
-- Access model unchanged: RLS on, no policies, anon/authenticated revoked, service_role only.

create table public.planned_events (
  id         bigint           primary key,
  date       date             not null,
  category   text             not null,
  type       text,
  name       text,
  load       double precision check (load is null or load > 0),
  raw        jsonb            not null,
  fetched_at timestamptz      not null
);

comment on table public.planned_events is
  'The intervals.icu calendar (GET /athlete/{id}/events), mirrored by collect-intervals: upsert on the event id, deletions mirrored inside the fetched window (this ISO week .. the week of today + 56 days). Every event is stored; compute counts category WORKOUT with type Ride/VirtualRide as a planned ride.';
comment on column public.planned_events.date is
  'The local date of start_date_local.';
comment on column public.planned_events.load is
  'intervals.icu''s planned load (icu_training_load). Null = missing (absent, not a number, or 0: a planned ride with 0 load has no steps); never stored as 0.';
comment on column public.planned_events.raw is
  'The event object as delivered by intervals.icu.';

alter table public.planned_events enable row level security;
revoke all on table public.planned_events from anon, authenticated;
grant select, insert, update, delete on table public.planned_events to service_role;

alter table public.strength_weeks
  add column rolling_e1rm_kg double precision
    check (rolling_e1rm_kg is null or rolling_e1rm_kg between 20 and 400),
  add column rolling_e1rm_week date,
  add constraint strength_weeks_rolling_pair
    check ((rolling_e1rm_kg is null) = (rolling_e1rm_week is null)),
  add constraint strength_weeks_rolling_window
    check (rolling_e1rm_week is null or rolling_e1rm_week between week_start - 21 and week_start);

comment on column public.strength_weeks.rolling_e1rm_kg is
  'The rolling e1RM as of this week: the best weekly e1rm_kg of the lift in the 4 ISO weeks ending here (the number planned_sets uses for suggested kg). Null when none of those weeks has one.';
comment on column public.strength_weeks.rolling_e1rm_week is
  'The week_start of the week that rolling_e1rm_kg comes from (ties: the latest).';
