-- Bodyweight fractions per the user's list (2026-10-14, slice bodyweight-fractions):
--   dips 0.90 · pull-ups / chin-ups 0.95 · push-ups 0.65 (already) · split squat / lunges 0.75.
-- public.exercises is hand-edited and the service role has no UPDATE on it (code never
-- overwrites a hand edit), so the user's values go in as a data migration. Machines and cables
-- keep null: null = not a bodyweight exercise (nothing added); 0 would mark them as bodyweight
-- exercises. No inverted rows exist yet (0.55 when the name appears). Each row is matched on id
-- and name, so a renamed row is left alone; collect-strength + compute rescore afterwards.

update public.exercises set bodyweight_fraction = 0.90 where id = 23 and name = 'Dips';
update public.exercises set bodyweight_fraction = 0.95 where id = 24 and name = 'Pullups';
update public.exercises set bodyweight_fraction = 0.95 where id = 28 and name = 'Chin-ups';
update public.exercises set bodyweight_fraction = 0.75 where id = 12 and name = 'FFE zercher split squat';
update public.exercises set bodyweight_fraction = 0.75 where id = 13 and name = 'Zercher FFE split squat';
update public.exercises set bodyweight_fraction = 0.75 where id = 14 and name = 'RFE split squat';
