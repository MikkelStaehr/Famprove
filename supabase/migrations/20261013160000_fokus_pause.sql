-- =============================================================================
-- Fokus pause screen (user, 2026-10-13; slices fokus-warmup, fokus-felt-rpe, fokus-pause-content).
-- One migration for all of it:
-- 1. exercise_set_log: kind ('set' | 'warmup'; a warm-up is set_no 0 on the exercise's first sheet
--    row, from entering it to "Til sæt 1"), derived (a backfilled warm-up), felt_rpe (-1/0/+1)
--    and reps_done (range prescriptions). Python reads felt_rpe and reps_done from now on.
--    Backfill: a derived warm-up for every earlier exercise run, from the gap before set 1.
-- 2. strength_sets.notes: the coach's NOTES cell (collect-strength).
-- 3. planned_sets: adjustment_kg + adjustment_reason (felt-RPE and top-of-range progression),
--    rest_min_s / rest_max_s (recommended rest), ramp (warm-up ramp of a main lift); basis gains
--    'progression' (an accessory's suggestion = last week's kg + the step).
-- 4. exercise_feel: one Styrke line per exercise with 4+ rated sets (compute).
-- Additive: new nullable columns, relaxed checks and a new table, so the code on main keeps
-- running (it writes none of the new columns).
-- State transitions and data-loss risk: none for 2-4 (rebuilt by collect-strength / compute).
-- exercise_set_log is persistent: the backfill only inserts derived warm-up rows (on conflict do
-- nothing) and changes no recorded row.
-- =============================================================================

