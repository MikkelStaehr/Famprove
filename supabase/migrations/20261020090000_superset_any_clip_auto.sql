-- The 19 Oct feedback round (user, 2026-10-20; tech-lead plan): one migration for the round.
-- 1. superset_pairs: a partner may be any not-started run of the session, moved right after A by
--    session_order (slice superset-any), so B's first row can be before A's in the sheet.
--    This changes a check deployed code relies on: apply -> push -> no job in between.
-- 2. video_clips: the phone's automatic clip (slice clip-auto), kept apart from the user's own
--    in/out (clip_in_s / clip_out_s) so the two can be compared (slice clip-accuracy).
-- No functions, triggers or RPC. Python reads none of it.

-- 1. superset_pairs ---------------------------------------------------------------------------------
alter table public.superset_pairs drop constraint if exists superset_pairs_row_b_check;
alter table public.superset_pairs
  add constraint superset_pairs_rows_differ check (row_b <> row_a);
comment on table public.superset_pairs is
  'Supersets chosen in the app (user, 2026-10-15): two exercise runs of a session (rows = the runs'' first sheet rows) done as A1, B1, rest, A2, B2 ... Since 2026-10-20 (slice superset-any) B may be any run that hasn''t started; session_order moves it right after A, so the pair is consecutive in the session''s order (not necessarily in the sheet''s). paired = false records an explicit "no". Written only by the web''s server action; Python never reads it (no TSS change). Cannot be rebuilt, so its foreign keys restrict.';

-- 2. video_clips ------------------------------------------------------------------------------------
alter table public.video_clips
  add column auto_in_s   numeric(6, 1),
  add column auto_out_s  numeric(6, 1),
  add column auto_status text check (auto_status is null or auto_status in ('clipped', 'low_confidence', 'failed')),
  add column auto_run_ms integer check (auto_run_ms is null or (auto_run_ms >= 0 and auto_run_ms <= 3600000)),
  add constraint video_clips_auto_together check ((auto_in_s is null) = (auto_out_s is null)),
  add constraint video_clips_auto_range check (
    auto_in_s is null or (auto_in_s >= 0 and auto_in_s < auto_out_s and auto_out_s <= duration_s)
  ),
  add constraint video_clips_auto_status_in_out check (
    (auto_status = 'clipped') = (auto_in_s is not null)
  );
comment on column public.video_clips.auto_in_s is
  'The automatic clip''s in point, seconds into the file, found on the phone (MediaPipe Pose lite; user, 2026-10-20: an exception to "Python owns all calculations", since the video never leaves the phone). Null unless auto_status = clipped.';
comment on column public.video_clips.auto_status is
  'clipped (in/out found) | low_confidence (the joints seen weren''t enough: no cut, "Klip selv") | failed (the run broke); null = not run yet.';
comment on column public.video_clips.auto_run_ms is
  'How long the phone took to find in/out, in ms (slice clip-accuracy). Not device information.';

grant update (auto_in_s, auto_out_s, auto_status, auto_run_ms) on table public.video_clips to service_role;
