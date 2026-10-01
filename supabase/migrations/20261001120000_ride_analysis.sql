-- =============================================================================
-- Analyse / Cykel (task d, decided 2026-10-01): "am I getting fitter on the bike?"
-- 1. activities.raw / strength_activities.raw: the intervals.icu activity object as delivered,
--    stored once, so new views are narrowed in Python instead of needing new columns.
-- 2. ride_metrics: rebuilt by compute. One row per ride since 2024-12-30 (the ISO week of 2025-01-01) with the values the
--    trends use, why a ride is left out of them (shown, never hidden) and the EF trend.
-- 3. cycling_weeks: rebuilt by compute. One row per ISO week since 2024-12-30, an explicit 0
--    for a week without rides, so gaps are visible. Every ride counts (hours and load match
--    /load); the trend exclusions are analytics-only.
-- daily_load, weekly_load and CTL/ATL are untouched (CTL still starts 2026-01-01).
-- Access model unchanged: RLS on, no policies, anon/authenticated revoked, service_role only.
-- =============================================================================

alter table public.activities add column raw jsonb;
alter table public.strength_activities add column raw jsonb;

comment on column public.activities.raw is
  'The intervals.icu activity object as delivered (null until the row is collected again). Narrowed in Python (sources.intervals.ride_facts).';
comment on column public.strength_activities.raw is
  'The intervals.icu activity object as delivered (null until the row is collected again).';

create table public.ride_metrics (
  activity_id     text             primary key,
  date            date             not null,
  type            text             not null,
  moving_s        integer          check (moving_s is null or moving_s >= 0),
  distance_m      double precision check (distance_m is null or distance_m >= 0),
  load            integer,
  np_w            integer,
  avg_hr          integer,
  device_watts    boolean,
  ftp_w           integer,
  if_set          double precision,
  rolling_ftp_w   integer,
  if_eftp         double precision,
  ef              double precision,
  exclusion       text             check (exclusion is null or exclusion in ('no_raw', 'too_short', 'power_outlier', 'hr_outlier')),
  eftp_ok         boolean          not null,
  eftp_gap_before boolean          not null,
  ef_ok           boolean          not null,
  ef_trend        double precision,
  ef_gap_before   boolean          not null,
  eftp_year_ago_date date,
  eftp_year_ago_w    integer,
  eftp_delta_w       integer,
  computed_at     timestamptz      not null,
  check (not eftp_ok or (rolling_ftp_w is not null and (exclusion is null or exclusion = 'hr_outlier'))),
  check (not ef_ok or (ef is not null and ef_trend is not null and exclusion is null)),
  check (ef_ok or ef_trend is null),
  check ((eftp_year_ago_date is null) = (eftp_year_ago_w is null) and (eftp_year_ago_w is null) = (eftp_delta_w is null)),
  check (eftp_ok or eftp_year_ago_w is null)
);

create index ride_metrics_date_idx on public.ride_metrics (date);

comment on table public.ride_metrics is
  'Rebuilt by compute: every Ride/VirtualRide since 2024-12-30 (domain.ride_analysis). Excluded rides stay as rows with a reason so the UI can show them.';
comment on column public.ride_metrics.if_set is
  'intervals.icu IF as a ratio (icu_intensity / 100), on the FTP set at the time; HR-based when the ride has no power.';
comment on column public.ride_metrics.rolling_ftp_w is
  'intervals.icu icu_rolling_ftp: its eFTP on the day of the ride (athlete-level, also on rides without power).';
comment on column public.ride_metrics.if_eftp is
  'NP / rolling_ftp_w; null without both.';
comment on column public.ride_metrics.ef is
  'Efficiency factor NP / average HR on a power ride with HR; null otherwise.';
comment on column public.ride_metrics.exclusion is
  'Why the ride is left out of the trends: no_raw (not collected since raw was added), too_short (< 5 min moving or < 1 km), power_outlier (power rides; out of eFTP and EF), hr_outlier (out of EF only). Null = in.';
comment on column public.ride_metrics.eftp_ok is
  'A point on the eFTP trend: a real power meter, NP present, not too short, no power outlier, eFTP inside its bounds.';
comment on column public.ride_metrics.eftp_gap_before is
  'The previous eFTP point is more than 21 days earlier (or there is none): the line breaks before this point.';
comment on column public.ride_metrics.ef_ok is
  'A point on the EF trend: an eFTP point with HR, no outlier, at least 30 min moving and endurance intensity (domain.ride_analysis.ENDURANCE).';
comment on column public.ride_metrics.ef_trend is
  'Median EF of the EF points in the 28 days ending on this ride''s date; null when ef_ok is false.';
comment on column public.ride_metrics.eftp_year_ago_w is
  'On an eFTP point: the latest eFTP point 365-386 days earlier (its date in eftp_year_ago_date; eftp_delta_w = rolling_ftp_w - this). Null when there is none.';
comment on column public.ride_metrics.ef_gap_before is
  'The previous EF point is more than 21 days earlier (or there is none): the line breaks before this point.';

alter table public.ride_metrics enable row level security;
revoke all on table public.ride_metrics from anon, authenticated;
grant select, insert, update, delete on table public.ride_metrics to service_role;

create table public.cycling_weeks (
  week_start  date        primary key check (extract(isodow from week_start) = 1),
  rides       integer     not null check (rides >= 0),
  moving_s    integer     not null check (moving_s >= 0),
  load        integer     not null check (load >= 0),
  excluded    integer     not null check (excluded between 0 and rides),
  computed_at timestamptz not null
);

comment on table public.cycling_weeks is
  'Rebuilt by compute: one row per ISO week from 2024-12-30 (the week of 2025-01-01) to the current week. rides = 0 is a real week without rides (intervals.icu is complete), not missing data.';
comment on column public.cycling_weeks.moving_s is
  'Sum of moving time of every ride that week (a ride without moving time adds nothing; compute logs the count).';
comment on column public.cycling_weeks.load is
  'Sum of intervals.icu load of every ride that week (null load counts as 0, as in daily_load).';
comment on column public.cycling_weeks.excluded is
  'Rides that week that are left out of the trends (ride_metrics.exclusion is not null).';

alter table public.cycling_weeks enable row level security;
revoke all on table public.cycling_weeks from anon, authenticated;
grant select, insert, update, delete on table public.cycling_weeks to service_role;
