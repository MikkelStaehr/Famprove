# Project: training-app

Personal training-load app for one user. It combines cycling (intervals.icu) and strength (coach's Google Sheet) into one daily TSS series and derives CTL (42-day), ATL (7-day) and TSB = CTL − ATL, plotted over time with strength-block markers. Milestone 1 is done when Python collectors + a compute step fill Supabase idempotently from a daily GitHub Actions run, with tests for the parser and the CTL/ATL math. Milestone 2 is a read-only Next.js dashboard over `daily_load`. Milestone 3 (next) is Analyse › Samlet: what each block did to total load and fitness.

## Stack
- Frontend: Next.js (App Router, TypeScript, Tailwind) — milestone 2
- Backend/DB: Supabase (Postgres + RLS) · Python collectors/compute (uv)
- Hosting: Vercel (frontend) · GitHub Actions (scheduled Python jobs)
- Package manager: pnpm (frontend) · uv (Python)
- Tests: pytest (Python) · `node --test` (web, Node 24 type stripping)

## Commands
All Python commands run from `python/` (they read the repo-root `.env.local`).
- run: `uv run collect-intervals [--since 2024-12-30]` · `uv run collect-strength` · `uv run compute` · `uv run collect-plan` (in that order)
- test: `uv run pytest` (offline, synthetic fixtures) · `uv run pytest -m live` (hits intervals.icu, read-only)
- lint: `uv run ruff format --check src tests && uv run ruff check src tests && uv run mypy`
- db: `supabase db push` from the repo root (migrations in `supabase/migrations/`)
- web (from `web/`, reads `web/.env.local`): `pnpm dev` · `pnpm build && pnpm start` · checks: `pnpm lint && pnpm typecheck && pnpm test`
- **Run & screenshot:** use the `run-web` skill (`.claude/skills/run-web/`). Never invent a new screenshot method.
- **Dev switches** (only under `next dev`, ignored in production): `DEV_TODAY=YYYY-MM-DD` shows another day; `DEV_FIXTURE=empty|stale|error|band|midsession|answers` (`answers`: all three Cykel answers answered, block 3 with a plan; `midsession`: an illustrative set log for today, 3 sets done and 1 skipped per session, so Træning/Fokus can be shot mid-session without a write) makes the data layer show that state (`empty` and `error` without reading Supabase; `stale` ages real rows by 3 days; `band` gives real prognose rows after the strength block an illustrative uncertainty band), so every designed state can be screenshotted: `serve.ps1 -DevFixture <state>`. Specs name their states with these words.

CTL/ATL decay variant is one switch: `DECAY` in `python/src/training_load/domain/load.py`.

## Environment
- Ports: **3000 = the user's dev server, 3100 = agents.** Agents never touch 3000.
- Stop every server you started before the session ends.
- Run Python with `PYTHONIOENCODING=utf-8` (not set machine-wide yet; the Windows console chokes on "−" and "æ"). Write commit messages via a file (`git commit -F`), not inline quoting.
- Windows with Git Bash and PowerShell. uv, pnpm and the Supabase CLI are per-user installs; if a shell can't find them, restart VS Code.
- CI secrets: the daily job needs 7 `.env.example` variables as **repository** secrets on `MikkelStaehr/Famprove` (Settings → Secrets and variables → Actions → Secrets), and `STRENGTH_K` as a **repository variable** (→ Variables; `vars.STRENGTH_K`, a tunable, not a secret).

## Conventions
- Strict types. No `any` / untyped dict without a comment.
- All DB access through one data layer (`src/lib/db/*` or `app/db/*`) – never inline queries in UI or handlers.
- Secrets only in env files/vault. `.env.example` lists every var. Nothing secret is committed.
- Small commits, conventional-commit messages (`feat:`, `fix:`, `refactor:`).
- **Slices:** every commit ends with a `Slice: <id>` line (since 2026-10-05). Ids are lowercase and listed in `docs/PLAN.md` (## Slices: id | title | size, no status); a new task or slice gets its row before its first commit. A commit that only edits `docs/PLAN.md` carries `Slice: plan-slices` (or no Slice line), never the id of a slice nobody worked on. A finished slice is marked by an empty commit with `Slice-Done: <id>` lines, made only when the user asks.
- Prefer boring **code**. No new dependency without a one-line justification.
- **No silent defaults.** A value that can't be parsed never silently becomes 0 or empty. Missing is `null`, not 0. Collectors count and log unparseable values per run, and fail loudly above a threshold. Key derived values get sanity bounds; implausible values are flagged, not used.
- **Zero vs. missing per field.** Decide per field whether 0 is a valid value, and document it next to the field (schema comment or type). Missing is always `null`; 0 means a real zero only where the field allows it.
- **Contract tests across language boundaries.** Data that crosses a language boundary (e.g. Python writes JSON, the web parses it) gets a contract test: the consumer's fixture is the producer's real output, including edge cases.
- **External input is messy.** Numbers may arrive as text, with dot or comma decimals; junk rows exist. Parse defensively and test it.
- **Real-data fixtures.** Features that read external data are also tested against a current slice of real data (anonymised: this repo is public). Refresh it when the source changes (new block, season, file). Samples keep dates only (no times of day) and never state the anonymisation applied (e.g. a date shift or scale factor). A privacy fix to an unpushed commit is squashed in before pushing, so the original never reaches history.
- Store external source rows raw once (e.g. a `raw jsonb` column) so new views don't need new migrations.
- Python owns all calculations. The frontend only reads, with **one write path** (user, 2026-10-12): the Træning screens' set timing taps → `public.exercise_set_log` (per set since 2026-10-12; `exercise_log` per exercise before) through the server action in `web/src/app/actions.ts` (service key server-side, behind Vercel Authentication; no client writes, no other action or route handler writes). It is data collection, never a calculation; Python never reads it.
- The Google Sheet is read-only. Nothing in this repo may ever write to it.
- The strength-TSS formula comes from `sources/strength_sheet.py` (ex-`strength_collector.py`). Reuse it; do not redesign it. Exception (user, 2026-10-12): its two per-exercise inputs, the **muscle factor** (was 1.0 for leg TYPEs, 0.6 otherwise) and the **bodyweight fraction** (was the full BODYWEIGHT for a name list), come from the hand-edited `public.exercises` table (`domain/exercises.py`), never from code.
- `STRENGTH_K` and `BODYWEIGHT` are env-configured tunables, never hardcoded. Per-exercise values (muscle_factor, bodyweight_fraction) live in `public.exercises`; editing them takes effect at the next `collect-strength` + `compute`.
- Collectors are idempotent: re-running a day overwrites, never duplicates.
- **Multi-request writes** (retro, user 2026-10-12): a write path that takes several requests (there is no transaction: no RPC by rule) is designed for partial failure from the start: each tap writes its own mark last, a retry finishes a partly landed tap with the tap's original time, an undo says what it undoes (applied only while that is still true), and the slice includes a failure-injection test (cut the connection at every request, then retry) next to its invariant test.
- Single user. No auth UI, no multi-tenancy. RLS on every table.

## First deploy (before any push that can deploy)
1. **Protection first:** turn on access protection (e.g. Vercel Authentication, All Deployments) before the host is connected or before the first push. Verify a logged-out request gets 401 or a login redirect.
2. Build settings: Root Directory and framework preset match the app folder, not the repo root.
3. Env vars: server-side names only (never `NEXT_PUBLIC_` for secrets), Production scope only, and a separate revocable key for the host.
4. Scheduled jobs: their secrets are in CI **before** the first milestone, and the job has run green once.
5. Auth provider: new sign-ups off if the app is single-user.
6. Public repo: nothing with real personal data is committed (samples, fixtures, screenshots go in `.gitignore` or are anonymised).

## Orientation
- `docs/ARCHITECTURE.md` is a one-page map of folders, data flow and commands. Agents read it **instead of scanning the repo**. Update it when structure changes.

## Design
- `DESIGN.md` is the contract, owned by `design-lead`. Part A (guardrails) is fixed; Part B (direction: **Spurt**, chosen 2026-09-30) is this product's identity.
- UI must express Part B. Correct but generic is not done. No UI component library (shadcn/ui considered and not adopted, see Part B); Tailwind is themed from DESIGN.md tokens.
- Screen specs live in `design/specs/`, template and pattern packs in `design/`. `design/directions/` (Mode 0 samples with real data) is git-ignored.

## Milestone 1 brief (done 2026-09-28)
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
- Sheet is plan + log: coach prescribes sets/reps/RPE, the user logs kg on the day. The sheet defines sessions 1..N per ISO week (Mon–Sun), **never weekdays**. A session's date comes from intervals.icu: the n-th strength activity (`WeightTraining`, incl. manual ones) of the ISO week is session n, and its strength TSS lands on that activity's date. Planned sessions not yet done have no date and add nothing; an activity beyond N is an extra with 0 TSS ("not in the program"). Blok 11 predates the Garmin log: its sessions count once matching manual activities exist in intervals.icu (decided 2026-09-30).
- RPE in the coach's sheet is only whole or half values, on 1–10 (6, 6.5, 7; decided 2026-10-01). An RPE cell with any other number (e.g. "7,8") is counted as unreadable and logged, never used: the parser scores the set as RPE unknown, and the forecast leaves a planned set unscored.
- Block = tab name; start = first week's ISO Monday; end = last filled week; deload = last filled week of each tab. Derived from the sheet — no hand-kept list.
- Cycling = intervals.icu types `Ride` and `VirtualRide` only. `WeightTraining` only dates strength sessions (its own load is never used); everything else is excluded.
- Cycling TSS = intervals.icu's own load value as-is; rides without power use its HR-based load (never skipped).
- Backfill from 2026-01-01 with CTL = ATL = 0 on that date. Strength only from the current workbook (blok 11 onward). Rides are backfilled from 2024-12-30 (the ISO week of 2025-01-01) for the ride analysis only; `daily_load`/CTL still start 2026-01-01 (decided 2026-10-01: starting CTL in 2025 changes 2026 CTL by ≤ 1.5 and today's by 0.00).
- CTL/ATL use intervals.icu's exponential form: `x_t = x_{t-1}·w + load_t·(1 − w)`, `w = e^(−1/τ)`, τ = 42 / 7. TSB = CTL − ATL (same day). 1/τ (TrainingPeaks) stays available as `Decay.INVERSE_TAU`.
- Cycling-only CTL must match intervals.icu — enforced by a test.
- Weekly figure = ISO week (Mon–Sun), as a SQL view over `daily_load`.
- Private: RLS on, no anon policies; Python and Next.js read server-side only; Vercel Authentication (All Deployments).
- Daily run: last 14 days from intervals.icu + whole workbook; upsert on source id; mirror deletions inside that window; rebuild `daily_load` fully. Days bucketed by local date. Cron 05, 12 and 20 Europe/Copenhagen (DST-aware gate in daily.yml; 3× daily since 2026-10-01), at :07 (CEST) / :37 (CET), never :00 or :30: GitHub schedules are best-effort (first runs on :00 started 4–7 h late or not at all). Primary trigger since 2026-10-02: the user's DigitalOcean droplet calls workflow_dispatch (ref main, input slot=05|12|20) at 05, 12 and 20; GitHub's schedule is the backup. The gate (`.github/scripts/gate.py`, tests `python/tests/test_gate.py`) runs collect-and-compute once per slot: a slot is served by another run since its start − 30 min whose collect-and-compute succeeded; a queued or running one is waited for (≤ 15 min), so a run that fails lets the backup retry; unreadable runs or a timed-out wait fail open (a duplicate is harmless, a missed slot is not); a manual dispatch without slot always runs.
- `BODYWEIGHT` / `STRENGTH_K` (and the `public.exercises` values) are current-value tunables; changing them recomputes all history. `STRENGTH_K` = 0.035 since 2026-10-02: an anchor of ~60 TSS per heavy strength session (0.10 gave 153–197; intervals.icu's HR load was 19–22), not a calibration; /load says "Styrke-TSS er et skøn (K ukalibreret)". Form zones stay **absolute TSB** (decided 2026-10-02 on real data: % of CTL at CTL 8–15 put 61 % of days off the bar and changed zone 18 times in 60 days vs. 7); /load adds "Zonerne er grove ved lav fitness." Revisit % of CTL when CTL > 30 (queued). `GOOGLE_SERVICE_ACCOUNT_JSON` holds the JSON content.
- Garmin later gets its own `daily_wellness` table keyed by date. No planned/future workouts in M1.
- Layout: `python/` (uv project), `supabase/migrations/` (Supabase CLI), `web/` in M2.
- Infra: Supabase project `iutgmfnqlmogfitezjnj`, GitHub repo `MikkelStaehr/Famprove` (public — nothing sensitive in git).

## Milestone 2 brief (done 2026-10-05)
Done: Vercel production deploy green, and every daily slot from 2026-10-02 12:00 to 2026-10-05 12:00 served by the droplet with all 27 runs green (slice droplet-followup).
Read-only Next.js dashboard in `web/`. Visual contract: `DESIGN.md` (see its Project overrides).
- One screen, mobile first (390px), answering "how loaded am I right now, and is fitness going up?"
- Reads Supabase server-side only (service key in server env, never in the client bundle), from `daily_load`, `blocks` and `weekly_load`. No writes (until 2026-10-12: the exercise_log server action is the one write path).
- "updated <time>" from the latest `daily_load` row; stale when older than 26 h.
- Deploy on Vercel behind Vercel Authentication, scope "All Deployments" (tech-lead: free on Hobby, no auth code; Password Protection needs Pro + $20/mo). Root directory `web`.
- No auth UI, no settings page. pnpm, TypeScript strict, Tailwind; the simplest chart library that meets `DESIGN.md`.
- Prognose (decided 2026-10-01): cycling = the typical week of the last 28 days, planned rides replace their day. Strength = every remaining session of the current block scored from the coach's plan with the sheet formula (planned kg rules in `domain/planned_load.py`; 100 % completion; deload weeks as prescribed; a missed past session is dropped), on the learnt weekday per session number, else spread evenly. After the block: mean weekly TSS of the last 4 completed non-deload weeks, with their min-max as a band. Each run logs its prognose and a naive baseline (28-day mean held flat) in `forecast_log`; the last run of a day wins. Phase 2 (after 3-4 blocks): calibrate with explainable statistics only, measured as MAE of CTL/TSB at 7/28/56 days vs the baseline.
- Routes: `/` = Træning (was Today until 2026-10-12: what to do in the gym or on the bike today; spec `design/specs/traening.md`), `/fokus` = Fokus (one set at a time, same spec), `/load` = the load dashboard (unchanged), `/analyse` = Analyse (Cykel now; spec `design/specs/analyse.md`), a small nav between them.
- Analyse / Cykel (decided 2026-10-01): rides since 2024-12-30 (the ISO week of 2025-01-01) in `ride_metrics` + `cycling_weeks`, computed in `domain/ride_analysis.py`. Exclusions (too_short < 5 min or < 1 km, power_outlier, hr_outlier) are analytics-only and shown with a reason; weekly hours (moving time) and load count every ride. eFTP = intervals.icu's `icu_rolling_ftp` on each real-power ride; EF = NP / avg HR on endurance rides ≥ 30 min, 28-day median; lines break after > 21 days. The EF trend line is drawn only where ≥ 3 EF rides fall in its 28-day window (2026-10-02): counted in the web (`analyse-view.shownEfTrend`), the one deliberate exception to "Python owns the numbers" — it only hides Python's ef_trend, never computes one. The endurance intensity basis is one switch, `ENDURANCE` = intervals.icu's IF < 0.75 (11 rides since 2025; NP / rolling eFTP selects 0 because the rolling eFTP is a floor). Revisit after an FTP test; consider an HR-zone-based endurance filter later.
- Analyse / Styrke (decided 2026-10-01): kg counts as **lifted** once its session is matched to an intervals.icu activity; blok 11 (before the activity log) counts once its week has ended (`pre_log`); everything else is the plan and never counts. e1RM uses lifted kg only: kg × (1 + 0.0333 × (reps + 10 − RPE)) on competition-name top sets with an RPE prescription (≤ 8 reps); RPE = the logged LSRPE when present (the user logs it on the top set of each main lift from 2026-10-01), else the prescribed RPE. Week = best set, block = best week. Tonnage = kg × reps of lifted S/B/D sets, variants included. Phase per block in `domain/strength_analysis.PHASES` (≤ blok 11 in-season, ≥ 12 off-season; ask the user to confirm when a new block starts). The tab's 1RM table holds the user's old standard values: label it "1RM i arket (ikke testet)", never as progression. The Attempt Sheet tab is not used.
- kg history (`strength_set_kg`, decided 2026-10-01): planned kg (first and last seen before the session is done) and lifted kg (once done, following corrections) with timestamps, for a later "how often and how much do I adjust in the gym" analysis. Planned null means "not observed". The daily workflow runs at 05:00, 12:00 and 20:00 Copenhagen so planned kg is usually seen before same-day sessions.

## Exercise catalogue, exercise log, VI (decided 2026-10-12)
- **Exercise catalogue** (`public.exercises`, slice `exercises`): name, aliases, category (main | accessory | isolation | bodyweight | abs), parent_lift, muscle_factor, bodyweight_fraction, tracks_e1rm. Seeded from every distinct sheet name with the user's defaults (main 1.0, accessory 0.6, isolation 0.3; bodyweight fractions glute ham raise 0.6, dips / pull-ups / chin-ups 1.0, push-ups 0.65); the user corrects values in Supabase. Sheet names match name or alias, trimmed and case-insensitive. Effective kg = logged kg + BODYWEIGHT × bodyweight_fraction (stored as `strength_sets.kg`; the week card shows it where it differs from the logged kg). An unknown name is scored as accessory 0.6 without bodyweight, named in a warning, and added to the table by `collect-strength` (insert-only: the job never overwrites a hand edit). ABS keeps the formula's fixed score.
- **Exercise timing log** (`public.exercise_log`, slice `exercise-log`): the app's first write path. Key (date, session_no, exercise_id); started_at / ended_at are the server's clock. An exercise is every row of the session with the same name; it is done when its last row is ticked. A tick on any row of X sets X.started_at if null ("the first tap also sets started_at"); the completing tick sets X.ended_at and the next exercise's started_at if null (first write wins, so re-ticking after a reload changes nothing). Undo clears exactly what its tap wrote: every field one tap writes holds that tap's server timestamp, the server returns it only when the tap wrote something, the client keeps it in memory with the ticks and sends it back on undo, and the server clears only fields still holding it (a re-tick after a reload writes nothing, so it has nothing to undo); a row left empty is deleted. Writes are refused unless the date is today and every name is in that session of the sheet; under DEV_TODAY / DEV_FIXTURE nothing is written. Data collection only: for splitting the Garmin HR stream of a strength session per exercise later; nothing computes from it and Python never reads it. Ticks stay in memory (cleared on reload); a failed save shows "Et tidspunkt blev ikke gemt. Fluebenet står." until reload, and the tick stays. Limit: an exercise split around another (Squat, Bench, Squat) is one row; no real session does that (checked 2026-10-12).
- **Per-set log and suggested kg** (slices `set-log`, `suggested-kg`, user 2026-10-12): `public.exercise_set_log` (date, session_no, row_no = sheet row, set_no, exercise_id, started_at, ended_at, skipped), keyed (date, session_no, row_no, set_no), replaces the per-exercise log; `exercise_log` was copied over and dropped by migration `20261012220000_drop_exercise_log.sql`, applied right after the Træning deploy (2026-10-12). Taps (server clock T; next/previous set from the sheet's order on the server): begin → first open set's start; done → its end, its start if empty, the next set's start; skip → skipped, no timestamps, the next set's start; undo → clears what that tap wrote. A set's span includes the rest before it. The screens read their session's rows back, so progress survives a reload. `public.planned_sets` (compute, `domain/planned_sets.py`): suggested kg = rolling e1RM (best weekly e1RM of the exercise's parent_lift in the last 4 ISO weeks, from strength_weeks) × 1/(1 + 0.0333 × (reps + 10 − RPE)), rounded to 2.5; the sheet has no RPE table, so this is the relation /analyse already uses (its exact inverse). Null with a basis (not_rpe, no_lift, no_e1rm), never 0. The suggestion is multiplied by `exercises.suggestion_scale` (default 1.0; tempo variants 0.8, because they inherit the competition lift's e1RM, ≈ 20 % too heavy on 2026-10-12 data); the user tunes it in the table, the next compute applies it.
- **Træning and Fokus** (slices `traening`, `fokus`, user 2026-10-12; spec `design/specs/traening.md`): Today is renamed Træning everywhere (nav Træning · Belastning · Analyse; `/` stays the route for the home-screen bookmark). The overview shows the TSB flag with one hint line per zone, the session block with Begynd/Fortsæt træning, and a tick per set (grouped per sheet row; sets numbered across the exercise's run, D11); Fokus (`/fokus`) shows one set at a time (reps and suggested kg largest; suggested kg italic = computed, last week's upright = logged), a count-up rest timer from the last done tap, Spring over, Fortryd, Afslut, a progress bar, and survives a reload (state read back from the set log; the rest view if the latest tap was a done). The sheet's pre-filled kg is no longer shown (design-lead D3). The app never writes kg; logging kg stays in the sheet. `DEV_FIXTURE=midsession` shows a mid-session log without writing.
- **Power data checks** (slice `power-checks`, user 2026-10-13; `domain/power_check.py`): per ride, `activities.data_warning` (Danish text, null = none), written by collect-intervals: rule A, max power (intervals.icu `icu_pm_p_max`, the best 1-s power = the stream's max) > 1.3 × the ePmax of that day (`icu_rolling_p_max`); rule B, one power sample > 300 W above both neighbours AND > 0.8 × the ePmax of that day (user, 2026-10-13), checked on the power stream only when max power > 2 × the ride's FTP and the ePmax is known (to keep API calls down; a stream that can't be read is counted, and the ride is judged on rule A). The week card shows "Tjek effektdata" with the rule as tooltip. FTP sanity: collect-plan compares the ride FTP in intervals.icu (sportSettings.ftp) with its eFTP (sportSettings.mmp_model.ftp); while they differ by more than 15 % of the FTP, `app_notices` holds a `ftp_mismatch` row ("FTP er sat til 230 W, men dine ture peger på 183 W"), shown as a line on /load; it is deleted when they agree.
- **Variability index** (slice `ride-vi`): VI = NP / average power (intervals.icu `icu_weighted_avg_watts` / `icu_average_watts`), 2 dp, in `ride_metrics.vi` (rebuilt by compute every run, so history is always recomputed; kept next to EF and eFTP, not on `activities`, which mirrors intervals.icu). A raw ratio outside 1.0–2.0 is implausible: null, counted in the log. `vi_warning` = VI > 1.15 on a Z2 day (a `planned_sessions` name that day or the ride's own name contains "Z2" as a word; planned_sessions has no type column). The week card shows VI after NP/IF with the tooltip "Jævnhed – 1.0 = konstant effekt", in `--warning` with a triangle when flagged.
- **Cykel answers** (slice `cykel-answers`, user 2026-10-13; spec `design/specs/analyse.md` §12; `domain/cycling_answers.py` → `public.analysis_summary`, one row per question): Analyse › Cykel opens with three answers, each a number, a neutral arrow and Python's sentence; the web renders them verbatim. eFTP: the latest eFTP vs the latest 42 days before it (within 21 days), flat under 3 % (FTP test-retest noise; 2.7 % = the 25th percentile of 6-week change since 2025), the peak since the first ride (233 W, 7 Sep 2025), stale after 21 days. EF: the 28-day medians ending today and 42 days ago, each needing `EF_MIN_RIDES` = 3 (the web's trend-line rule, held equal by the contract test); when short, the sentence says how many easy rides are missing. Hours: the mean of the last 4 complete ISO weeks vs the 4 before (flat under 0.25 h) against `VOLUME_TARGET_H` = 3.0 h/week (a dated constant, user 2026-10-13); planned/done from `planned_sessions` (a planned date counts as done when a ride not too short is on it); no plan is null, never "0 af 0". `DEV_FIXTURE=answers` shows all three answered.
- **Future cycling progress view** (slice `cycling-progress`, queued, not built): VI, efficiency factor (EF = NP / average HR, already in `ride_metrics.ef`) and eFTP (`ride_metrics.rolling_ftp_w`) are its metrics.

## Milestone 3 brief (next, from 2026-10-26)
Analyse › Samlet (slice `f` = `f1` data + `f2` UI): "Hvad gjorde hver blok ved min samlede belastning og fitness?" Starts after blok 12 ends (2026-10-25), so at least one block has both cycling and strength measured. Re-run the real-data checks before building.
- Plan (tech-lead one-pager, 2026-10-01): `f1` = one migration `block_load` keyed (sheet_id, name), rebuilt by compute: mean weekly cycling / strength / total TSS over complete ISO weeks, CTL on start_date − 1 and on end_date (inclusive), an ongoing flag. `f2` = `/analyse/samlet` as the third tab: a block board plus weekly cycling/strength strips from `weekly_load`, with Styrke's block/phase ruler.
- Decided (2026-10-01): complete weeks only; deload weeks count in the block mean; ΔCTL = CTL at end − CTL the day before start; gap weeks belong to no block; phase from `blocks.phase`. The split is shown in TSS only, never %, with an honesty note. Strength before 2026-08-10 and blok 11 strength show "ikke registreret", never 0.
- Decided (2026-10-07): the user **did** strength-train Jan–Aug 2026 outside the sheet, so strength before 2026-08-10 is missing, not zero. Weeks before it show strength "ikke registreret", and the honesty note says CTL and total TSS there are cycling only (strength load is missing). That missing load also sits in CTL at blok 12's start and decays out during the block, so blok 12's ΔCTL is somewhat too high; the note says so. No open questions: `f1` starts 2026-10-26.
- Not part of M3 (queued, each waits for go): `form-pct-ctl` (when CTL > 30), `rpe-trend` (once LSRPE is logged), `band-visibility`, `rpe-readable-nit`, `vo2max-estimate` (conditional), `cycling-progress` (VI, EF, eFTP). Garmin stays a non-goal.

## How we work: size every task first
Before starting, the main session states the **size (S/M/L), the steps and the time budget** to the user. The user can change it.
If a budget is exceeded, **stop and ask**. Never keep running.
**Budget check at every step boundary:** when a step ends, add up the time used so far and put it in the status line (`used 34/60 min`). Agent time is the **measured** duration from each agent's task notification, not the agent's own estimate. If the next step won't fit in what's left, stop and ask before starting it, not after.
**Migrations go live together with the code that writes them:** apply the migration → push the code → run the job. No scheduled or manual job runs in between.
**Commit before `tester` ∥ `reviewer` ∥ `security`:** they check a committed tree (`git status` clean), never uncommitted work, and nobody edits files while they run. Fixes they trigger go in a new commit, and `tester` re-runs the affected criteria on it.
`∥` means the steps run in parallel.

| Size | When | Steps | Budget (agent time) |
|---|---|---|---|
| **S** | Text, colour, layout in an existing component; no new data | Main session (or `ui`) + one 390px screenshot. `reviewer` only if the diff is > ~50 lines | 10 min |
| **M** | New component or view on data that already exists | Data check ∥ `design-lead` spec-lite → build → `reviewer` ∥ `security` (security only if data/access changed) | 30 min |
| **L** | New data + new screen, or a new module | `tech-lead` one-pager → data check + **one** migration → `design-lead` spec ∥ data layer → `ui` build → `design-lead` review (Must only) → `ui` polish → `tester` ∥ `reviewer` ∥ `security` | 60 min |
| **Project start** | New repo | `tech-lead` + `architect` → `design-lead` Mode 0 → write `docs/ARCHITECTURE.md` | 45 min |

**L slices:** plan the build steps against 40 of the 60 minutes; `design-lead` review, polish, `tester` and `reviewer` take about 20. A slice holds at most one new UI surface; split it otherwise.

**Data check** (M and L): list every value the screen shows and mark it *exists / missing*. All missing data goes into **one** migration before any UI is built.

**Research first, ask after.** Before asking the user a technical question, research it and bring numbers. Before calling a parameter or threshold wrong, run it on real data and report how many rows it selects. Before drawing a conclusion from a stored field, read how it is computed, so you don't measure your own input.

## Status to the user
- Before each step: what, which agent, and an estimated time.
- Agents over ~10 min: give a short status when they return. Run long agents in the background where possible.

## Definition of done
- **S:** it works, the screenshot looks right, lint and typecheck pass.
- **M:** plus tests for new logic, and `reviewer` has approved.
- **L:** plus `tester` PASS on every acceptance criterion, no open **Must** from `design-lead`, and `security` approved if relevant.
- **Milestone:** plus the production pipeline (scheduled jobs, deploy) has run green end-to-end at least once.

## Retro: how the team learns
After every L task, and whenever something went wrong, the main session writes a retro of max 5 lines:
1. What went wrong (or cost the most time)
2. Root cause
3. The rule that prevents it, and **which file it belongs in** (agent file, the ProjectStart template, a skill)

The user approves. Then:
- **Project-specific rules** go into this repo's CLAUDE.md.
- **Rules for every project** are only *proposed* here: exact wording, target file, and a `LESSONS.md` row. **This session never edits ProjectStart** (`C:\dev\waan\teams`, GitHub `MikkelStaehr/ProjectStart`: the team's agents, templates and skills). The user applies the proposal there in a separate session, pushes, and runs `install.sh`.

A lesson that only lives in a chat is lost.

## Development team (user-level subagents in ~/.claude/agents/)
`tech-lead` · `architect` · `design-lead` · `ui` · `tester` · `reviewer` · `security` · `debugger`.
Agents are called only as listed in the size table, plus `debugger` when the cause of a failure is unclear.
**Install new agents before starting the session.** Agents added mid-session aren't loaded until the next one.

## Non-goals
- No premature scaling. Optimize when a measurement says so.
- No rewrites for style. Preserve working behaviour.
- No process for its own sake. If a step adds nothing for this task, skip it and say so.
- No Garmin integration yet (HRV, resting HR, sleep come later — keep the schema open for it).
