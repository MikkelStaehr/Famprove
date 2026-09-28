-- =============================================================================
-- Week detail view: two display-only columns (additive, nullable, no defaults).
-- The current collectors keep working until the new Python ships; the next collector
-- runs fill them (collect-intervals --since 2026-01-01 backfills device_name).
-- Access control unchanged: RLS on, no policies, table grants cover new columns.
-- =============================================================================

alter table public.activities
  add column device_name text;

alter table public.strength_sets
  add column prescribed text;

comment on column public.activities.device_name is
  'intervals.icu device_name as delivered (e.g. "HAMMERHEAD Karoo", "Zwift"). Display only.';
comment on column public.strength_sets.prescribed is
  'The coach''s prescribed load cell as text (e.g. "RPE 7 - 8", "-10%"), unparsed. Display only; the score uses the rpe column.';
