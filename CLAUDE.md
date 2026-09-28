# Project: training-app

Personal training-load app for one user. It combines cycling (intervals.icu) and strength (coach's Google Sheet) into one daily TSS series and derives CTL (42-day), ATL (7-day) and TSB = CTL − ATL, plotted over time with strength-block markers. Milestone 1 is done when Python collectors + a compute step fill Supabase idempotently from a daily GitHub Actions run, with tests for the parser and the CTL/ATL math. Milestone 2 is a read-only Next.js dashboard over `daily_load`.

## Stack
- Frontend: Next.js (App Router, TypeScript, Tailwind) — milestone 2
- Backend/DB: Supabase (Postgres + RLS) · Python collectors/compute (uv)
- Hosting: Vercel (frontend) · GitHub Actions (scheduled Python jobs)
- Package manager: pnpm (frontend) · uv (Python)

## Commands
- dev: `<TBD>`   build: `<TBD>`   test: `<TBD>`   lint: `<TBD>`

## Conventions
- Strict types. No `any` / untyped dict without a comment.
- All DB access through one data layer (`src/lib/db/*` or `app/db/*`) – never inline queries in UI or handlers.
- Secrets only in env files/vault. `.env.example` lists every var. Nothing secret is committed.
- Small commits, conventional-commit messages (`feat:`, `fix:`, `refactor:`).
- Prefer boring solutions. No new dependency without a one-line justification.
- Python owns all calculations. The frontend only reads `daily_load`.
- The Google Sheet is read-only. Nothing in this repo may ever write to it.
- The strength-TSS formula comes from `strength_collector.py`. Reuse it; do not redesign it.
- `STRENGTH_K` and `BODYWEIGHT` are env-configured tunables, never hardcoded.
- Collectors are idempotent: re-running a day overwrites, never duplicates.
- Single user. No auth UI, no multi-tenancy. RLS on every table.

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
