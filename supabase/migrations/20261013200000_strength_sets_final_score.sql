-- =============================================================================
-- strength_sets.score_final / rpe_final (user, 2026-10-13): the per-set score that feeds
-- strength_sessions.tss and daily_load, and the RPE behind it, so the week view shows the same
-- number. collect-strength writes them equal to score / rpe (the sheet formula on the sheet's
-- inputs); compute overwrites them with its final values: reps done on a range set
-- (exercise_set_log) and, on a main lift's row without an RPE, the RPE estimated from the app's
-- rolling e1RM. score / rpe stay the parser's own values.
-- Additive: two nullable columns (null only on rows written by code from before this column),
-- backfilled from score / rpe; the code on main keeps running.
-- State transitions and data-loss risk: none; both are rebuilt by every collect + compute run.
-- =============================================================================

alter table public.strength_sets
  add column score_final double precision check (score_final is null or score_final >= 0),
  add column rpe_final   double precision check (rpe_final is null or rpe_final between 1 and 10);

update public.strength_sets set score_final = score, rpe_final = rpe;

comment on column public.strength_sets.score_final is
  'The raw set score (before STRENGTH_K) that compute uses for strength_sessions.tss and daily_load: score with reps done (range sets) and, on a main lift''s row without a prescribed RPE, the RPE from the app''s rolling e1RM. collect-strength writes score here; compute overwrites it. 0 is real (no kg, or a planned set). Null only on rows written by code from before 2026-10-13.';
comment on column public.strength_sets.rpe_final is
  'The RPE behind score_final (logged, prescribed, the %1RM estimate, or 6 for unknown). Null where score_final''s formula uses none (ABS) or on rows from before 2026-10-13.';
