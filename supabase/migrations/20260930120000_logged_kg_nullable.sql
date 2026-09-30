-- =============================================================================
-- No silent defaults: a blank or unreadable kg cell is NULL ("not logged"), never 0.
-- collect-strength rewrites every row on its next run. Access model unchanged.
-- =============================================================================

alter table public.strength_sets
  alter column logged_kg drop not null;

comment on column public.strength_sets.logged_kg is
  'kg as logged in the sheet, before BODYWEIGHT is added. NULL when the cell is blank or unreadable (counted in the collect-strength log), never 0.';
