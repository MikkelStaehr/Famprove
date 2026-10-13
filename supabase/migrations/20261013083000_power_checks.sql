-- =============================================================================
-- Power data checks (decided with the user 2026-10-13; rules in python domain/power_check.py).
-- 1. activities.data_warning: which power-data rule fired on a ride (Danish, the week view's
--    "Tjek effektdata" tooltip), written by collect-intervals; null = no rule fired.
-- 2. app_notices: one current notice per kind, shown as a line on /load. Today one kind:
--    ftp_mismatch (the FTP set in intervals.icu vs its eFTP), written by collect-plan.
-- Additive: a nullable column and a new table, so the code on main keeps running.
-- State transitions and data-loss risk: none can't be rebuilt. data_warning is recomputed for
-- every ride collect-intervals fetches; a notice is upserted while its condition holds and
-- deleted when it no longer does.
-- =============================================================================

alter table public.activities
  add column data_warning text check (data_warning is null or length(btrim(data_warning)) > 0);

comment on column public.activities.data_warning is
  'Which power-data rule fired (python domain.power_check), in Danish: max power (icu_pm_p_max) > 1.3 x the ePmax of the day (icu_rolling_p_max), and/or one power sample > 300 W above both neighbours (checked on the stream only when max power > 2 x the ride''s FTP). Null = no rule fired, or not checked yet (rows written by older code).';


create table public.app_notices (
  kind       text        primary key check (kind in ('ftp_mismatch')),
  date       date        not null,
  message    text        not null check (length(btrim(message)) > 0),
  updated_at timestamptz not null default now()
);

comment on table public.app_notices is
  'One current notice per kind, shown as a one-line notice on /load. Written by the daily job: upserted while the condition holds, deleted when it no longer does. ftp_mismatch: collect-plan, when the ride FTP in intervals.icu and its eFTP (mmp_model.ftp) differ by more than 15 % of the FTP.';
comment on column public.app_notices.date is 'Europe/Copenhagen date the condition was last seen (the run day).';
comment on column public.app_notices.message is 'Danish, shown as is, e.g. "FTP er sat til 230 W, men dine ture peger på 183 W".';

alter table public.app_notices enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.
revoke all on table public.app_notices from anon, authenticated, service_role;
grant select, insert, update, delete on table public.app_notices to service_role;
