# Project: training-app

Personal training-load app for one user. It combines cycling (intervals.icu) and strength (coach's Google Sheet) into one daily TSS series and derives CTL (42-day), ATL (7-day) and TSB = CTL − ATL, plotted over time with strength-block markers. Milestone 1 is done when Python collectors + a compute step fill Supabase idempotently from a daily GitHub Actions run, with tests for the parser and the CTL/ATL math. Milestone 2 is a read-only Next.js dashboard over `daily_load`.

## Stack
- Frontend: Next.js (App Router, TypeScript, Tailwind) — milestone 2
- Backend/DB: Supabase (Postgres + RLS) · Python collectors/compute (uv)
- Hosting: Vercel (frontend) · GitHub Actions (scheduled Python jobs)
- Package manager: pnpm (frontend) · uv (Python)

## Commands
All Python commands run from `python/` (they read the repo-root `.env.local`).
- run: `uv run collect-intervals [--since 2026-01-01]` · `uv run collect-strength` · `uv run compute` (in that order)
- test: `uv run pytest` (offline, synthetic fixtures) · `uv run pytest -m live` (hits intervals.icu, read-only)
- lint: `uv run ruff format --check src tests && uv run ruff check src tests && uv run mypy`
- db: `supabase db push` from the repo root (migrations in `supabase/migrations/`)
- frontend (M2): `<TBD>`

CTL/ATL decay variant is one switch: `DECAY` in `python/src/training_load/domain/load.py`.

## Conventions
- Strict types. No `any` / untyped dict without a comment.
- All DB access through one data layer (`src/lib/db/*` or `app/db/*`) – never inline queries in UI or handlers.
- Secrets only in env files/vault. `.env.example` lists every var. Nothing secret is committed.
- Small commits, conventional-commit messages (`feat:`, `fix:`, `refactor:`).
- Prefer boring solutions. No new dependency without a one-line justification.
- Python owns all calculations. The frontend only reads `daily_load`.
- The Google Sheet is read-only. Nothing in this repo may ever write to it.
- The strength-TSS formula comes from `sources/strength_sheet.py` (ex-`strength_collector.py`). Reuse it; do not redesign it.
- `STRENGTH_K` and `BODYWEIGHT` are env-configured tunables, never hardcoded.
- Collectors are idempotent: re-running a day overwrites, never duplicates.
- Single user. No auth UI, no multi-tenancy. RLS on every table.

## Milestone 1 brief (current)
Goal: one weekly key figure — total TSS across cycling and strength — plus daily CTL (42 d), ATL (7 d), TSB = CTL − ATL, with strength-block markers. No UI in M1; M2 is a Next.js dashboard reading `daily_load` (+ weekly view).

Sources:
1. intervals.icu API (cycling): activities with TSS, NP, IF, duration, FTP. ~2 Zwift sessions/week (Thu, Sun) plus other rides.
2. Google Sheets (strength coach's program): one workbook, one tab per block named `Program - blok N ...`. Parsing and the strength-TSS formula live in `sources/strength_sheet.py` (ex-`strength_collector.py`) — reuse, don't redesign. Read-only.
3. Later: Garmin (HRV, resting HR, sleep). Keep the schema open for it; don't implement.

Deliverables:
- Supabase schema: `activities` (cycling), `strength_sets`, `daily_load` (date, cycling_tss, strength_tss, ctl, atl, tsb), `blocks` (name, start, end, deload flag). RLS on everything, single user.
- Python collectors (uv, no FastAPI): one CLI entry per source, idempotent, runnable daily from GitHub Actions.
- Compute step that rebuilds `daily_load` from `activities` + `strength_sets`.
- Config via env (`.env.local` locally, GitHub secrets in CI) — see `.env.example`.
- Tests for the parser and the CTL/ATL math, with fixtures.

Decisions (agreed with the user):
- Sheet is plan + log: coach prescribes sets/reps/RPE, the user logs kg on the day. Dates come from `sources/strength_sheet.py` (ex-`strength_collector.py`).
- Block = tab name; start = first week date; end = last filled week; deload = last filled week of each tab. Derived from the sheet — no hand-kept list.
- Cycling = intervals.icu types `Ride` and `VirtualRide` only. Everything else (incl. Garmin-synced `WeightTraining`) is excluded.
- Cycling TSS = intervals.icu's own load value as-is; rides without power use its HR-based load (never skipped).
- Backfill from 2026-01-01 with CTL = ATL = 0 on that date. Strength only from the current workbook (blok 11 onward).
- CTL/ATL use intervals.icu's exponential form: `x_t = x_{t-1}·w + load_t·(1 − w)`, `w = e^(−1/τ)`, τ = 42 / 7. TSB = CTL − ATL (same day). 1/τ (TrainingPeaks) stays available as `Decay.INVERSE_TAU`.
- Cycling-only CTL must match intervals.icu — enforced by a test.
- Weekly figure = ISO week (Mon–Sun), as a SQL view over `daily_load`.
- Private: RLS on, no anon policies; Python and Next.js read server-side only; Vercel password protection.
- Daily run: last 14 days from intervals.icu + whole workbook; upsert on source id; mirror deletions inside that window; rebuild `daily_load` fully. Days bucketed by local date. Cron ≈ 05:00 Europe/Copenhagen.
- `BODYWEIGHT` / `STRENGTH_K` are current-value tunables; changing them recomputes all history. `GOOGLE_SERVICE_ACCOUNT_JSON` holds the JSON content.
- Garmin later gets its own `daily_wellness` table keyed by date. No planned/future workouts in M1.
- Layout: `python/` (uv project), `supabase/migrations/` (Supabase CLI), `web/` in M2.
- Infra: Supabase project `iutgmfnqlmogfitezjnj`, GitHub repo `MikkelStaehr/Famprove` (public — nothing sensitive in git).

## Development team (user-level subagents in ~/.claude/agents/)
| When | Agent |
|---|---|
| New feature or unclear requirement | `tech-lead` first |
| New project, new module, schema change | `architect` |
| Feature finished, before merge | `reviewer` |
| Bug, failing test, wrong output | `debugger` |
| Before first deploy; after auth/DB-access/API/secret changes | `security` |

Default flow: tech-lead → (architect if structural) → implement → reviewer → security if it touches auth or data.

## Non-goals
- No premature scaling. Optimize when a measurement says so.
- No rewrites for style. Preserve working behaviour.
- No Garmin integration yet (HRV, resting HR, sleep come later — keep the schema open for it).
