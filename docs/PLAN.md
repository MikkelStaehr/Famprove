# Plan

Every task and slice has a lowercase id here, and every commit ends with `Slice: <id>` (since
2026-10-05). A new task or slice gets its row before its first commit; ids are never reused.
A commit that only edits this file carries `Slice: plan-slices` (or no Slice line), never the id of
a slice nobody worked on. Finished slices are marked by an empty commit with `Slice-Done: <id>` lines.
Size is the one agreed for it (S, M or L, see CLAUDE.md); `—` where none was set.

## Slices

| id | title | size |
|---|---|---|
| m1 | Milestone 1: collectors, compute and the daily job fill Supabase | — |
| m2 | Milestone 2: read-only dashboard on Vercel | — |
| today | Today screen at `/` | — |
| sessions-by-activity | Strength sessions dated by intervals.icu activities | — |
| spurt | Spurt design direction, tokens and Barlow | — |
| a | No silent defaults in the sheet parser | — |
| 1rm-fix | 1RM from the tab's 1RM table, with sanity bounds | — |
| b | DEV_FIXTURE states for screenshots | — |
| check-config | check-config lists every configuration problem first | — |
| c | Font decision (Barlow kept) | M |
| today-kg | kg from the sheet on Today | — |
| load-explanations | /load explains its numbers | M |
| prognose-chart | 56-day prognose on /load | L |
| 1a | Strength prognose from the coach's plan + forecast_log | — |
| 1b | Prognose band after the strength block | M |
| rpe-bound | RPE sanity bound: whole or half values on 1–10 | — |
| d | Analyse › Cykel | L |
| d-a | Cykel data: raw activities, ride_metrics, cycling_weeks | L |
| d-b | Cykel UI: /analyse | M |
| e | Analyse › Styrke incl. storage | L |
| e1 | Styrke data: raw cells, LSRPE, phase, strength_weeks, kg history | L |
| e2 | Styrke UI: /analyse/styrke and section tabs | L |
| lift-list | One shared lift list in web/src/lib/lifts.ts | S |
| schedule-check | Check of the 3× daily scheduled runs | S |
| cron-off-hour | Daily crons off the top of the hour | S |
| load-200-scroll | /load horizontal scroll at 200 % text | S |
| analyse-data-honesty | Analyse data honesty: one mark per ride, no silent 0 | M |
| droplet-gate | Droplet dispatch first, once-per-slot gate | M |
| since-bound | collect-intervals rejects --since before 2024-12-30 | S |
| ignore-claude-outputs | Ignore design/Claude outputs/ | S |
| analytics-audit | Analytics audit of /load and /analyse | M |
| strength-k | STRENGTH_K 0.035 as a variable, K note, prognose ride basis | M |
| zone-flag-wrap | Zone flag wraps only when it cannot fit | S |
| coarse-zones-note | "Zonerne er grove ved lav fitness." at the form hero | S |
| ef-trend-n3 | EF trend line only with 3+ rides in its window | S |
| ef-window-contract | Contract: the web's EF count equals Python's window | S |
| plan-slices | Slices table in docs/PLAN.md, Slice trailer on commits | S |
| droplet-followup | Follow-up of the droplet and backup runs per slot | S |
| f | Analyse › Samlet | L |
| f1 | Samlet data: block_load | L |
| f2 | Samlet UI: /analyse/samlet | L |
| form-pct-ctl | Form zone as % of CTL, once CTL > 30 | L |
| rpe-trend | RPE trend on Styrke, once LSRPE is logged | — |
| band-visibility | Prognose band visibility on real bands | S |
| rpe-readable-nit | Redundant rpe_readable in planned_load | S |
| vo2max-estimate | VO2max estimate from best 5-min W/kg, once real max efforts (FTP/ramp test) or an intervals.icu/watch estimate exist | — |
| m3 | Milestone 3: Analyse › Samlet (f) | — |
| ignore-key-json | Ignore Google key files (root JSON, <project>-<12 hex>.json) | S |
| exercises | Exercise catalogue: muscle factor and bodyweight fraction from a table, effective kg in the week card | L |
| exercise-log | Exercise timing log from Today's ticks (the app's first write path) | L |
| ride-vi | Variability index (NP / average power) per ride, Z2 warning in the week card | M |
| cycling-progress | Cycling progress view: VI, efficiency factor (power/HR) and eFTP (queued, not built) | — |
| set-log | Per-set timing log (exercise_set_log) with begin / done / skip / undo, read back on reload | L |
| suggested-kg | Suggested kg per planned set (rolling e1RM x RPE relation) in planned_sets | L |
| traening | Træning overview: Today renamed, a tick per set, TSB hint, "Begynd træning" | L |
| fokus | Fokus: one set at a time, rest timer, skip, progress; survives a reload | L |
| power-checks | Power data checks: spike warning per ride, FTP vs eFTP notice | M |
| design-desktop | Design pass: desktop layouts for Belastning and Analyse, bottom/top nav | L |
| chart-touch | Chart interaction: tap/drag marker with a fixed readout row on touch, a non-covering hover tooltip on pointer | M |
| cykel-answers | Analyse › Cykel as three answers (stronger? base? enough?) from a Python analysis_summary; charts below, VI in the eFTP readout | L |
| e1rm-cap | Suggested kg: rolling e1RM from low-rep RPE >= 7 sets only, weekly cap +2.5 / -5 kg with "(begrænset)" | M |
