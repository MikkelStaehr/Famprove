# Architecture – training-app

One user's training load: Python jobs pull cycling (intervals.icu) and strength (the coach's Google
Sheet) into Supabase once a day and compute every number; a Next.js app shows it (read-only, except
one server action that logs set taps from the Træning screens into `exercise_set_log`).
Rules that shape everything: **Python owns all calculations** · the sheet is **read-only** · the
Supabase service key is **server-side only** · every table has RLS with no anon access.

## Data flow
```
GitHub Actions daily.yml at 05, 12, 20 Copenhagen: the droplet's workflow_dispatch (slot=05|12|20) first,
  GitHub's schedule as backup; the gate (.github/scripts/gate.py) runs collect-and-compute once per slot.
  A manual "Run workflow" without slot always runs.
  check-config       every job's env vars at once        → fails the run before anything is read
  collect-intervals  intervals.icu API (last 14 d)      → activities (rides), strength_activities (WeightTraining),
                                                          each with the API object as `raw`
  collect-events     intervals.icu calendar (this week .. → planned_events (every event raw; deletions mirrored
                       the week of today + 56 d)            in the window); continue-on-error: never blocks compute
  collect-strength   Google Drive xlsx export (read)    → strength_sets (ISO week + session 1..N, no dates;
                     + exercises (muscle factor,             the week's cells as `raw`, LSRPE as logged_rpe,
                       bodyweight fraction per name)         each set scored with its exercise's values);
                                                          unknown names → exercises (insert only)
  compute            activities + strength_sets + strength_activities
                                                        → strength_sessions, daily_load, blocks (+ view weekly_load), strength_sets.score_final / rpe_final (the final set score),
                                                          daily_projection (the 56-day prognose; + planned_sessions; a week with
                                                            planned rides in planned_events uses only those),
                                                          forecast_log (that prognose + a naive baseline, per run day),
                                                          ride_metrics + cycling_weeks (the ride analysis, rides since 2024-12-30),
                                                          analysis_summary (the three Cykel answers: eFTP, EF, hours),
                                                          blocks.phase, strength_weeks (e1RM + tonnage per week and lift),
                                                          strength_set_kg (planned/lifted kg history; updated, never rebuilt),
                                                          planned_sets (suggested kg per set, this ISO week on)
  collect-plan       planned_sessions (hand-filled) + FTP from intervals.icu → planned_targets;
                     FTP vs eFTP → app_notices (ftp_mismatch)

Next.js (web/), server components only
  /       Træning ← daily_load (TSB flag), strength_sessions + strength_sets (this ISO week, last week), planned_targets
  /fokus  Fokus   ← the same plan data (one set at a time; rest timer, skip, Fortryd)
                  ← planned_sets (suggested kg), exercise_set_log (today's logged sets, read back on reload)
                  → exercise_set_log (the one write: set taps via app/actions.ts → lib/db/set-log.ts;
                    checked against strength_sets + exercises; Python never reads it)
  /load   Load    ← daily_load, blocks, weekly_load, weekly_plan (I alt done / ~planned); week details ← activities, ride_metrics (VI), strength_sessions, strength_sets
  /analyse Analyse (Cykel) ← analysis_summary (the three answers, rendered verbatim: lib/analyse-answers.ts,
                             components/AnswerBlock.tsx), ride_metrics, cycling_weeks
  /analyse/styrke Analyse (Styrke) ← strength_weeks, blocks (phase), strength_sets.e1rm (the sheet 1RM)
```

