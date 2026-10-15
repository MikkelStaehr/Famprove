-- Slice ftp-confirm (user, 2026-10-15): the FTP notice only while intervals.icu's eFTP is credible,
-- and the user's answer to it.
-- 1. ftp_status: one row, rebuilt by collect-plan every run (domain/ftp_check.py).
-- 2. ftp_ack: the user's answers from /load ("230 W er rigtigt" / "Jeg har rettet FTP"), written by
--    the web's server action (service key, server-side); read by collect-plan. Can't be rebuilt.

-- 1. ftp_status ----------------------------------------------------------------------------------
create table public.ftp_status (
  singleton        boolean     primary key default true check (singleton),
  ftp_w            integer     check (ftp_w > 0),
  eftp_w           integer     check (eftp_w > 0),
  best_8min_42d_w  integer     check (best_8min_42d_w > 0),
  threshold_w      integer     check (threshold_w > 0),
  credible         boolean,
  last_tested_on   date,
  ftp_since        date,
  suppressed_until date,
  checked_at       timestamptz not null
);

comment on table public.ftp_status is
  'The FTP check, one row, rebuilt by collect-plan (domain/ftp_check.py). Every null means unknown or none, never 0. The ftp_mismatch notice (app_notices) is written only while credible and not suppressed.';
comment on column public.ftp_status.ftp_w is 'The FTP set in intervals.icu (sportSettings.ftp). Null = intervals.icu has none.';
comment on column public.ftp_status.eftp_w is 'intervals.icu''s eFTP (sportSettings.mmp_model.ftp). Null = unknown.';
comment on column public.ftp_status.best_8min_42d_w is 'The ride power curve''s 8-min point over the last 42 days (type Ride, VirtualRide included). Null = no effort that long with power.';
comment on column public.ftp_status.threshold_w is '90 % of ftp_w, rounded up (user, 2026-10-15: "høj intensitet"). Null without an FTP.';
comment on column public.ftp_status.credible is 'best_8min_42d_w >= threshold_w: an effort of 8 min or more at >= 90 % of the FTP in 42 days. Null without an FTP.';
comment on column public.ftp_status.last_tested_on is 'Local date of the latest ride with such an effort in the last 52 ISO weeks. Null = none ("ikke testet de sidste 52 uger").';
comment on column public.ftp_status.ftp_since is 'First ride of the latest unbroken run of rides with this FTP (activities.ftp). intervals.icu keeps no FTP history, so it reads "sat senest". Null = unknown.';
comment on column public.ftp_status.suppressed_until is 'After "230 W er rigtigt": the first day the notice may show again (ack day + 60, ended early by an FTP change or a credible effort after the ack with eFTP > 5 % off). Null = not suppressed.';
comment on column public.ftp_status.checked_at is 'The collect-plan run that wrote the row.';

alter table public.ftp_status enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypassing role sees nothing.
revoke all on table public.ftp_status from anon, authenticated, service_role;
grant select, insert, update on table public.ftp_status to service_role;

-- 2. ftp_ack -------------------------------------------------------------------------------------
create table public.ftp_ack (
  id      bigint      generated always as identity primary key,
  choice  text        not null check (choice in ('confirmed', 'fixed')),
  ftp_w   integer     not null check (ftp_w > 0),
  eftp_w  integer     check (eftp_w > 0),
  at      timestamptz not null default now()
);

comment on table public.ftp_ack is
  'The user''s answers to the FTP notice on /load (user, 2026-10-15), newest id wins. Written only by the web''s server action (one insert per tap; Fortryd deletes that row while it is still the newest). collect-plan reads the newest. Cannot be rebuilt.';
comment on column public.ftp_ack.choice is 'confirmed = "230 W er rigtigt" (hide 60 days unless the FTP changes or a hard effort moves eFTP > 5 %); fixed = "Jeg har rettet FTP" (the web hides the notice until the next run).';
comment on column public.ftp_ack.ftp_w is 'The FTP the notice showed (ftp_status.ftp_w at the tap, read server-side).';
comment on column public.ftp_ack.eftp_w is 'The eFTP the notice showed (ftp_status.eftp_w at the tap). Null = unknown then.';
comment on column public.ftp_ack.at is 'Server time of the tap (the column default; the client never sends a time).';

alter table public.ftp_ack enable row level security;
revoke all on table public.ftp_ack from anon, authenticated, service_role;
grant select, insert, delete on table public.ftp_ack to service_role;
