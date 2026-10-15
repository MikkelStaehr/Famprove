-- strength_sets.notes after slice variants-notes (user, 2026-10-15): only the user writes in the
-- sheet's NOTES, so its text is the variant (strength_sets.variant_id); a line starting "N:" is a
-- remark. The column keeps those remarks. Comments only: no data or grant changes.
comment on column public.strength_sets.notes is
  'The user''s "N:" remarks in the NOTES cell for this row and week, without the "N:" (any other text there is the variant, variant_id). Null = none. Not shown in the app.';
comment on table public.exercise_variants is
  'Variants of an exercise, from the text in the sheet''s NOTES (user, 2026-10-14; "V:" optional and "N:" a remark since 2026-10-15). collect-strength inserts unknown ones (insert-only); the user edits the values. Every scoring field is an override: null = inherit from public.exercises.';
comment on column public.strength_sets.variant_id is
  'The exercise variant from the sheet''s NOTES in force that week (null = ukendt, never mixed with a named variant).';
