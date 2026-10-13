-- =============================================================================
-- planned_sets.uncapped_kg: the weekly cap on suggested kg (user, 2026-10-13; rules in python
-- domain/planned_sets.py). Against last week's logged kg for the same prescription (the same
-- sheet row the week before, same reps and prescribed RPE) a suggestion rises at most 2.5 kg and
-- falls at most 5 kg, rounded inward to 2.5 kg. uncapped_kg keeps the suggestion before the cap,
-- so the web can say "(begrænset)"; null = the cap didn't apply (or there was nothing to cap).
-- Additive: a nullable column, so the code on main keeps running (it writes null).
-- State transitions and data-loss risk: none; planned_sets is rebuilt by every compute run.
-- =============================================================================

alter table public.planned_sets
  add column uncapped_kg double precision
    check (uncapped_kg is null or (uncapped_kg > 0 and mod((uncapped_kg * 10)::numeric, 25) = 0));

alter table public.planned_sets
  add constraint planned_sets_uncapped_needs_a_capped_suggestion
    check (uncapped_kg is null or (suggested_kg is not null and uncapped_kg <> suggested_kg));

comment on column public.planned_sets.uncapped_kg is
  'The suggestion before the weekly cap (domain.planned_sets.weekly_cap), a multiple of 2.5 kg; suggested_kg is the capped value. Null = not capped: within +2.5 / -5 kg of last week''s logged kg for the same prescription, or no such logged kg. 0 is invalid.';