## Folders
| Path | What lives there |
|---|---|
| `python/src/training_load/sources/` | Adapters that read the outside world: `intervals.py`, `google_drive.py`, `strength_sheet.py` (the coach-sheet parser and strength formula; formula lines never change) |
| `python/src/training_load/domain/` | Pure calculations, stdlib only: `load.py` (CTL/ATL, `DECAY`), `form.py` (ramp, intervals.icu zones), `strength.py` (session numbers, filled weeks, blocks), `sessions.py` (n-th strength activity of an ISO week = session n; strength TSS), `cycling.py`, `daily.py`, `plan.py` (watt targets), `projection.py` (the 56-day prognose: cycling = typical week + planned rides; strength = the coach's plan to the block's end, then the recent weeks with a low-high band; `naive_projection` = the baseline), `planned_load.py` (planned kg per set and the plan score of a session), `cycling_answers.py` (the three Cykel answers: eFTP, EF and hours now vs 6 weeks ago, flat bands, the volume target, every Danish sentence), `ride_analysis.py` (Analyse/Cykel: exclusions, eFTP/EF points and line breaks, EF 28-day median, year-ago eFTP, weekly totals; `ENDURANCE` = the EF intensity basis; VI = NP / average power and the Z2 VI warning), `strength_analysis.py` (Analyse/Styrke: lifted status, `PHASES`, the one e1RM rule `e1rm_point` (lifted competition sets of ≤ 5 reps at a prescribed RPE ≥ 7) shared by planned_sets and the %-row RPE estimate, weekly rows), `kg_history.py` (planned/lifted kg transitions), `dates.py` (`SERIES_START` 2026-01-01 for daily_load, `ANALYSIS_START` 2024-12-30, the ISO week of 2025-01-01, for the ride analysis), `exercises.py` (the exercise catalogue: name/alias matching, muscle factor and bodyweight kg per sheet name, unknown-name defaults), `set_feedback.py` (felt RPE and reps done from Fokus: range sets rescored with reps done, progression rules, the Styrke feel lines), `planned_sets.py` (suggested kg per planned set: rolling e1RM from lifted sets of ≤ 5 reps at RPE ≥ 7 x pct(RPE, reps), rounded to 2.5, a weekly rise capped at +2.5 kg upper body / +5 kg lower body vs last week's logged kg for the same row, whatever its RPE) |
| `python/src/training_load/db/` | The only code that talks to Supabase (PostgREST over `requests`), one module per table |
| `python/src/training_load/cli/` | The five console scripts, one per step of the daily job (`check-config` first) |
| `python/src/training_load/*.py` | `config.py` (env, fail-fast), `http.py` (retrying HTTP seam), `narrow.py` (JSON → typed fields) |
| `python/tests/` | pytest with synthetic fixtures (`conftest.py` builds a fake workbook and an in-memory PostgREST) and an anonymised real-data slice (`fixtures/blok12_slice.json`: refresh it when a new block starts); `test_contract_*.py` write the web's JSON fixtures (`REGENERATE_CONTRACT=1`) |
| `supabase/migrations/` | Schema, RLS, grants; applied with `supabase db push` |
| `web/src/lib/db/` | Server-only data layer (`server-only`): `queries.ts` entry points, `postgrest.ts` client (reads + `write`), `set-log.ts` (the one write path: exercise_set_log taps per set, input checks, undo), `rows.ts` typed parsers, `dev-fixture.ts` (DEV_FIXTURE, dev only: empty, stale, error, band, ef-few, lsrpe, answers, feel; Træning/Fokus: midsession, warmup, pause, exercise-end, pause-rated, finished) |
| `web/src/app/actions.ts` | The only server action: `logExerciseTap` (per-set shape check, then `lib/db/set-log.ts`) |
| `web/src/lib/*.ts` | Pure view models and formatting: `set-taps.ts` (per-set tap rules: input shape, sheet order, progress, rest-timer start, optimistic mirror), `dashboard-view.ts` (/load), `load-days.ts` (/load drawing scales: curve ranges 4U/12U/Sæson, gridlines and the curve's weekly anchors, day-grid shade buckets, bar windows, the before-the-strength-log rule), `load-grid.ts` (/load desktop placement), `training-view.ts` (/ and /fokus: the plan, sets per row, run numbering, TSB hint), `fokus-view.ts` (/fokus: which view, labels, timer, announcements), `zone-scale.ts` (zone-bar drawing scale, zone swatches and range texts, sr sentence, /load zone reading), `analyse-view.ts` (/analyse), `analyse-styrke-view.ts` (/analyse/styrke: lift board, e1RM panels, block ruler, tonnage weeks), `analyse-marks.ts` (Analyse mark constants, deload weeks, x labels kept clear of I DAG), `analyse-grid.ts` (Analyse desktop grid), `format.ts` (locale da-DK), `dates.ts` |
| `web/src/app/` | Routes: `page.tsx` (Træning), `fokus/page.tsx` (Fokus), `load/page.tsx`, `analyse/layout.tsx` (h1) + `analyse/page.tsx` (Cykel) + `analyse/styrke/page.tsx`, `layout.tsx` (TabBar, Geist fonts), `actions.ts` (the one server action) |
| `web/src/components/` | UI pieces; client components only where needed: `ZoneBar` (/load's form card), `ZoneLine` (Træning's mini zone bar), `FitnessCurve` (/load: fitness, prognose, band, block brackets, 4U/12U/Sæson), `DayCharts` (/load: 12-week training-day grid, daily TSS bars) + `chart-hooks.ts` (`useMedia`, `useWidth`, `useHydrated`, `useWide`, `ChartBoundary`), `WeekCard` (the one week card: `full` on /load with `<details>` day rows and `WeekSwitcher`, `compact` first on Træning; `I alt` = done / ~planned from weekly_plan), `ChartReadout` (the readout row of every chart), `ChartSeries` + `ChartMarks` (shared chart marks: LoadExplainer, AnalyseCharts), `AnalyseLegend`, `AnalyseCharts` (/analyse eFTP/EF charts, weekly strips, pause seams; Styrke e1RM panels, tonnage strips, block ruler), `AnalyseTabs` (Cykel / Styrke section links), `LoadExplainer` ("Hvad betyder det?"), `TabBar` (bottom bar below lg, top bar from lg; hidden on /fokus), the Ember primitives (`icons.tsx`, `Card`, `Tile`, `SegmentedControl`, `ZonePill`, `ListRow`, `InverseCard`, `SectionTitle`, `MonoCaption`, `ScreenHeader`), `TodayCard` + `SessionBlock` (Træning's light "I dag" card with Begynd/Fortsæt træning), `FormCard`, `StrengthCard` (the Sæt card), `SetChecklist` (a tick per set, NÆSTE), `RideCard`, `SetLogProvider` + `useSetLog` (set state seeded from the log, optimistic taps saved in order), `fokus/*` (Fokus views, timer, wake lock, HomeLink waits for queued saves) |
| `web/tests/` | `node --test` on the pure modules |
| `DESIGN.md`, `design/` | Visual contract (design-lead), screen specs, pattern packs |
| `.claude/skills/run-web/` | The only way to run and screenshot the web app (port 3100) |

## Tables
`activities` (rides; `data_warning` = the power-data check, domain/power_check.py) · `strength_activities` (WeightTraining from intervals.icu) ·
`strength_sets` (every prescribed set: plan + logged kg + effective kg + cells as written; ISO week + session number; the muscle_factor it was scored with) ·
`exercises` (hand-edited catalogue: muscle factor, bodyweight fraction, category per exercise name and its aliases) ·
`strength_sessions` (derived: per ISO week and session number, the activity that did it, its date, TSS) ·
`daily_load` (one row per day since 2026-01-01: TSS, CTL, ATL, TSB, ramp, zone, `computed_at`) ·
`blocks` (strength blocks + deload) · `weekly_load` (view) · `planned_sessions` (you fill) ·
`planned_targets` (derived watts) · `daily_projection` (the prognose, next 56 days, rebuilt by `compute`; estimates only) ·
`forecast_log` (every run day's prognose and naive baseline, upserted per day, never pruned: for measuring forecast error later) ·
`ride_metrics` (derived: every ride since 2024-12-30 with its trend values, VI and VI warning, and why it is left out of the trends) ·
`cycling_weeks` (derived: every ISO week since 2024-12-30, 0 for a week without rides) ·
`analysis_summary` (derived: one row per Cykel question, eftp | ef | volume: value, comparison, direction and the Danish sentences) ·
`strength_weeks` (derived: every ISO week x SQUAT/BENCH/DEADLIFT from the first block: tonnage, best e1RM, block best, the rolling 4-week e1RM the suggestions use + its source week) ·
`planned_events` (the intervals.icu calendar mirrored raw by collect-intervals; WORKOUT Ride/VirtualRide events drive the prognose's cycling in their ISO weeks) ·
`strength_set_kg` (persistent: planned and lifted kg per set with timestamps; like forecast_log it can't be rebuilt) ·
`exercise_set_log` (persistent: start/end/skip of each set and each exercise's warm-up (set 0), felt RPE and reps done, from the Træning screens' taps; can't be rebuilt; written only by the web; read back on reload; Python reads felt RPE and reps done) · `exercise_feel` (derived: one Styrke line per exercise with 4+ rated sets) ·
`app_notices` (one current notice per kind, e.g. ftp_mismatch from collect-plan; shown on /load) ·
`planned_sets` (derived by compute: suggested kg per set of this ISO week and later, rolling e1RM of the parent lift x the RPE relation, rounded to 2.5). `activities.raw` / `strength_activities.raw` hold the intervals.icu object as delivered.

## Plan
`docs/PLAN.md` lists every task and slice (id | title | size); commits end with `Slice: <id>`.

## Commands
- Python, from `python/` (reads repo-root `.env.local`): `uv run check-config` · `uv run collect-intervals [--since 2026-01-01]`, `collect-events`,
  `collect-strength`, `compute`, `collect-plan` · `uv run pytest` · `uv run ruff check src tests && uv run mypy`
- Web, from `web/` (reads `web/.env.local`): `pnpm dev` · `pnpm lint && pnpm typecheck && pnpm test` · `pnpm build`
- Database, from the repo root: `supabase db push`
- CI: `test.yml` on every push (Python + web checks, no secrets); `daily.yml` needs 7 repository secrets and the repository variable `STRENGTH_K`.

## Where to change what
Strength session rule → `domain/sessions.py` · ride-analysis thresholds and the EF intensity basis → `domain/ride_analysis.py` · program phases, competition-lift names and e1RM rules → `domain/strength_analysis.py` · Decay variant → `domain/load.py` `DECAY` · form-zone bands → `domain/form.py` + `web/src/lib/zone-scale.ts` (drawing only; `web/tests/zone-scale.test.ts` fails if they drift) · strength formula →
don't (it's the coach's, in `sources/strength_sheet.py`) · muscle factor / bodyweight fraction per exercise → `public.exercises` rows (Supabase table editor) · `STRENGTH_K` / `BODYWEIGHT` → env ·
tokens and layout rules → `DESIGN.md` (Part B = the Ember direction, the visual reset of 2026-10-14) and `web/src/app/globals.css` · zone labels shown in the UI → `web/src/lib/dashboard-view.ts`.
