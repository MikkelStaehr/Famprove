# Architecture – training-app

One user's training load: Python jobs pull cycling (intervals.icu) and strength (the coach's Google
Sheet) into Supabase once a day and compute every number; a read-only Next.js app shows it.
Rules that shape everything: **Python owns all calculations** · the sheet is **read-only** · the
Supabase service key is **server-side only** · every table has RLS with no anon access.

## Data flow
```
GitHub Actions daily.yml (≈05:00 Copenhagen; also "Run workflow")
  collect-intervals  intervals.icu API (last 14 d)      → activities
  collect-strength   Google Drive xlsx export (read)    → strength_sets
  compute            activities + strength_sets         → daily_load, blocks   (+ SQL view weekly_load)
  collect-plan       planned_sessions (hand-filled) + FTP from intervals.icu → planned_targets

Next.js (web/), server components only
  /       Today   ← daily_load (form line), strength_sets (today + last week), planned_targets
  /load   Load    ← daily_load, blocks, weekly_load; week details ← activities, strength_sets
```

## Folders
| Path | What lives there |
|---|---|
| `python/src/training_load/sources/` | Adapters that read the outside world: `intervals.py`, `google_drive.py`, `strength_sheet.py` (the coach-sheet parser and strength formula; formula lines never change) |
| `python/src/training_load/domain/` | Pure calculations, stdlib only: `load.py` (CTL/ATL, `DECAY`), `form.py` (ramp, intervals.icu zones), `strength.py` (filled weeks, blocks), `cycling.py`, `daily.py`, `plan.py` (watt targets), `dates.py` |
| `python/src/training_load/db/` | The only code that talks to Supabase (PostgREST over `requests`), one module per table |
| `python/src/training_load/cli/` | The four console scripts, one per step of the daily job |
| `python/src/training_load/*.py` | `config.py` (env, fail-fast), `http.py` (retrying HTTP seam), `narrow.py` (JSON → typed fields) |
| `python/tests/` | pytest with synthetic fixtures (`conftest.py` builds a fake workbook and an in-memory PostgREST) |
| `supabase/migrations/` | Schema, RLS, grants; applied with `supabase db push` |
| `web/src/lib/db/` | Server-only data layer (`server-only`): `queries.ts` entry points, `postgrest.ts` client, `rows.ts` typed parsers |
| `web/src/lib/*.ts` | Pure view models and formatting: `dashboard-view.ts` (/load), `today-view.ts` (/), `format.ts`, `dates.ts` |
| `web/src/app/` | Routes: `page.tsx` (Today), `load/page.tsx`, `layout.tsx` (nav + tick provider) |
| `web/src/components/` | UI pieces; client components only where needed: `TrendChart`, `ScreenNav`, `TickProvider`, `ExerciseChecklist` |
| `web/tests/` | `node --test` on the pure modules |
| `DESIGN.md`, `design/` | Visual contract (design-lead), screen specs, pattern packs |
| `.claude/skills/run-web/` | The only way to run and screenshot the web app (port 3100) |

## Tables
`activities` (rides) · `strength_sets` (every prescribed set: plan + logged kg + cells as written) ·
`daily_load` (one row per day since 2026-01-01: TSS, CTL, ATL, TSB, ramp, zone, `computed_at`) ·
`blocks` (strength blocks + deload) · `weekly_load` (view) · `planned_sessions` (you fill) ·
`planned_targets` (derived watts).

## Commands
- Python, from `python/` (reads repo-root `.env.local`): `uv run collect-intervals [--since 2026-01-01]`,
  `collect-strength`, `compute`, `collect-plan` · `uv run pytest` · `uv run ruff check src tests && uv run mypy`
- Web, from `web/` (reads `web/.env.local`): `pnpm dev` · `pnpm lint && pnpm typecheck && pnpm test` · `pnpm build`
- Database, from the repo root: `supabase db push`
- CI: `test.yml` on every push (Python + web checks, no secrets); `daily.yml` needs the 8 repository secrets.

## Where to change what
Decay variant → `domain/load.py` `DECAY` · form-zone bands → `domain/form.py` · strength formula →
don't (it's the coach's, in `sources/strength_sheet.py`) · `STRENGTH_K` / `BODYWEIGHT` → env ·
tokens and layout rules → `DESIGN.md` · zone labels shown in the UI → `web/src/lib/dashboard-view.ts`.
