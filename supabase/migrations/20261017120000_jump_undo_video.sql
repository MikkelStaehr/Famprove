-- The jump fixes and video phase 1 (user, 2026-10-17; tech-lead plan): one migration for the round.
-- Additive (new columns and a new table no deployed code reads) plus one revoke of a grant nothing
-- uses, so it may lead its code (CLAUDE.md "Additive migrations may lead"). Python reads none of it.
-- 1. session_order: what Fortryd of the latest jump (or chain of jumps) restores (slice jump-undo).
-- 2. exercise_variant_parts: service_role select only (slice variant-parts-grant).
-- 3. video_clips: metadata of the clips recorded in Fokus; the videos stay on the phone (video-record).

-- 1. session_order ---------------------------------------------------------------------------------
alter table public.session_order
  add column previous_rows integer[],
  add column jumped_at     timestamptz,
  add column moved_start   timestamptz,
  add constraint session_order_undo_together check ((jumped_at is null) = (previous_rows is null));
comment on column public.session_order.previous_rows is
  'The run order before the current chain of jumps (the sheet''s runs when there was no row): what one Fortryd restores (user, 2026-10-17: one Fortryd undoes a whole chain of jumps in a row). Null when the latest tap is not a jump.';
comment on column public.session_order.jumped_at is
  'The latest jump''s server time T: Fortryd undoes the jump when it is strictly later than every done, skip and begin of the session. Null with previous_rows.';
comment on column public.session_order.moved_start is
  'The start the chain''s first jump moved from the then-current open set to the jumped-to run (null when that set had none); Fortryd moves it back.';

-- 2. exercise_variant_parts ----------------------------------------------------------------------
revoke insert on table public.exercise_variant_parts from service_role;

-- 3. video_clips -----------------------------------------------------------------------------------
create table public.video_clips (
  id           uuid             primary key,
  date         date             not null,
  session_no   smallint         not null check (session_no >= 1),
  row_no       integer          not null check (row_no >= 1),
  set_no       smallint         not null check (set_no >= 1),
  exercise_id  bigint           not null references public.exercises (id) on delete restrict,
  variant_id   bigint           references public.exercise_variants (id) on delete restrict,
  recorded_at  timestamptz      not null default now(),
  duration_s   numeric(6, 1)    not null check (duration_s > 0 and duration_s <= 900),
  starred      boolean          not null default false,
  clip_in_s    numeric(6, 1),
  clip_out_s   numeric(6, 1),
  check ((clip_in_s is null) = (clip_out_s is null)),
  check (clip_in_s is null or (clip_in_s >= 0 and clip_in_s < clip_out_s and clip_out_s <= duration_s))
);
create index video_clips_by_date on public.video_clips (date);
comment on table public.video_clips is
  'Metadata of a working set''s clip recorded in Fokus (user, 2026-10-17, slice video-record): the video itself stays on the phone (OPFS) and never leaves it unless the user shares it. id = the uuid the phone made (a retry is the same row). Never frames, landmarks, file names, paths, device info or a hash. Deleting a clip on the phone deletes its row (user). Written by the clip action only; Python never reads it.';
comment on column public.video_clips.recorded_at is
  'The server''s clock at the first insert. The phone keeps clips for 8 weeks from it, unless starred.';
comment on column public.video_clips.starred is
  'Marked with a star by the user: never deleted by the 8-week cleanup.';
comment on column public.video_clips.clip_in_s is
  'The lift''s in point in seconds into the file (a later slice; null until set).';

alter table public.video_clips enable row level security;
revoke all on table public.video_clips from anon, authenticated, service_role;
grant select, insert, delete on table public.video_clips to service_role;
grant update (starred, clip_in_s, clip_out_s) on table public.video_clips to service_role;
