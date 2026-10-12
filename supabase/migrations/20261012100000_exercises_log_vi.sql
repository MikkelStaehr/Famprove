-- =============================================================================
-- Exercise catalogue, exercise timing log and ride VI (decided with the user 2026-10-12).
-- All additive: the code on main keeps running against this schema until the push (new
-- tables, new nullable columns only; both data layers select explicit column lists).
-- 1. exercises: hand-edited catalogue (Supabase table editor). collect-strength resolves each
--    sheet name against it (name or aliases, case-insensitive, trimmed) for the effective kg
--    and the muscle factor. strength_sets.muscle_factor keeps the factor used at collect time.
-- 2. exercise_log: start/end taps per exercise from the Today screen. Data collection only:
--    nothing computes from it, Python never reads it, and it can't be rebuilt.
-- 3. ride_metrics.vi / vi_warning: variability index, rebuilt by compute like the rest of
--    ride_metrics.
-- No functions, triggers or RPC. Access model unchanged: RLS on, no policies,
-- anon/authenticated revoked, service_role granted only what the writers need.
--
-- State transitions and data-loss risk (tables that can't be rebuilt from a source)
-- exercises (hand-kept; key = identity id, so a rename keeps its history and log rows):
--   (none) -> row      seed below, or collect-strength inserts an unknown sheet name with
--                      accessory / 0.6 / null / false and logs a warning (insert only,
--                      ignore duplicates; service_role cannot update or delete).
--                      Risk: none; a duplicate insert is ignored.
--   row -> edited      by hand. Takes effect at the next collect-strength + compute (the
--                      whole workbook is re-scored). Risk: renaming a row without adding the
--                      old spelling to aliases makes the next collect-strength insert the old
--                      sheet name again as an unknown accessory (no data lost, a wrong factor).
--   row -> deleted     by hand only. Refused while exercise_log references it (restrict), so
--                      merging two spellings = add the alias, re-point the log rows, then
--                      delete. Risk: a deleted row that the sheet still uses comes back as an
--                      unknown accessory; its hand-set values are lost.
-- exercise_log (key = date + the Today session number + the exercise, never a list position):
--   (none) -> started  first tick on any row of X, or the tick of the previous exercise's
--                      last row, whichever comes first (first write wins).
--   started -> ended   tick of X's last row sets ended_at.
--   any -> earlier     undo clears exactly what that tap wrote: every field one tap writes
--                      holds the same server now(), and undo clears a field only while it
--                      still holds that value. A row left with both null is deleted.
--                      Risk: a cleared timestamp is gone; a re-tick writes a new now().
--   Risk: deleting the table or a row loses real timing that no source holds.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. exercises: the catalogue
-- Seed: the first 26 names are every distinct name in strength_sets on 2026-10-12. Push-ups
-- and Chin-ups are not in the sheet yet: they are the user's stated bodyweight defaults (the
-- old code's bodyweight names). Alias candidates the user may merge by hand: "Bænk" /
-- "Bænkpres" and "FFE zercher split squat" / "Zercher FFE split squat".
-- The identity sequence needs no grant: Postgres draws an identity value without checking
-- sequence privileges, and "generated always" refuses a hand-typed id.
-- -----------------------------------------------------------------------------
create table public.exercises (
  id                  bigint           generated always as identity primary key,
  name                text             not null check (length(btrim(name)) > 0),
  aliases             text[]           not null default '{}',
  category            text             not null check (category in ('main', 'accessory', 'isolation', 'bodyweight', 'abs')),
  parent_lift         text             check (parent_lift is null or parent_lift in ('SQUAT', 'BENCH', 'DEADLIFT')),
  muscle_factor       double precision not null check (muscle_factor > 0 and muscle_factor <= 2),
  bodyweight_fraction double precision check (bodyweight_fraction is null or bodyweight_fraction between 0 and 1),
  tracks_e1rm         boolean          not null default false,
  created_at          timestamptz      not null default now(),
  constraint exercises_name_key unique (name)
);

-- collect-strength matches case-insensitively and trimmed; this index makes "Squat" and
-- " squat" one exercise. exercises_name_key stays for PostgREST on_conflict=name.
create unique index exercises_name_lower_idx on public.exercises (lower(btrim(name)));

comment on table public.exercises is
  'Exercise catalogue, edited by hand in the Supabase table editor. collect-strength resolves every sheet name against name and aliases (case-insensitive, trimmed); a name it doesn''t know is inserted with accessory / 0.6 / null / false and a warning. Editing a value takes effect at the next collect-strength + compute (the whole workbook is re-scored).';
comment on column public.exercises.name is
  'The exercise name as written in the sheet. Unique, also case-insensitively and trimmed (exercises_name_lower_idx). Renaming: add the old spelling to aliases, or the sheet name comes back as a new unknown exercise.';
comment on column public.exercises.aliases is
  'Other spellings in the sheet, matched case-insensitively and trimmed. Empty = none. Not checked for overlap with other rows here (no triggers): collect-strength must fail loudly when a sheet name matches more than one exercise.';
comment on column public.exercises.category is
  'main | accessory | isolation | bodyweight | abs. abs rows keep the formula''s fixed ABS score, so muscle_factor is unused for category abs.';
comment on column public.exercises.parent_lift is
  'The competition lift this exercise belongs to (variants included); null = none.';
comment on column public.exercises.muscle_factor is
  'Replaces the code''s leg/upper factor (1.0 / 0.6) in the strength score: score = reps x kg x (RPE/10)^2 x muscle_factor. Unused for category abs (fixed score). 0 is not allowed.';
comment on column public.exercises.bodyweight_fraction is
  'Effective kg = logged kg + BODYWEIGHT x bodyweight_fraction (Python, collect-strength; stored in strength_sets.kg). Null = not a bodyweight exercise (no BODYWEIGHT added). 0 = a bodyweight exercise where none of the bodyweight counts (allowed but odd).';
comment on column public.exercises.tracks_e1rm is
  'Stored for later (an e1RM line per exercise); nothing reads it yet.';

insert into public.exercises (name, category, parent_lift, muscle_factor, bodyweight_fraction, tracks_e1rm, aliases) values
  ('Squat',                    'main',       'SQUAT',    1.0, null, true,  '{}'::text[]),
  ('Bænk',                     'main',       'BENCH',    1.0, null, true,  '{}'::text[]),
  ('Bænkpres',                 'main',       'BENCH',    1.0, null, true,  '{}'::text[]),
  ('Dødløft',                  'main',       'DEADLIFT', 1.0, null, true,  '{}'::text[]),
  ('3.0.0 Tempo squat',        'accessory',  'SQUAT',    0.6, null, false, '{}'::text[]),
  ('3.2.0 tempo squat',        'accessory',  'SQUAT',    0.6, null, false, '{}'::text[]),
  ('3.2.0 Tempo bænk',         'accessory',  'BENCH',    0.6, null, false, '{}'::text[]),
  ('Low incline DB press',     'accessory',  null,       0.6, null, false, '{}'::text[]),
  ('Lat pulldowns',            'accessory',  null,       0.6, null, false, '{}'::text[]),
  ('Neutral grip cable row',   'accessory',  null,       0.6, null, false, '{}'::text[]),
  ('Rows of choice',           'accessory',  null,       0.6, null, false, '{}'::text[]),
  ('FFE zercher split squat',  'accessory',  null,       0.6, null, false, '{}'::text[]),
  ('Zercher FFE split squat',  'accessory',  null,       0.6, null, false, '{}'::text[]),
  ('RFE split squat',          'accessory',  null,       0.6, null, false, '{}'::text[]),
  ('Facepulls',                'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Bicep of choice',          'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Tricep of choice',         'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Lying leg curl',           'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Single leg leg extension', 'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Cable lateral raise',      'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Lateral raise of choice',  'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Rear delt flyes',          'isolation',  null,       0.3, null, false, '{}'::text[]),
  ('Dips',                     'bodyweight', null,       0.6, 1.0,  false, array['Dip']::text[]),
  ('Pullups',                  'bodyweight', null,       0.6, 1.0,  false, array['Pull-ups', 'Pull-up', 'Pullup']::text[]),
  ('Glute ham raise',          'bodyweight', null,       0.6, 0.6,  false, '{}'::text[]),
  ('Abs of choice',            'abs',        null,       0.6, null, false, '{}'::text[]),
  -- Not in the sheet yet: the user's stated bodyweight defaults (the old code's bodyweight names).
  ('Push-ups',                 'bodyweight', null,       0.6, 0.65, false, array['Push-up', 'Pushups', 'Push ups']::text[]),
  ('Chin-ups',                 'bodyweight', null,       0.6, 1.0,  false, array['Chin-up', 'Chins']::text[])
