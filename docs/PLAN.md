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
| e1rm-cap | Suggested kg: rolling e1RM from low-rep RPE >= 7 sets only, weekly rise cap +2.5 kg upper / +5 kg lower body with "(begrænset)" | M |
| fokus-warmup | Fokus warm-up before set 1 (logged as kind warmup, ramp for main lifts, derived backfill, Fortryd undoes Begynd) | L |
| fokus-felt-rpe | Felt RPE and reps done after each set; Python uses them for e1RM, set score and suggestion adjustments; Styrke feel line | L |
| fokus-pause-content | Pause screen content: recommended rest, coach notes, last week on the next-set card, elapsed and remaining time | M |
| score-rpe | Set score RPE: logged, then prescribed, then %1RM only without an RPE cell (bug: backoff 428 vs top set 162) | S |
| score-final | Persist compute's final set score (strength_sets.score_final) so the week view shows what feeds daily_load | S |
| instrument-fokus | New direction (editorial instrument panel, replaces Spurt): DESIGN.md Part B + Fokus restyled as the pilot | M |
| instrument-rest | Restyle Træning, Belastning and Analyse to the instrument direction (after the Fokus pilot) | L |
| visual-reset | Visual reset to the dark card mockup (design/reference, local only): replaces Instrument on every screen, no data or feature changes | L |
| reset-base | Reset base: DESIGN.md rewritten from the mockup, tokens, Geist + Geist Mono, icon tab bar, card primitives | M |
| reset-belastning | Belastning from the mockup: form card with zone bar, stat cards, fitness curve with 4U/12U/Sæson, 12-week day grid, daily TSS bars, week list | L |
| reset-traening | Træning with the light "I dag" card and card lists; Fokus on the new tokens and fonts | M |
| reset-analyse | Analyse (Cykel, Styrke) on the card system | M |
| post-reset | Review after the visual reset: curve, readouts, shared week, Træning rows, forecast needle, e1RM rule, Styrke tick | L |
| curve-smooth | Belastning fitness curve as a smooth monotone curve; forecast stays dotted | S |
| readout-on-tap | Day grid and TSS bars: readout row only after a tap, no default "Seneste" row | S |
| week-shared | One week source for Træning and Belastning: planned sessions and I DAG in /load's week list | M |
| no-suggestion-line | Træning: no "Intet forslag" lines; the suggestion when there is one, else only SIDSTE UGE | S |
| exercise-collapse | Træning: one row per exercise (prescription, last week's kg, set dots), tap to expand, the next one open | M |
| forecast-needle | Forecast form reaching −50 around 11 Nov: find the day, explain, fix the source value | M |
| e1rm-one-rule | Analyse › Styrke e1RM uses the suggestions' rule (≤ 5 reps, RPE ≥ 7): one function, an agreement test | M |
| styrke-today-tick | Analyse › Styrke chart: the lone today tick gets a date label or goes | S |
| review-round | Review round after Ember: the user's 12 points, tech-lead coordinating | L |
| review-belastning | Week card as card 2 with done / ~planned (weekly_plan view), one WeekCard on Belastning and Træning, curve through weekly anchors, no rest readouts or tooltips on /load, no today line on the curve, grid week numbers and seven day labels | L |
| review-traening | Træning: no "intet forslag" (visible or spoken), every exercise collapsed to name + set dots | M |
| review-faelles | Forecast-form guard tests, one isoWeek helper, TrendChart gone, one "opdateret" formatter | M |
| answers-round | The user's answers after the review round: intervals.icu rides in the prognose, Analyse readout rule, rolling e1RM board, footnote, "endnu", desktop gap | L |
| planned-rides-icu | Prognose cycling from intervals.icu calendar events when the week has any, else the typical week | L |
| analyse-calm | Analyse charts: no values or tooltips before a tap, one readout row under the chart | M |
| board-rolling-e1rm | Styrke board shows the rolling 4-week e1RM (the suggestions' number), not the block best | M |
| small-fixes | Træning footnote only with a suggestion, Styrke "endnu" gone once the block has ended, /load desktop gap if small | S |
| cli-pin | Supabase CLI pinned to v2.120.0 in CLAUDE.md | S |
| fitness-round | Fitness card verdict, bodyweight in strength TSS, board's last known e1RM, CLI from the repo, retro rule | L |
| fitness-verdict | Fitness card: big CTL + ramp header (mockup C), a ramp verdict in zone colours from one set of constants, y axis near the data, legend only "prognose" | M |
| bodyweight-fractions | Bodyweight exercises: fractions per the user's list (machines and cables 0), one bodyweight value, backfill and the fitness/form shift | M |
| board-last-known | Styrke board: the latest known e1RM, muted with its date, when the last 4 weeks have none | S |
| cli-from-repo | Supabase migrations run from the repo with the pinned CLI; the scratch copy is gone | S |
| retro-external-step | CLAUDE.md: an external source gets its own step, optional ones continue-on-error | S |
| per-side-dumbbell | Unilateral and dumbbell exercises: exercises.per_side (reps per side, both counted) and kg_per_dumbbell (x2), recorded per set; marked after the user sees the lists | M |
| variants | Exercise variants from 'V:' in the sheet's NOTES: exercise_variants with aliases and inherited fields, per (exercise, variant) grouping, variant names on Træning/Fokus | L |
| sheet-layout | Parser guard: each week's columns from the day's header row, a training day bounded by its WEEK row and the next Micro Length/DAY/MICROCYCLE row; anything else stops collect-strength | M |
| variants-notes | Variants from any NOTES text ("V:" optional, "N:" = a remark), Fokus shows no NOTES; one run, six cells checked | M |
| refresh-button | "Hent data nu": ↻ on the updated line → POST /api/refresh → workflow_dispatch, token server-side only, one run at a time, 5 min apart | M |
