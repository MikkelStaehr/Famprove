-- =============================================================================
-- Document when 0 is a valid logged_kg (comment only; no data or access change).
-- Missing is always NULL; 0 is a real value only where the field allows it.
-- =============================================================================

comment on column public.strength_sets.logged_kg is
  'kg as the user entered it in the sheet (planned ahead or lifted), before BODYWEIGHT is added. NULL = not entered or unreadable (counted in the collect-strength log). 0 is a real value ONLY on bodyweight exercises (bodyweight = true: bodyweight only, no added load); on weighted exercises a 0 (e.g. the -10% formula before the top set is logged) is stored as NULL.';
