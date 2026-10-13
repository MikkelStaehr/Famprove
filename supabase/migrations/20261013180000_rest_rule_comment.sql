-- =============================================================================
-- planned_sets.rest_min_s / rest_max_s: the rest rule (user, 2026-10-13): a main lift or its
-- variant (public.exercises.category = 'main', or a parent lift, e.g. tempo squat) always rests
-- 3-5 min; any other set 3-5 min when reps <= 5 at a prescribed RPE >= 7, else 1.5-2 min.
-- Comments only: no data, no state transitions, no data-loss risk.
-- =============================================================================

comment on column public.planned_sets.rest_min_s is
  'Recommended rest after this set, lower end (s): 180 for a main lift or its variant (exercises.category main, or a parent lift) and for any set of reps <= 5 at a prescribed RPE >= 7; else 90. Null only on rows written before 2026-10-13.';
comment on column public.planned_sets.rest_max_s is
  'Recommended rest, upper end (s): 300 where rest_min_s is 180, else 120. Null exactly when rest_min_s is null.';