-- 1. exercise_set_log --------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.exercise_set_log'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%set_no >= 1%'
  loop
    execute format('alter table public.exercise_set_log drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.exercise_set_log
  add column kind      text         not null default 'set' check (kind in ('set', 'warmup')),
  add column derived   boolean      not null default false,
  add column felt_rpe  smallint     check (felt_rpe is null or felt_rpe in (-1, 0, 1)),
  add column reps_done numeric(4, 1) check (reps_done is null or (reps_done > 0 and reps_done <= 100)),
  add constraint exercise_set_log_set_no_check check (set_no >= 0),
  add constraint exercise_set_log_warmup_is_set_0 check ((kind = 'warmup') = (set_no = 0)),
  add constraint exercise_set_log_derived_only_warmup check (not derived or kind = 'warmup'),
  add constraint exercise_set_log_feel_reps_only_sets
    check (kind = 'set' or (felt_rpe is null and reps_done is null));

comment on column public.exercise_set_log.kind is
  'set = a prescribed set (set_no >= 1); warmup = the warm-up before set 1 of an exercise run (set_no 0, row_no = the run''s first sheet row): started when it was entered ("Begynd træning", or the done/skip that finished the previous exercise), ended by "Til sæt 1", which also starts set 1. Never counts toward strength TSS (that comes from strength_sets).';
comment on column public.exercise_set_log.derived is
  'True on a warm-up row backfilled by migration 20261013160000 from a session logged before warm-ups existed: start = set 1''s start, length = set 1''s span minus the session''s median span of the other sets (kept only when 0 < length <= 30 min). For those sessions set 1''s own span still includes the warm-up.';
comment on column public.exercise_set_log.felt_rpe is
  'How the set felt against its prescription, tapped after Udført: -1 Lettere, 0 Som ventet, +1 Hårdere. Null = not rated (optional). Only on kind = set. Python uses it for suggestion adjustments (domain.planned_sets) and exercise_feel.';
comment on column public.exercise_set_log.reps_done is
  'Reps done on a set whose prescription is a range (e.g. 8 - 12): the done tap writes the top of the range, the pause screen''s stepper adjusts it. Null = a fixed-rep set or not entered. Python uses it instead of the range midpoint for e1RM and the set score. 0 is invalid.';
comment on table public.exercise_set_log is
  'Start/end of each set (and each exercise''s warm-up) in a strength session, tapped on the Træning screens, plus felt RPE and reps done. Written only by the Next.js server action (service key, server-side), behind Vercel Authentication; can''t be rebuilt. Python reads felt_rpe and reps_done (since 2026-10-13); the timestamps are for splitting the Garmin HR stream later. Tap rules: migration 20261012130000; warm-ups (set 0) follow the same rules as a set in the sheet''s order: migration 20261013160000.';

-- Backfill: a derived warm-up before set 1 of every exercise run logged so far.
with s as (
  select l.*,
         lag(l.exercise_id) over (partition by l.date, l.session_no order by l.row_no, l.set_no) as prev_ex,
         extract(epoch from (l.ended_at - l.started_at)) as span_s
  from public.exercise_set_log l
  where l.kind = 'set'
),
marked as (
  select s.*, (s.set_no = 1 and (s.prev_ex is null or s.prev_ex <> s.exercise_id)) as run_start
  from s
),
typical as (
  select date, session_no, percentile_cont(0.5) within group (order by span_s) as med
  from marked
  where not skipped and span_s is not null and not run_start
  group by date, session_no
)
insert into public.exercise_set_log
  (date, session_no, row_no, set_no, exercise_id, started_at, ended_at, kind, derived)
select m.date, m.session_no, m.row_no, 0, m.exercise_id,
       m.started_at, m.started_at + make_interval(secs => m.span_s - t.med), 'warmup', true
from marked m
join typical t using (date, session_no)
where m.run_start and not m.skipped and m.span_s is not null
  and m.span_s - t.med > 0 and m.span_s - t.med <= 1800
on conflict (date, session_no, row_no, set_no) do nothing;

-- 2. strength_sets.notes ------------------------------------------------------------------------
alter table public.strength_sets
  add column notes text check (notes is null or length(btrim(notes)) > 0);
comment on column public.strength_sets.notes is
  'The coach''s NOTES cell for this row and week, as written (e.g. "Palloff + GHD"). Null = blank. Shown under the next-set card on Fokus.';

-- 3. planned_sets --------------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.planned_sets'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%basis%'
  loop
    execute format('alter table public.planned_sets drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.planned_sets
  add column adjustment_kg     double precision check (adjustment_kg is null or adjustment_kg in (0, 2.5, 5)),
  add column adjustment_reason text check (adjustment_reason is null or length(btrim(adjustment_reason)) > 0),
  add column rest_min_s        integer check (rest_min_s is null or rest_min_s > 0),
  add column rest_max_s        integer,
  add column ramp              jsonb check (ramp is null or jsonb_typeof(ramp) = 'array'),
  add constraint planned_sets_basis_check
    check (basis in ('rpe_e1rm', 'not_rpe', 'no_e1rm', 'no_lift', 'progression')),
  add constraint planned_sets_suggestion_basis
    check (suggested_kg is null or basis in ('rpe_e1rm', 'progression')),
  add constraint planned_sets_rpe_e1rm_complete
    check (basis <> 'rpe_e1rm' or (e1rm_lift is not null and e1rm_kg is not null and rpe is not null and pct is not null)),
  add constraint planned_sets_progression_complete
    check (basis <> 'progression' or (suggested_kg is not null and adjustment_reason is not null)),
  add constraint planned_sets_adjustment_pair check ((adjustment_kg is null) = (adjustment_reason is null)),
  add constraint planned_sets_rest_pair
    check ((rest_min_s is null) = (rest_max_s is null) and (rest_max_s is null or rest_max_s >= rest_min_s));

comment on column public.planned_sets.basis is
  'Why the suggestion is what it is: rpe_e1rm (rolling e1RM x pct), progression (no e1RM lift: last week''s logged kg + the step, when a progression rule fires; see adjustment_reason), or why there is none: not_rpe, no_e1rm, no_lift.';
comment on column public.planned_sets.adjustment_kg is
  'The step a progression rule added before the weekly cap: 2.5 (upper body) or 5 (lower body); 0 = hold (two Hårdere in a row: at most last week''s kg). Null = no rule fired. Rules in domain.planned_sets: the last two rated sets of the exercise both Lettere, or every set at the top of the range in the last two sessions.';
comment on column public.planned_sets.adjustment_reason is
  'Danish, shown verbatim after the suggestion: "de sidste to var lettere", "de sidste to var hårdere", "Du ramte 10 reps to gange". Null exactly when adjustment_kg is null.';
comment on column public.planned_sets.rest_min_s is
  'Recommended rest after this set, lower end (s): 180 for a heavy set (reps <= 5 and prescribed RPE >= 7), else 90. Null only on rows written before 2026-10-13.';
comment on column public.planned_sets.rest_max_s is
  'Recommended rest, upper end (s): 300 heavy, else 120. Null exactly when rest_min_s is null.';
comment on column public.planned_sets.ramp is
  'The warm-up ramp before a main lift (category main), on the first set of each exercise run: [{"pct": 40, "reps": 5, "kg": 57.5}, {"pct": 60, ...}, {"pct": 80, ...}], kg = pct x the first working set''s kg (its suggestion, else last week''s logged kg) rounded to 2.5. Null = no ramp (not a main lift, not a run''s first set, or no kg to base it on).';
comment on column public.planned_sets.uncapped_kg is
  'The suggestion before the weekly cap (domain.planned_sets.weekly_cap), a multiple of 2.5 kg; suggested_kg is the capped value. The cap limits a rise to 2.5 kg (upper body) or 5 kg (lower body) above last week''s logged kg for the same row, exercise and reps. Null = not capped. 0 is invalid.';

-- 4. exercise_feel -------------------------------------------------------------------------------
create table public.exercise_feel (
  exercise_id  bigint      primary key references public.exercises (id) on delete cascade,
  rated_n      integer     not null check (rated_n >= 4),
  lighter_n    integer     not null check (lighter_n >= 0),
  expected_n   integer     not null check (expected_n >= 0),
  harder_n     integer     not null check (harder_n >= 0),
  verdict_text text        not null check (length(btrim(verdict_text)) > 0),
  computed_at  timestamptz not null,
  check (lighter_n + expected_n + harder_n = rated_n)
);
comment on table public.exercise_feel is
  'One line per exercise for Analyse > Styrke, from exercise_set_log.felt_rpe: only exercises with 4+ rated sets have a row. Rebuilt by compute (upsert, then delete older rows). verdict_text is Danish and shown verbatim, e.g. "Du melder oftest lettere end foreskrevet – forslaget ligger 5 kg over Benjamins RPE".';

alter table public.exercise_feel enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.
revoke all on table public.exercise_feel from anon, authenticated, service_role;
grant select, insert, update, delete on table public.exercise_feel to service_role;