on conflict do nothing;

-- The factor each set was scored with, so compute can score planned sets the same way.
alter table public.strength_sets
  add column muscle_factor double precision
    check (muscle_factor is null or (muscle_factor > 0 and muscle_factor <= 2));

comment on column public.strength_sets.muscle_factor is
  'The exercise''s muscle_factor from public.exercises at collect time (collect-strength resolves the sheet name case-insensitively against name/aliases; unknown names get 0.6 and a warning). compute uses it to score planned sets that have no logged kg (the 56-day prognose). Null only on rows written by older code; compute then falls back to 0.6 and counts it in a warning.';
-- Since the catalogue, kg / bodyweight / score follow public.exercises instead of code lists.
comment on column public.strength_sets.kg is
  'Effective kg used in the score: logged_kg + BODYWEIGHT x the exercise''s bodyweight_fraction (public.exercises) for bodyweight exercises, else logged_kg (0 when blank).';
comment on column public.strength_sets.bodyweight is
  'True when the exercise has a bodyweight_fraction in public.exercises (at collect time).';
comment on column public.strength_sets.score is
  'Raw per-set score from the strength_collector formula with the exercise''s muscle_factor (public.exercises), BEFORE STRENGTH_K is applied.';


-- -----------------------------------------------------------------------------
-- 2. exercise_log: timing taps from the Today screen
-- Written only by the Next.js server action (service key, server-side), behind Vercel
-- Authentication. Timestamps are the server's clock at the tap, never sent by the client.
-- Upsert on the primary key; undo is an update that clears fields, and a row left with both
-- timestamps null is deleted (the delete filters on both being null, so it never removes timing).
-- -----------------------------------------------------------------------------
create table public.exercise_log (
  date        date        not null,
  session_no  smallint    not null check (session_no >= 1),
  exercise_id bigint      not null references public.exercises (id) on delete restrict,
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (date, session_no, exercise_id),
  check (started_at is null or ended_at is null or ended_at >= started_at)
);

