-- The automatic clip's accuracy record (user, 2026-10-31, slice clip-accuracy-log): one row per clip the
-- user cuts or approves, holding the phone's automatic in/out next to the user's own, written before the
-- cut (trimClip) nulls them in video_clips. No foreign key to video_clips, so it survives Slet and the
-- cleanup. Additive (a new table no deployed code reads), so it may lead its code (CLAUDE.md "Additive
-- migrations may lead"). No functions, triggers or RPC. Python reads none of it.

create table public.clip_accuracy (
  clip_id       uuid          primary key,
  date          date          not null,
  session_no    smallint      not null check (session_no >= 1),
  row_no        integer       not null check (row_no >= 1),
  set_no        smallint      not null check (set_no >= 1),
  exercise_id   bigint        not null references public.exercises (id) on delete restrict,
  variant_id    bigint        references public.exercise_variants (id) on delete restrict,
  kind          text          not null check (kind in ('own', 'approved')),
  auto_in_s     numeric(6, 1),
  auto_out_s    numeric(6, 1),
  user_in_s     numeric(6, 1),
  user_out_s    numeric(6, 1),
  algo_version  smallint      check (algo_version is null or algo_version >= 1),
  duration_s    numeric(6, 1) not null check (duration_s > 0 and duration_s <= 900),
  recorded_at   timestamptz   not null default now(),
  check ((auto_in_s is null) = (auto_out_s is null)),
  check ((user_in_s is null) = (user_out_s is null)),
  check (auto_in_s is null or (auto_in_s >= 0 and auto_in_s < auto_out_s and auto_out_s <= duration_s)),
  check (user_in_s is null or (user_in_s >= 0 and user_in_s < user_out_s and user_out_s <= duration_s)),
  -- own: the user's own points, cut by Gem klip; approved: the automatic points, cut by Godkend alle.
  check ((kind = 'own') = (user_in_s is not null)),
  check (kind = 'own' or auto_in_s is not null)
);
create index clip_accuracy_by_date on public.clip_accuracy (date);
comment on table public.clip_accuracy is
  'How close the phone''s automatic clip came to the user''s own points (user, 2026-10-31): one row per clip the user cuts (kind own: the user''s in/out, the automatic in/out if the clip had one) or approves (kind approved: the automatic in/out). Seconds into the original file, before the cut. The set''s ids are copied from video_clips at the write, so a row outlives Slet and the 8-week cleanup. Written once per clip by the clip action (insert, on conflict do nothing); metadata only, never frames or landmarks. Python never reads it. Cannot be rebuilt.';
comment on column public.clip_accuracy.algo_version is
  'The automatic clip''s algorithm version (web lib/video/auto-clip.ts ALGO_VERSION) that produced auto_in_s/auto_out_s; null without an automatic range.';
comment on column public.clip_accuracy.duration_s is
  'The original file''s length in seconds (video_clips.duration_s before the cut).';

alter table public.clip_accuracy enable row level security;
revoke all on table public.clip_accuracy from anon, authenticated, service_role;
grant select, insert on table public.clip_accuracy to service_role;
