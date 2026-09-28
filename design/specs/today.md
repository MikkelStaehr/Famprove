# Spec – Today (`/`)

Owner: design-lead · 2026-09-28 · for `ui`. Contract: `DESIGN.md` (tokens, components, section "Today"). `/load` keeps following `design/patterns/data-dashboard.md`. Today is a gym/bike companion, not a dashboard: its rules are in DESIGN.md › Today.

## 1. Question and primary action
- **Question:** "What am I doing in this session, and how hard?"
- **Primary action (strength only):** tick a sheet row as done. This is the only interaction on the page apart from the nav. Ride and rest days have no action because the screen is a reference.
- **Cut:** logging kg, charts, CTL/ATL, history, muscle-group `type` (the names already say it), and ticking ride steps (Zwift runs the workout). The form line is the only load number.

## 2. Routes and nav
- `/` renders Today on every date. The rest state covers rest days. "Today" means the local date in Europe/Copenhagen at request time, not the latest `daily_load` date, because the plan exists before the 05:00 job runs.
- `/load` is the current dashboard, unchanged apart from these edits:
  - nav on top
  - `weekHref` becomes `/load?week=…` (`WeekSwitcher.tsx:8`)
  - "Back to this week" goes to `/load` (`WeekSwitcher.tsx:72`)
  - the LoadError retry goes to `/load` (`page.tsx:226`)
  - its skeleton moves to `app/load/loading.tsx`
- **`ScreenNav`** goes in the root layout, so it also shows during loading and errors. It sits in a `<header>` before `<main>`, with the same `max-w-content px-4`, and `pt-2`.
  - `<nav aria-label="Main">` with two links: **Today** → `/` and **Training load** → `/load`.
  - Tab strip: links are text-16, `min-h-11`, `px-3`, `gap-2`, left-aligned. A 1px `--border` line runs under the strip.
  - The current link has `aria-current="page"`, semibold `--text`, and a 2px `--text` bar at its bottom edge, on the strip line. The other link is regular weight in `--accent`. Weight and the bar mark the current page, so colour is never the only signal.
  - The nav is **not sticky**. It is used rarely, and in the gym the vertical space goes to the session. `main` keeps `py-6`.
- Document titles: Today is `Today · Training load`. `/load` stays `Training load`.

## 3. Layout top to bottom (390px)

### Header (every day)
1. `h1` (text-20 bold): **Today** followed by ` · Mon 28 Sept` (`formatDay`, regular weight, `--text-muted`).
2. Updated line: reuse `/load`'s `UpdatedLine`, extracted to a component with a stale-note prop. Copy is in §5.
3. **Form line**, one line:
   - `Form (TSB)` in text-14 semibold
   - `+11` in text-20 bold tabular (`formatSigned`)
   - `TSS/day` in text-14 muted
   - `StatusBadge` with the zone label and tone (`FORM_ZONE_DISPLAY`)
   - If the latest `daily_load` row is not today, add ` · Sun 27 Sept` (text-14 muted) after the unit, so nobody takes an old number for today's.
   - Uses `flex-wrap`, so it wraps only at large text sizes.
   - Gaps: h1 → updated 4px, updated → form 8px. `main` keeps `gap-6` (24px) between the header and the cards.

### Content order
- Ride card(s) come first, then the Strength card. A day with only one kind shows only that card. A day with neither shows the Rest card.
- Why the ride goes first: it is short (~500px). With strength first on a day with both, the ride would sit about 1000px down, and you wouldn't know it was there.

### Strength card (`Card id="strength"`)
- **Title:** "Strength".
- **Action slot:** progress "0 of 11 done", text-16 semibold tabular. It reads "All 11 done" when every row is ticked. It is not a live region, because each checkbox announces its own state.
- **Identity line** (text-16): `{block tab name as written} · week {n}`, e.g. "Program - blok 12 (offseason) · week 1".
- **Week-1 note** (week 1 only, text-14 muted): "Week 1 of the block: no kg from last week to compare yet."
- **List** `<ol aria-label="Exercises">`: one `<li>` per sheet row, in sheet order. Consecutive rows with the same trimmed name form one visual run (for example top sets followed by a backoff).
  - The name (text-20 semibold) shows only on the first row of a run. Continuation rows carry it as `sr-only`, so every row still makes sense read alone.
  - A 1px `--border` divider goes between runs, with none inside a run.
