-- =============================================================================
-- Strength sessions are numbered, never dated by the sheet.
-- The coach's sheet defines sessions 1..N per ISO week (Mon-Sun). A session gets a date only
-- when intervals.icu logs a strength activity: the n-th WeightTraining activity of the ISO
-- week is session n. Nothing is inferred from the sheet's weekday sections.
--
-- strength_sets: loses `date`, gains `week_start` (the ISO week's Monday) and `session`.
--   Truncated here; `collect-strength` refills it on its next run (deploy together).
-- strength_activities: WeightTraining activities from intervals.icu (collect-intervals).
-- strength_sessions: derived by `compute` — planned sessions, done sessions and extras.
-- Access model unchanged: RLS on, no policies, anon/authenticated revoked, service_role only.
-- =============================================================================

truncate table public.strength_sets;

alter table public.strength_sets
  drop column date,
  add column week_start date     not null check (extract(isodow from week_start) = 1),
  add column session    smallint not null check (session > 0);

comment on column public.strength_sets.week_start is
  'Monday of the ISO week this sheet week falls in (from the tab''s week dates; the weekday of a section is ignored).';
comment on column public.strength_sets.session is
  'Session number within the ISO week (1..N): the tab''s day sections that prescribe sets that week, in sheet order.';
comment on table public.strength_sets is
  'Every prescribed set parsed from the coach''s Google Sheet (plan + logged kg), all weeks. A set counts toward strength TSS only when its (week_start, session) is matched by a strength activity (see strength_sessions).';


-- -----------------------------------------------------------------------------
-- strength_activities: mirror of intervals.icu WeightTraining activities.
-- Same idempotency as activities: upsert on id, mirror deletions inside the fetch window.
-- Their own training_load is display only; strength TSS comes from the sheet formula.
-- -----------------------------------------------------------------------------
create table public.strength_activities (
  id               text      primary key,
  start_date_local timestamp not null,
  type             text      not null,
  name             text,
  moving_time_s    integer,
  elapsed_time_s   integer,
  training_load    integer,
  device_name      text
);

create index strength_activities_start_date_local_idx
  on public.strength_activities (start_date_local);

comment on table public.strength_activities is
  'intervals.icu strength activities (type WeightTraining), incl. manual ones. The n-th of an ISO week is session n. training_load is intervals.icu''s value, display only.';


-- -----------------------------------------------------------------------------
-- strength_sessions: rebuilt by compute. One row per (ISO week, session number):
--   planned + done   plan columns and activity columns set, tss = sheet score x STRENGTH_K
--   planned, undone  activity columns null (no date), tss = 0
--   extra            plan columns null (more activities than planned sessions), tss = 0
-- -----------------------------------------------------------------------------
create table public.strength_sessions (
  week_start    date             not null check (extract(isodow from week_start) = 1),
  session       smallint         not null check (session > 0),
  sheet_id      text,
  block         text,
  week          smallint check (week > 0),
  activity_id   text,
  date          date,
  activity_name text,
  moving_time_s integer,
  tss           double precision not null default 0,
  primary key (week_start, session),
  check ((sheet_id is null) = (block is null) and (block is null) = (week is null)),
  check ((activity_id is null) = (date is null)),
  check (date is null or date between week_start and week_start + 6),
  check (block is not null or activity_id is not null)
);

create index strength_sessions_date_idx on public.strength_sessions (date);

comment on table public.strength_sessions is
  'Derived by compute: sheet sessions per ISO week matched to strength activities (n-th activity = session n). date is null until done; block is null for an extra activity (tss 0, "not in the program").';
comment on column public.strength_sessions.tss is
  'Strength TSS on date: sum of the session''s set scores x STRENGTH_K when done and planned, else 0.';


-- -----------------------------------------------------------------------------
-- Access control (same pattern as 20260928120000)
-- -----------------------------------------------------------------------------
alter table public.strength_activities enable row level security;
alter table public.strength_sessions   enable row level security;

revoke all on table public.strength_activities, public.strength_sessions from anon, authenticated;

grant select, insert, update, delete on table
  public.strength_activities,
  public.strength_sessions
to service_role;
