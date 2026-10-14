-- PENDING the user's approval of the value list (2026-10-14); moved into migrations/ with a new
-- timestamp when approved. Slices bodyweight-fractions, per-side-dumbbell and variants.
-- public.exercises and public.exercise_variants are hand-edited and the service role has no
-- UPDATE on them by design, so the user's values go in as a data migration (matched on id AND
-- name; a renamed row is left alone). collect-strength + compute rescore afterwards.

-- Bodyweight fractions (user, 2026-10-14): dips 0.90, pull-ups / chin-ups 0.95, split squats
-- 0.75 (push-ups already 0.65; glute ham raise stays 0.6). Machines and cables keep null = no
-- bodyweight (0 would mark them as bodyweight exercises).
update public.exercises set bodyweight_fraction = 0.90 where id = 23 and name = 'Dips';
update public.exercises set bodyweight_fraction = 0.95 where id = 24 and name = 'Pullups';
update public.exercises set bodyweight_fraction = 0.95 where id = 28 and name = 'Chin-ups';
update public.exercises set bodyweight_fraction = 0.75 where id = 12 and name = 'FFE zercher split squat';
update public.exercises set bodyweight_fraction = 0.75 where id = 13 and name = 'Zercher FFE split squat';
update public.exercises set bodyweight_fraction = 0.75 where id = 14 and name = 'RFE split squat';

-- Reps per side (reading C: the sheet's reps are per leg/arm for unilateral exercises).
update public.exercises set per_side = true where id = 12 and name = 'FFE zercher split squat';
update public.exercises set per_side = true where id = 13 and name = 'Zercher FFE split squat';
update public.exercises set per_side = true where id = 14 and name = 'RFE split squat';
update public.exercises set per_side = true where id = 19 and name = 'Single leg leg extension';

-- Logged kg per dumbbell, two held (x 2).
update public.exercises set kg_per_dumbbell = true where id = 8 and name = 'Low incline DB press';
update public.exercises set kg_per_dumbbell = true where id = 14 and name = 'RFE split squat';

-- Variants (the cells the user rewrites to "V: ..."): values only; null = inherit.
insert into public.exercise_variants (exercise_id, name, display_name, aliases, per_side, kg_per_dumbbell)
values (17, 'single arm cable triceps pushdown', 'Single arm cable triceps pushdown',
        array['single armcable triceps pushdown'], true, false)
on conflict (exercise_id, name) do update
  set aliases = excluded.aliases, per_side = excluded.per_side, kg_per_dumbbell = excluded.kg_per_dumbbell;

insert into public.exercise_variants (exercise_id, name, display_name, per_side, kg_per_dumbbell)
values (16, 'db preacher curl', 'DB Preacher Curl', true, false)
on conflict (exercise_id, name) do update
  set per_side = excluded.per_side, kg_per_dumbbell = excluded.kg_per_dumbbell;

insert into public.exercise_variants (exercise_id, name, display_name, per_side, kg_per_dumbbell)
values (22, 'machine', 'Rear delt machine', false, false)
on conflict (exercise_id, name) do update
  set per_side = excluded.per_side, kg_per_dumbbell = excluded.kg_per_dumbbell;

insert into public.exercise_variants (exercise_id, name, display_name, aliases, suggests)
values (26, 'palloff + ghd', 'Palloff + GHD', array['ghd+palloff', 'ghd + palloff'], false)
on conflict (exercise_id, name) do update
  set aliases = excluded.aliases, suggests = excluded.suggests;

insert into public.exercise_variants (exercise_id, name, display_name, no_bodyweight)
values (24, 'lat pulldown', 'Lat pulldown', true)
on conflict (exercise_id, name) do update
  set no_bodyweight = excluded.no_bodyweight;
