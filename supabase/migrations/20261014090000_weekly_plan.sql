-- weekly_plan: done / planned TSS per ISO week for the week card's "I alt" (user, 2026-10-14,
-- slice review-belastning). SQL owns ISO-week sums (as weekly_load): done = the week's daily_load
-- days, remaining = the week's daily_projection days after the last daily_load day (the prognose:
-- the coach's plan scored + the typical cycling week; estimates only). No new data: a view over
-- two existing tables, rebuilt by nothing.
-- Access model unchanged: security_invoker, anon/authenticated revoked, service_role only.

create view public.weekly_plan
with (security_invoker = true) as
with last_day as (
  select max(d.date) as date from public.daily_load d
),
done as (
  select
    date_trunc('week', d.date::timestamp)::date as week_start,
    sum(d.total_tss)                            as done_tss
  from public.daily_load d
  group by 1
),
remaining as (
  select
    date_trunc('week', p.date::timestamp)::date as week_start,
    sum(p.cycling_tss + p.strength_tss)         as remaining_tss
  from public.daily_projection p
  cross join last_day l
  where p.date > l.date
  group by 1
)
select
  done.week_start,
  done.week_start + 6                              as week_end,
  extract(isoyear from done.week_start)::integer   as iso_year,
  extract(week from done.week_start)::integer      as iso_week,
  done.done_tss,
  remaining.remaining_tss,
  done.done_tss + remaining.remaining_tss          as planned_tss
from done
left join remaining using (week_start);

comment on view public.weekly_plan is
  'Done and planned TSS per ISO week (Mon-Sun). done_tss = sum of daily_load.total_tss; remaining_tss = sum of daily_projection cycling + strength TSS on the week''s days after the last daily_load day (an estimate); planned_tss = done + remaining. remaining_tss and planned_tss are null when the week has no prognose day (past weeks, or the current week once nothing is left): never 0 for "not planned".';

revoke all on table public.weekly_plan from anon, authenticated;
grant select on table public.weekly_plan to service_role;
