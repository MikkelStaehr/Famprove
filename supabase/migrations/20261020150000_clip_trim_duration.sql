-- The destructive manual clip (user, 2026-10-20, slice clip-trim): Gem klip replaces a clip's file on
-- the phone with its keyframe cut, so the row's length must follow the file. Additive (one column
-- grant no deployed code uses), so it may lead its code (CLAUDE.md "Additive migrations may lead").
-- No functions, triggers or RPC. Python reads none of it.

grant update (duration_s) on table public.video_clips to service_role;

comment on column public.video_clips.duration_s is
  'The clip file''s length in seconds as the phone has it. Set by the first insert; since 2026-10-20 (slice clip-trim) lowered by the clip action when the user cuts the clip on the phone (Gem klip), together with clip_in_s/clip_out_s and auto_* set to null (they referred to the old file). Never raised.';
