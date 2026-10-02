# Architecture – training-app

One user's training load: Python jobs pull cycling (intervals.icu) and strength (the coach's Google
Sheet) into Supabase once a day and compute every number; a read-only Next.js app shows it.
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
  collect-strength   Google Drive xlsx export (read)    → strength_sets (ISO week + session 1..N, no dates;
                                                          the week's cells as `raw`, LSRPE as logged_rpe)
  compute            activities + strength_sets + strength_activities
                                                        → strength_sessions, daily_load, blocks (+ view weekly_load),
                                                          daily_projection (the 56-day prognose; + planned_sessions),
                                                          forecast_log (that prognose + a naive baseline, per run day),
                                                          ride_metrics + cycling_weeks (the ride analysis, rides since 2024-12-30),
                                                          blocks.phase, strength_weeks (e1RM + tonnage per week and lift),
                                                          strength_set_kg (planned/lifted kg history; updated, never rebuilt)
  collect-plan       planned_sessions (hand-filled) + FTP from intervals.icu → planned_targets

Next.js (web/), server components only
  /       Today   ← daily_load (form line), strength_sessions + strength_sets (this ISO week, last week), planned_targets
  /load   Load    ← daily_load, blocks, weekly_load; week details ← activities, strength_sessions, strength_sets
  /analyse Analyse (Cykel) ← ride_metrics, cycling_weeks
  /analyse/styrke Analyse (Styrke) ← strength_weeks, blocks (phase), strength_sets.e1rm (the sheet 1RM)
```

## Folders
| Path | What lives there |
|---|---|
| `python/src/training_load/sources/` | Adapters that read the outside world: `intervals.py`, `google_drive.py`, `strength_sheet.py` (the coach-sheet parser and strength formula; formula lines never change) |
| `python/src/training_load/domain/` | Pure calculations, stdlib only: `load.py` (CTL/ATL, `DECAY`), `form.py` (ramp, intervals.icu zones), `strength.py` (session numbers, filled weeks, blocks), `sessions.py` (n-th strength activity of an ISO week = session n; strength TSS), `cycling.py`, `daily.py`, `plan.py` (watt targets), `projection.py` (the 56-day prognose: cycling = typical week + planned rides; strength = the coach's plan to the block's end, then the recent weeks with a low-high band; `naive_projection` = the baseline), `planned_load.py` (planned kg per set and the plan score of a session), `ride_analysis.py` (Analyse/Cykel: exclusions, eFTP/EF points and line breaks, EF 28-day median, year-ago eFTP, weekly totals; `ENDURANCE` = the EF intensity basis), `strength_analysis.py` (Analyse/Styrke: lifted status, `PHASES`, e1RM from lifted kg, weekly rows), `kg_history.py` (planned/lifted kg transitions), `dates.py` (`SERIES_START` 2026-01-01 for daily_load, `ANALYSIS_START` 2024-12-30, the ISO week of 2025-01-01, for the ride analysis) |
| `python/src/training_load/db/` | The only code that talks to Supabase (PostgREST over `requests`), one module per table |
| `python/src/training_load/cli/` | The five console scripts, one per step of the daily job (`check-config` first) |
| `python/src/training_load/*.py` | `config.py` (env, fail-fast), `http.py` (retrying HTTP seam), `narrow.py` (JSON → typed fields) |
| `python/tests/` | pytest with synthetic fixtures (`conftest.py` builds a fake workbook and an in-memory PostgREST) and an anonymised real-data slice (`fixtures/blok12_slice.json`: refresh it when a new block starts); `test_contract_*.py` write the web's JSON fixtures (`REGENERATE_CONTRACT=1`) |
| `supabase/migrations/` | Schema, RLS, grants; applied with `supabase db push` |
| `web/src/lib/db/` | Server-only data layer (`server-only`): `queries.ts` entry points, `postgrest.ts` client, `rows.ts` typed parsers, `dev-fixture.ts` (DEV_FIXTURE, dev only: empty, stale, error, band, ef-few, lsrpe) |
| `web/src/lib/*.ts` | Pure view models and formatting: `dashboard-view.ts` (/load), `today-view.ts` (/), `zone-scale.ts` (zone-bar drawing scale, zone swatches and range texts, sr sentence, /load zone reading), `analyse-view.ts` (/analyse), `analyse-styrke-view.ts` (/analyse/styrke: lift board, e1RM panels, block ruler, tonnage weeks), `format.ts` (locale da-DK), `dates.ts` |
| `web/src/app/` | Routes: `page.tsx` (Today), `load/page.tsx`, `analyse/layout.tsx` (h1) + `analyse/page.tsx` (Cykel) + `analyse/styrke/page.tsx`, `layout.tsx` (nav + tick provider) |
| `web/src/components/` | UI pieces; client components only where needed: `ZoneBar` (form on both screens), `TrendChart` + `ChartSeries` (legend swatches), `AnalyseCharts` (/analyse eFTP/EF charts, weekly strips, pause seams; Styrke e1RM panels, tonnage strips, block ruler), `AnalyseTabs` (Cykel / Styrke section links), `LoadExplainer` ("Hvad betyder det?"), `ScreenNav`, `TickProvider`, `ExerciseChecklist` (NÆSTE slab) |
| `web/tests/` | `node --test` on the pure modules |
| `DESIGN.md`, `design/` | Visual contract (design-lead), screen specs, pattern packs |
| `.claude/skills/run-web/` | The only way to run and screenshot the web app (port 3100) |

## Tables
`activities` (rides) · `strength_activities` (WeightTraining from intervals.icu) ·
`strength_sets` (every prescribed set: plan + logged kg + cells as written; ISO week + session number) ·
`strength_sessions` (derived: per ISO week and session number, the activity that did it, its date, TSS) ·
`daily_load` (one row per day since 2026-01-01: TSS, CTL, ATL, TSB, ramp, zone, `computed_at`) ·
`blocks` (strength blocks + deload) · `weekly_load` (view) · `planned_sessions` (you fill) ·
`planned_targets` (derived watts) · `daily_projection` (the prognose, next 56 days, rebuilt by `compute`; estimates only) ·
`forecast_log` (every run day's prognose and naive baseline, upserted per day, never pruned: for measuring forecast error later) ·
`ride_metrics` (derived: every ride since 2024-12-30 with its trend values and why it is left out of them) ·
`cycling_weeks` (derived: every ISO week since 2024-12-30, 0 for a week without rides) ·
`strength_weeks` (derived: every ISO week x SQUAT/BENCH/DEADLIFT from the first block: tonnage, best e1RM, block best) ·
`strength_set_kg` (persistent: planned and lifted kg per set with timestamps; like forecast_log it can't be rebuilt). `activities.raw` / `strength_activities.raw` hold the intervals.icu object as delivered.

## Commands
- Python, from `python/` (reads repo-root `.env.local`): `uv run check-config` · `uv run collect-intervals [--since 2026-01-01]`,
  `collect-strength`, `compute`, `collect-plan` · `uv run pytest` · `uv run ruff check src tests && uv run mypy`
- Web, from `web/` (reads `web/.env.local`): `pnpm dev` · `pnpm lint && pnpm typecheck && pnpm test` · `pnpm build`
- Database, from the repo root: `supabase db push`
- CI: `test.yml` on every push (Python + web checks, no secrets); `daily.yml` needs the 8 repository secrets.

## Where to change what
Strength session rule → `domain/sessions.py` · ride-analysis thresholds and the EF intensity basis → `domain/ride_analysis.py` · program phases, competition-lift names and e1RM rules → `domain/strength_analysis.py` · Decay variant → `domain/load.py` `DECAY` · form-zone bands → `domain/form.py` + `web/src/lib/zone-scale.ts` (drawing only; `web/tests/zone-scale.test.ts` fails if they drift) · strength formula →
don't (it's the coach's, in `sources/strength_sheet.py`) · `STRENGTH_K` / `BODYWEIGHT` → env ·
tokens and layout rules → `DESIGN.md` (Part B = the Spurt direction) and `web/src/app/globals.css` · zone labels shown in the UI → `web/src/lib/dashboard-view.ts`.
