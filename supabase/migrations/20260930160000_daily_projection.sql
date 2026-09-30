-- =============================================================================
-- daily_projection: the "prognose" half of the /load chart.
-- compute rebuilds it on every run: one row per day, tomorrow .. today + 56, seeded from
-- today's daily_load state. Every value is an estimate (see python/.../domain/projection.py):
-- planned rides (NP-style TSS) or the typical week for cycling; strength sessions placed on the
-- typical weekday with the recent mean TSS. basis explains each day's load.
-- Kept apart from daily_load, which stays history only ("latest row = today").
-- Access model unchanged: RLS on, no policies, anon/authenticated revoked, service_role only.
-- =============================================================================

create table public.daily_projection (
  date         date             primary key,
  cycling_tss  double precision not null check (cycling_tss >= 0),
  strength_tss double precision not null check (strength_tss >= 0),
  ctl          double precision not null,
  atl          double precision not null,
  tsb          double precision not null,
  basis        jsonb            not null,
  computed_at  timestamptz      not null
);

comment on table public.daily_projection is
  'Projected CTL/ATL/TSB for the next 56 days, rebuilt by compute. Estimates only; never mixed into daily_load.';
comment on column public.daily_projection.basis is
  'Why the day''s load is what it is: {"cycling": "planned"|"typical_week", "rides": [...], "strength": [{"session", "tss", "weekday": "learnt"|"spread", "moved", "planned_in_sheet", "reason"?}]}.';

alter table public.daily_projection enable row level security;
revoke all on table public.daily_projection from anon, authenticated;
grant select, insert, update, delete on table public.daily_projection to service_role;