- **Row:** a `<label>` covering the whole row, name included, wrapping a native checkbox.
  - Grid: a 28px check column, a 12px gap, then the text column. The check lines up with the prescription line, not with the name.
  - **Prescription line** (`flex-wrap gap-x-4 gap-y-1`): `{sets} × {reps}` in text-28 bold tabular, then the prescribed load as written in text-28 bold, e.g. `2 × 8 - 12`  `RPE 5 - 6`, or `2 × 5`  `-10%`.
    - If only one of sets or reps is present, show it with its word ("10 - 15 reps", "2 sets").
    - No load cell means no load shown, with no dash, because the coach didn't prescribe one.
  - **Reference line** (week ≥ 2, text-20):
    - Format: "Last week" in `--text-muted`, a space, then the value in semibold `--text`. Use `formatSetLoad` wording: "100 kg", "bodyweight", "bodyweight + 10 kg".
    - A null reference reads "Nothing logged last week", all muted. Never show "0 kg".
    - Week 1 has no reference line at all; the week-1 note says it once.
  - Padding is `py-3` with a minimum height of 44px. A row is about 55px in week 1 and about 87px with a reference line.
  - **Accessible name**, e.g. "Squat, 1 set of 3 reps at RPE 5, last week 100 kg".
    - Screen-reader text only: " - " between numbers becomes " to " ("8 to 12 reps", "RPE 6 to 7").
    - Sets written "1" read as "set"; any other value reads as "sets".
    - Visible text always stays exactly as written.
- **Check:** a 28px circle.
  - Unticked: a 2px `--text-muted` ring.
  - Ticked: filled `--positive` with a `--surface` ✓. The row's text switches to `--text-muted`, which is still ≥ 4.5:1 and readable. The run's name (shown on its first row) turns muted only when every row of the run is ticked, so "Squat" never looks done after the first top set.
  - No strike-through, no reordering, no animation.
  - Tapping again unticks, which is the undo.
  - Focus: a 2px `--accent` ring around the whole row (`label:has(:focus-visible)`).
- **Footnote** after the list (text-14 muted): "Ticks clear when the page reloads. Log kg in the sheet."
- **Tick state:**
  - Held in memory only, in a small client provider in the root layout, keyed by date + block + sheet row.
  - Switching to Training load and back keeps the ticks. A reload clears them.
  - Checkboxes are controlled, so the browser can't restore them on reload.
  - No localStorage, sessionStorage, cookies or request of any kind. Ticking works with no signal.

### Ride card (`Card id="ride-{n}"`, one per planned session, in table order)
- **Title:** "Ride".
- **Action slot:** "Total 1:15 h" in text-16 semibold tabular (`formatDuration`, same as /load).
- **Name** in text-20 semibold, e.g. "Zwift – Over-unders 4×8". These are the words you look for in Zwift.
- **Notes**, if any, in text-16.
- **FTP line** in text-14 muted: "Targets from FTP 250 W".
- **Steps** `<ol aria-label="Workout steps">`, in order. Rows have a 1px `--border` divider and `py-3`, with two columns:
  - **Left:** the label in text-20 semibold ("Warm-up", "On"), with the duration below it in text-20 regular ("10 min"). A step with no label shows the duration alone, in semibold.
  - **Right, right-aligned:** watts in text-28 bold tabular, with " W" in the same text-28 bold ("263 W", "225–250 W"). A smaller capital W reads as a lowercase "w" beside 28px digits. Below that, % FTP in text-16 muted ("105% FTP", "90–100% FTP").
  - **Repeated group:** a header row "Repeat 4 times" in text-16 semibold. Its steps are indented 16px with a 2px `--chart-mark` rule on the left. Durations are per repetition.