-- Foreign key; also "which sessions logged exercise X". Reads by (date, session_no) use the
-- primary key's leading columns.
create index exercise_log_exercise_id_idx on public.exercise_log (exercise_id);

comment on table public.exercise_log is
  'Start/end of each exercise in a strength session, tapped on the Today screen. Data collection only: nothing computes from it, Python never reads it, and it can''t be rebuilt. Purpose: later split the Garmin HR stream of a strength session per exercise. Written only by the Next.js server action (service key, server-side), behind Vercel Authentication. Tap rules: a tick on any row of exercise X sets X.started_at if null; ticking X''s last row sets X.ended_at and the next exercise''s started_at if null (first write wins); undo clears what that tap wrote.';
comment on column public.exercise_log.date is
  'Europe/Copenhagen date of the session (the Today screen''s date at the tap).';
comment on column public.exercise_log.session_no is
  'The n-th strength session of the ISO week, as shown on Today at the tap. Not re-numbered if intervals.icu later dates sessions differently; the timestamps stay right.';
comment on column public.exercise_log.started_at is
  'Server time of the tap that started X; null = not started (or undone).';
comment on column public.exercise_log.ended_at is
  'Server time of the tick on X''s last row; null = not ended (or undone).';
comment on column public.exercise_log.updated_at is
  'Set by the writer on every write (no trigger).';


-- -----------------------------------------------------------------------------
-- 3. ride_metrics: variability index (rebuilt by compute; null on rows from older code)
-- -----------------------------------------------------------------------------
alter table public.ride_metrics
  add column vi double precision check (vi is null or (vi >= 1.0 and vi <= 2.0)),
  add column vi_warning boolean,
  add constraint ride_metrics_vi_warning_with_vi check ((vi is null) = (vi_warning is null));

comment on column public.ride_metrics.vi is
  'Variability index = normalized power / average power (intervals.icu icu_weighted_avg_watts / icu_average_watts), 2 dp, computed by compute. Null when either is missing or the ratio is outside [1.0, 2.0] (counted in the log, never clamped).';
comment on column public.ride_metrics.vi_warning is
  'True when vi > 1.15 on a Z2 day (a planned_sessions name on that date or the ride''s own name contains "Z2" as a word, case-insensitive); false otherwise; null when vi is null.';


-- -----------------------------------------------------------------------------
-- Access control (same pattern as 20260929100000: only what the writers need)
-- exercises: collect-strength reads and inserts unknown names (ignore duplicates = insert
--   only); hand edits happen in the table editor, so service_role can't overwrite them.
-- exercise_log: the server action reads, upserts, clears fields, and deletes rows that undo
--   left with both timestamps null.
-- service_role is revoked first: the default privileges (auto-expose) may already have given
-- it ALL on new tables, and only the narrow grants below should hold for these two.
-- -----------------------------------------------------------------------------
alter table public.exercises    enable row level security;
alter table public.exercise_log enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.

revoke all on table public.exercises, public.exercise_log from anon, authenticated, service_role;
-- Belt and braces: the default-privileges safety net (20260928120000) already covers it.
revoke all on sequence public.exercises_id_seq from anon, authenticated;

grant select, insert on table public.exercises to service_role;
grant select, insert, update, delete on table public.exercise_log to service_role;
