-- Applied with supabase db push right after the Træning code was deployed (2026-10-12).
-- (It waited in supabase/followups/ until then: the old app wrote exercise_log until the deploy.)
--
-- =============================================================================
-- Drop exercise_log (follow-up to 20261012130000_set_log_planned_sets.sql). Not in
-- migrations/, so `supabase db push` ignores it until it is moved there.
-- Apply only right after the new web code (which writes exercise_set_log) is deployed: the old
-- app writes exercise_log until then, and its taps fail once the table is gone.
-- 1. Copy every exercise_log row written since 20261012130000 into exercise_set_log with the
--    same mapping (set 1 of the exercise's first sheet row in that session; on conflict do nothing).
--    Rows that migration already copied conflict and are skipped.
-- 2. Refuse to go on while any exercise_log row has no exercise_set_log row for its
--    (date, session, exercise).
-- 3. Drop public.exercise_log (its index, foreign key and grants go with it).
--
-- State transitions and data-loss risk
-- exercise_log -> exercise_set_log  as in 1. Risk: where the new app already logged that set,
--   the old exercise-level span is not copied and is lost with the drop (only if both apps
--   logged the same session).
-- exercise_log -> dropped  irreversible. Risk: none beyond the above once step 2 passes; a tap
--   from an old tab or deployment still open afterwards fails loudly instead of writing.
-- =============================================================================

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

do $$
declare
  missing integer;
begin
  select count(*) into missing
  from public.exercise_log el
  where not exists (
    select 1
    from public.exercise_set_log sl
    where sl.date = el.date and sl.session_no = el.session_no and sl.exercise_id = el.exercise_id
  );
  if missing > 0 then
    raise exception 'exercise_log: % row(s) have no exercise_set_log row; not dropping', missing;
  end if;
end
$$;

drop table public.exercise_log;
