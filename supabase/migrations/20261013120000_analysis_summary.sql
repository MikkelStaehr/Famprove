-- =============================================================================
-- analysis_summary: the three answers on top of Analyse > Cykel (slice cykel-answers,
-- spec design/specs/analyse.md section 12). One row per question: eftp | ef | volume.
-- Python owns every number, direction and sentence (domain/cycling_answers.py, written by
-- cli/compute.py); the web renders the strings verbatim and does no arithmetic.
-- Additive: a new table only, so the code on main keeps running.
-- State transitions: rebuilt by every compute run as one upsert of all three rows on
-- `question` (one request, so a failed run leaves the previous run's three rows, never a mix).
-- A row's state moves freely between answer and needs_data as rides arrive or age out.
-- Data-loss risk: none. Every value is derived from activities, ride_metrics inputs and
-- planned_sessions; the previous run's answer is overwritten and not kept (no history needed).
--
-- Definitions (also the docstring of domain/cycling_answers.py). today = the run's
-- Europe/Copenhagen date = as_of. Comparisons use the rounded displayed values.
-- eftp: points = (day, rolling_ftp_w) of eftp_ok rides; same day -> the highest.
--   now  = the latest point. Too old when today - now_date > MAX_GAP_DAYS (21, where the
--          chart line breaks) -> needs_data (stale sentence), value kept.
--   then = the latest point on or before anchor = now_date - 42, and no earlier than
--          anchor - 21; none -> needs_data (no-then sentence, {then_target_date} = anchor).
--   delta = now - then (W). flat when |delta| / then < 3 %. peak = highest point since
--          the first eftp_ok ride (ties: earliest date).
-- ef: points = (day, ef) of ef_ok rides. now = median of ef_window(today), then = median of
--   ef_window(today - 42) (28 days each, both ends inclusive), each needs >= 3 rides
--   (EF_MIN_RIDES, the same rule as the web's trend line). flat when |delta| / then < 3 %.
-- volume: complete ISO weeks (Sunday < today). now = mean moving hours of the last 4,
--   then = the 4 before. Weeks without rides are 0 h. flat when |delta| < 0.25 h.
--   planned = planned_sessions rows dated in the last 4 complete weeks; per date,
--   done = min(planned that date, rides that date not excluded as too_short).
-- =============================================================================

create table public.analysis_summary (
  question     text          primary key check (question in ('eftp', 'ef', 'volume')),
  as_of        date          not null,
  computed_at  timestamptz   not null default now(),
  state        text          not null check (state in ('answer', 'needs_data')),
  direction    text          check (direction in ('up', 'down', 'flat')),
  value        numeric(6, 2) check (value is null or value >= 0),
  value_date   date,
  compare      numeric(6, 2) check (compare is null or compare >= 0),
  compare_date date,
  delta        numeric(6, 2),
  have_n       integer       check (have_n is null or have_n >= 0),
  need_n       integer       check (need_n is null or need_n > 0),
  target       numeric(4, 1) check (target is null or target > 0),
  target_since date,
  planned_n    integer       check (planned_n is null or planned_n > 0),
  done_n       integer       check (done_n is null or done_n >= 0),
  verdict_text text          not null check (length(btrim(verdict_text)) > 0),
  detail_text  text          check (detail_text is null or length(btrim(detail_text)) > 0),

  -- answer: everything the figure row and arrow need; needs_data: no arrow
  check (state <> 'answer'
         or (direction is not null and value is not null and compare is not null and delta is not null)),
  check (state <> 'needs_data' or direction is null),
  -- per question: units and the fields that belong to it
  check (question <> 'eftp' or (
           (value is null or (value = trunc(value) and value between 100 and 500))
           and (compare is null or (compare = trunc(compare) and compare between 100 and 500))
           and have_n is null and need_n is null and target is null and target_since is null
           and planned_n is null and done_n is null)),
  check (question <> 'ef' or (
           (value is null or value > 0) and (compare is null or compare > 0)
           and have_n is not null and need_n is not null
           and target is null and target_since is null and planned_n is null and done_n is null)),
  check (question <> 'volume' or (
           state = 'answer' and value * 10 = trunc(value * 10) and compare * 10 = trunc(compare * 10)
           and target is not null and target_since is not null
           and have_n is null and need_n is null and value_date is null
           and (planned_n is null) = (done_n is null)
           and (done_n is null or done_n <= planned_n)))
);

comment on table public.analysis_summary is
  'The three answers on Analyse > Cykel, one row per question (eftp | ef | volume). Rebuilt by compute every run (domain/cycling_answers.py); read-only for the web, which renders verdict_text/detail_text verbatim.';
comment on column public.analysis_summary.as_of is 'Europe/Copenhagen run day the answer is computed for (= today in compute).';
comment on column public.analysis_summary.computed_at is 'When compute wrote the row; part of the page''s freshness time.';
comment on column public.analysis_summary.state is 'answer = number, comparison and arrow; needs_data = no arrow, verdict_text is the "what''s needed" sentence. volume is always answer.';
comment on column public.analysis_summary.direction is 'up | down | flat (inside the flat band, see header). Null exactly when state = needs_data.';
comment on column public.analysis_summary.value is 'Now. eftp: W, whole, 100-500, 0 invalid; null = no eFTP at all. ef: median EF, 2 dp, 0 invalid; null = fewer than need_n rides in the 28-day window. volume: h/week, 1 dp, 0 VALID (no riding in 4 complete weeks); never null.';
comment on column public.analysis_summary.value_date is 'eftp: day of the "now" eFTP ride; ef: window end (= as_of); volume: null (the window is the last 4 complete ISO weeks). Null = no value.';
comment on column public.analysis_summary.compare is '6 weeks before, same unit and rounding as value. 0 valid only for volume. Null = nothing to compare with (eftp/ef needs_data); volume always has one (rides since 2024-12-30).';
comment on column public.analysis_summary.compare_date is 'eftp: day of the "then" eFTP ride; ef: then-window end (as_of - 42); volume: Monday of the first of the 4 earlier weeks. Null when compare is null.';
comment on column public.analysis_summary.delta is 'value - compare from the rounded values, signed. 0 valid (no change). Null when either side is null.';
comment on column public.analysis_summary.have_n is 'ef only: ef_ok rides in the now window. 0 valid. Null for eftp/volume.';
comment on column public.analysis_summary.need_n is 'ef only: rides needed per window (EF_MIN_RIDES = 3, the web trend-line rule). Null for eftp/volume.';
comment on column public.analysis_summary.target is 'volume only: target h/week (python constant VOLUME_TARGET_H). Null for eftp/ef.';
comment on column public.analysis_summary.target_since is 'volume only: when the target was set (VOLUME_TARGET_SINCE), for the "?" text. Null for eftp/ef.';
comment on column public.analysis_summary.planned_n is 'volume only: planned_sessions rows in the last 4 complete weeks. Never 0: no plan is null (detail_text then says so).';
comment on column public.analysis_summary.done_n is 'volume only: planned sessions with a ride on their date (see header). 0 valid when planned_n is set; null exactly when planned_n is null.';
comment on column public.analysis_summary.verdict_text is 'Danish, one sentence, rendered verbatim (spec 12e templates).';
comment on column public.analysis_summary.detail_text is 'Danish, one line of context, rendered verbatim. Null = no detail line.';

alter table public.analysis_summary enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.
revoke all on table public.analysis_summary from anon, authenticated, service_role;
grant select, insert, update, delete on table public.analysis_summary to service_role;