- **Formats:**
  - Whole watts and whole %.
  - Ranges use an en dash with no spaces.
  - Durations read "8 min", "30 s", "1 min 30 s".
  - Singular counts: "Repeat 1 time", "1 rep".
- **Gaps in the data:**
  - No FTP: the right column shows % FTP in text-28 bold (" FTP" in text-20), and the FTP line reads "No FTP from intervals.icu, so targets are in % FTP only."
  - Every step has a % FTP target (Python rejects steps without one), so there is no "No target" state.
  - Unreadable steps (`problem` from Python, plain words): no "Total", no FTP line, no steps. A `WarningLine` reads "Couldn't read the steps, so no targets are shown. Fix them in planned_sessions ({problem})."
  - A ride with no steps: `EmptyState` "No steps entered for this ride."
- **Several strength sessions on one date:** one Strength card each, in sheet order; the identity line tells them apart.

### Rest card (`Card id="rest"`)
- **Title:** "Rest day". Body in text-20: "Nothing planned today."
- **"Next session"** label in text-14 semibold muted. For each session on that date:
  - The date in text-20 semibold: "Tomorrow · Tue 29 Sept", or "Thu 1 Oct".
  - What it is, in text-16: "Strength · Program - blok 12 (offseason), week 2" or "Ride · Zwift – Over-unders 4×8". If the date has both, show two lines.
- If nothing is planned within 28 days, show `EmptyState`: "No session planned in the next 28 days. Rides come from planned_sessions, strength from the coach's sheet."

## 4. Above the fold at 390 × 844
The header ends at about y 167: layout header 53px, `main` padding 24px, h1, updated line and form line. The first card starts at about y 191.

| Day | Fully visible without scrolling | Cut below the fold |
|---|---|---|
| Strength, today (blok 12 week 1, 11 rows) | Squat (3 rows), Bænk (3), Zercher | Last 4 rows, footnote |
| Strength, week ≥ 2 (with references) | Squat run and 2 Bænk rows | The rest |
| Ride (≤ 5 step rows) | Whole card | – |
| Ride + strength | Whole ride card, plus the Strength title and identity line | Exercise rows |
| Rest | Everything | – |

In a real iPhone Safari viewport (≈ 390 × 660), at least the first run (Squat) is fully visible.

## 5. States and copy
| State | Where | Copy / treatment |
|---|---|---|
| Loading | `app/loading.tsx` (the nav is real, from the layout) | h1 "Today" is real, with a bar for the date. Bars for the updated line (text-14, w-1/3) and the form line (text-20, w-1/2). One Card with a title bar and 4 rows, each a 28px circle, a text-20 bar (w-1/2) and a text-28 bar (w-2/3). `sr-only` `role="status"`: "Loading today's plan…". Pulses only under `motion-safe`. |
| Fresh | Updated line | "Updated 28 Sept, 05:03" |
| Stale (> 26 h) | Updated line, `--warning` + triangle | "Stale: last updated 26 Sept, 05:03. Form and the strength plan may be out of date." |
| Unknown `computed_at` | Updated line, `--warning` + triangle | "Update time unknown, so form and the strength plan may be out of date." |
| No `daily_load` rows | Form line (text-14 muted); updated line hidden | "Form not computed yet. The daily job fills it at about 05:00." |
| Zone null | Badge | `StatusBadge` neutral "Zone not computed" (as /load) |
| Form read fails | Form line, `--warning` + triangle | "Couldn't load form (TSB)." followed by the link "Try again" (href `/`, `min-h-11`). The plan still renders. When the plan also failed, drop this link: the ErrorState's "Try again" retries both. |
| Plan read fails (strength or planned sessions) | In place of all day cards | `ErrorState`: title "Couldn't load today's plan", `what` from `describeDataError` (as /load), retry href `/`. The form line still renders. **Never show "Rest day" when a plan source failed.** |

