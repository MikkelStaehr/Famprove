-- exercise_set_log.skipped_at (user, 2026-10-16, slice skipped-at; the cleanup audit): the time of
-- the skip tap in its own column. Until now updated_at doubled as the skip time (lastTap, Fortryd,
-- the next set's start on a retry), so any later write to a skipped row (a hand fix, a future
-- field) would move it and Fortryd could pick the wrong set. updated_at stays "the row's latest
-- write". No functions, triggers or RPC; access unchanged (RLS on, no policies, service_role).

alter table public.exercise_set_log
  add column skipped_at timestamptz;

-- Every row skipped so far: its skip time was its updated_at (the skip tap wrote it last; no
-- in-app write touches a skipped row afterwards, checked 2026-10-16).
update public.exercise_set_log
  set skipped_at = updated_at
  where skipped and skipped_at is null;

alter table public.exercise_set_log
  add constraint exercise_set_log_skipped_at check (skipped = (skipped_at is not null));

comment on column public.exercise_set_log.skipped_at is
  'The skip tap''s server time T; null exactly when the set is not skipped. Written by the skip tap, cleared by its undo or a done on the set. Fortryd and the next set''s start on a retry read it, never updated_at. Python never reads it.';
comment on column public.exercise_set_log.updated_at is
  'Set by the writer on every write to this row, to the tap''s server time T (no trigger): the row''s latest write. The skip time is skipped_at (since 2026-10-16).';
