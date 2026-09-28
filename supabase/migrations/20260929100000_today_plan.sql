-- =============================================================================
-- Today screen: the prescription as written, planned rides and their watt targets.
-- Additive only. Access model unchanged: RLS on with no policies, anon/authenticated
-- revoked, service_role granted only what the jobs need.
-- =============================================================================

-- The coach's sets/reps cells as written ("2", "8 - 12"); display only. The numeric
-- sets/reps used by the strength formula stay in their own columns.
alter table public.strength_sets
  add column sets_text text,
  add column reps_text text;

comment on column public.strength_sets.sets_text is
  'The prescribed sets cell as written in the sheet (e.g. "2"). Display only.';
comment on column public.strength_sets.reps_text is
  'The prescribed reps cell as written in the sheet (e.g. "8 - 12"). Display only; reps holds the midpoint the formula uses.';


-- -----------------------------------------------------------------------------
-- planned_sessions: filled by the user (Supabase table editor). Python only reads it.
-- steps: JSON array, in order. Each item is either
--   a step    {"label": "Warm-up", "minutes": 10, "pct_ftp": 55}          (pct_ftp may be [50, 75])
--   a repeat  {"repeat": 4, "steps": [{"label": "On", "minutes": 8, "pct_ftp": 95},
--                                     {"label": "Off", "minutes": 4, "pct_ftp": 55}]}
-- Repeats nest one level. collect-plan validates it and writes planned_targets.
-- -----------------------------------------------------------------------------
create table public.planned_sessions (
  date  date  not null,
  name  text  not null check (length(trim(name)) > 0),
  steps jsonb not null default '[]'::jsonb,
  notes text,
  primary key (date, name)
);

comment on table public.planned_sessions is
  'Planned rides, filled by hand (intervals.icu has no planned workouts). steps: see the migration header for the JSON format. Read by collect-plan only.';


-- -----------------------------------------------------------------------------
-- planned_targets: derived by collect-plan (Python owns the watts). Rebuilt on every run:
-- upsert on (date, name), rows whose planned session is gone are deleted.
-- steps: [{"kind":"step","label","minutes","pct_low","pct_high","watts_low","watts_high"} |
--         {"kind":"repeat","repeat","steps":[step, ...]}]; watts are null when ftp is null.
-- problem: set (and steps empty) when the planned session's steps could not be read.
-- -----------------------------------------------------------------------------
create table public.planned_targets (
  date          date             not null,
  name          text             not null,
  notes         text,
  ftp           integer,
  total_minutes double precision not null,
  steps         jsonb            not null,
  problem       text,
  computed_at   timestamptz      not null,
  primary key (date, name)
);

comment on table public.planned_targets is
  'Planned rides with watt targets computed by collect-plan from planned_sessions and the current intervals.icu FTP. Read by the Today screen.';
comment on column public.planned_targets.ftp is 'Ride FTP (W) from intervals.icu sport settings at computed_at; null if intervals.icu has none.';
comment on column public.planned_targets.problem is 'Why the planned session''s steps could not be used (plain words), else null.';


-- -----------------------------------------------------------------------------
-- Access control (same pattern as 20260928120000)
-- -----------------------------------------------------------------------------
alter table public.planned_sessions enable row level security;
alter table public.planned_targets  enable row level security;

revoke all on table public.planned_sessions, public.planned_targets from anon, authenticated;

grant select on table public.planned_sessions to service_role;
grant select, insert, update, delete on table public.planned_targets to service_role;