Every "Try again" (Today and `/load`) is an in-app navigation (`next/link`, `prefetch={false}`), never a full reload, so the ticks survive a retry. Only a real browser reload clears them.
| Empty (no session today) | Rest card | See §3 |
| Nothing ahead | Rest card | See §3 |
| Offline | – | No special UI. Once the page has loaded, ticking needs no network. |

Other copy: nav "Today" / "Training load"; progress "N of M done" / "All M done"; footnote "Ticks clear when the page reloads. Log kg in the sheet."; week-1 note "Week 1 of the block: no kg from last week to compare yet."; a missing reference reads "Nothing logged last week".

## 6. Flow
- **Gym:** open the home-screen bookmark (`/`), read the first row, lift, then tap the row to tick it. Tap again to undo. No navigation needed.
- **Check load:** tap "Training load", then "Today". That's 2 taps, and the ticks are kept.
- **Rest day:** open the app to see "Rest day" and the next session. No taps.

## 7. Acceptance criteria (for `tester`)
1. `/` shows Today on every date. `/load` shows the previous dashboard with the same content, plus the nav. `/load?week=2026-W39` switches weeks. "Back to this week" and the error retry go to `/load`.
2. Both screens show a nav with the links "Today" and "Training load". The current link has `aria-current="page"`, is semibold and has the bottom bar. Both links are ≥ 44px tall. The nav is not sticky and is visible during loading.
3. The h1 reads "Today · " plus `formatDay` of today's Europe/Copenhagen date.
4. The form line shows "Form (TSB)", a signed whole number, "TSS/day" and a zone badge with text. It fits on one line at 390px for every zone label when the row is today's. When the row is from an earlier date, it shows that date.
5. The strength list has one `<li>` per sheet row, in sheet order (11 on 2026-09-28), and the progress reads "0 of 11 done".
6. The visible sets, reps and load strings match the data exactly, e.g. "2 × 5" and "-10%".
7. A run of rows with the same name shows the name once. Every checkbox's accessible name starts with the exercise name.
8. In week 1 the week-1 note shows and no row has a reference line. In week ≥ 2 every row has a "Last week …" line. Null reads "Nothing logged last week", and "0 kg" never appears.
9. A tap anywhere on a row, name included, toggles it within 100ms and updates the progress. Tapping again unticks. Space toggles it from the keyboard. The focus ring surrounds the whole row.
10. Ticks survive Today → Training load → Today through the nav. A reload clears them. Ticking sends no network request.
11. The ride card shows the name, "Total h:mm h", "Targets from FTP 250 W" and the steps in order. A repeat group shows "Repeat 4 times" with its steps indented. Watts are whole numbers with "W", and ranges read like "225–250 W".
12. On a day with both, the ride card comes first. At 390 × 844, the whole ride card and the Strength card title are visible without scrolling.
13. At 390 × 844 with the 2026-09-28 data, the Squat and Bænk runs (6 rows) are fully visible without scrolling.
14. A rest day shows the "Rest day" card with the next session's date and what it is. Tomorrow reads "Tomorrow · …". With nothing in the next 28 days, the EmptyState copy shows.
15. A plan read failure shows the "Couldn't load today's plan" ErrorState with "Try again", and never "Rest day". A form read failure shows "Couldn't load form (TSB)." while the plan still renders.
16. Data older than 26 h shows the stale sentence in `--warning`, with its icon.
17. Computed font sizes: 28px for the prescription and watts, 20px for names, references, step labels and durations. No session text is below 14px.
18. At 200% text on a 390px viewport there is no horizontal scroll. The prescription wraps within its column and the check stays in its column.
19. In both themes, text contrast is ≥ 4.5:1, and the check ring and repeat rule are ≥ 3:1.
20. On `/load` with the nav added, the chart card is still fully visible at 390 × 844.
