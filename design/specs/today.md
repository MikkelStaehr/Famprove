# Spec – Today (`/`, "I dag")

Owner: design-lead · 2026-09-28, session numbering 2026-09-30 (§3a, §8), **Spurt applied 2026-09-30** (the former DESIGN.md "Overrides" are folded in here) · for `ui`. Contract: `DESIGN.md` Part A (guardrails) and Part B (Spurt: tokens, type, NÆSTE slab, segmented progress, ZoneBar). `/load` has its own spec-lite: `design/specs/load.md`.

**Language:** all UI copy is Danish (§5a). Never translate exercise names, sheet cells, block tab names, activity/ride names, step labels from `planned_sessions`, Python `problem` strings, or TSS / W / FTP / CTL / ATL / TSB. Formats: dates `ons. 30. sep.`, times `kl. 05.03`, decimal comma (`62,5 kg`), U+2212 minus, en-dash ranges without spaces (`225–250 W`). `<html lang="da">`.

## 1. Question and primary action
- **Question:** "What am I doing in this session, and how hard?"
- **Primary action (strength only):** tick a sheet row as done. The only interaction apart from the nav. Ride and rest days are a reference, no action.
- **Cut:** logging kg, charts, CTL/ATL, history, muscle-group `type`, ticking ride steps. The compact zone bar is the only load element.

## 2. Routes and nav
- `/` renders Today on every date. "Today" = the Europe/Copenhagen date at request time, not the latest `daily_load` date.
- `/load` is the dashboard (`design/specs/load.md`); week links `/load?week=…`, "Tilbage til denne uge" and its retry go to `/load`; its skeleton is `app/load/loading.tsx`.
- **`ScreenNav`** in the root layout (visible during loading and errors), in a `<header>` before `<main>`, 12px from the top, page gutter 12px.
  - `<nav aria-label="Hovedmenu">`, two links: **I dag** → `/`, **Belastning** → `/load`.
  - Part B look: a `rounded-pill` `--track` track; tabs `text-16` 600, `min-h-11`, `rounded-pill`. Current tab: `aria-current="page"`, `--text` fill, `--bg` text, weight 700 (fill + weight, never colour alone; not `--slab`).
  - **Not sticky.** In the gym the vertical space goes to the session.
- Document titles: `I dag · Belastning` on `/`, `Belastning` on `/load`.

## 3. Layout top to bottom (390px)

### Header (every day)
1. `h1`: "I dag" in `text-44` display (Condensed 800 italic; uppercase via CSS, so the source text stays "I dag"), then the date `ons. 30. sep.` in `text-16` Barlow 500 `--text-muted` on the same baseline, 12px after it. An `sr-only` ", " between them.
2. Updated line (`UpdatedLine`), 4px under the title. Copy in §5a.
3. **Compact ZoneBar** (DESIGN.md Part B › Zone bar, compact size), 12px under the updated line. Value `text-24` in the flag, zone name in the flag, bands, threshold numbers. Replaces the old "Form (TSB) +N TSS/dag [badge]" line.
   - **Latest row is not today:** the date goes at the **right end of the label line**, right-aligned, `text-14` 600 `--text` (not muted, so an old number is noticed): `fra søn. 27. sep.`. The label line is `flex-wrap`, so at 200% text it drops under "FORM (TSB) TSS/dag". The sr sentence ends "Tallet er fra søndag 27. september."
   - Gap to the first card: `main` stack gap 16px.

### Content order
Ride card(s) planned for today, then the Strength card (always; with N = 0 it shows state (d)), then the Rest card (only when no ride today **and** k ≥ N). The ride goes first because it is short; strength-first would hide it ~1000px down.

### Strength card (`Card id="strength"`)
- **Title:** "Styrke", `text-32` display 800 italic, uppercase via CSS.
- **Head (action slot):** "**0** af 11 udført": count `text-24` display, rest `text-16` 600 tabular. All ticked: "Alle 11 udført". Not a live region (each checkbox announces itself).
- **Segmented progress** (Part B) 12px under the head: one 8px segment per sheet row; the first *k* are `--slab`, the rest `--track`. `aria-hidden`. The next segment fills in 120ms.
- **Done list** (16px under the progress) and **session line** (12px): §3a.
- **Identity line** (`text-16`): `{block tab name as written} · uge {n}`, e.g. "Program - blok 12 (offseason) · uge 1".
- **Week-1 note** (week 1 only, `text-14` muted): §5a.
- **List** `<ol aria-label="Øvelser">`, 12px under, one `<li>` per sheet row in sheet order. Consecutive rows with the same trimmed name form a run.
  - The name (`text-20` Barlow 700) shows on the first row of a run only; continuation rows carry it `sr-only`. **Exception: the NÆSTE row always shows the name**, even inside a run.
  - A 1px `--border` divider between runs only; the slab hides the dividers it touches.
- **Row:** a `<label>` covering the whole row, wrapping a native checkbox. Min-height 44px, padding 8px 4px, grid `28px 1fr`, 12px gap. The check aligns to the prescription line (bottom, 4px up).
  - **Prescription line** (`flex-wrap`, gap-x 16px, gap-y 4px): `{sets} × {reps}` and the prescribed load as written, both **`text-32` Barlow Condensed 700 tabular** (e.g. `2 × 8 - 12`  `RPE 5 - 6`, `2 × 5`  `-10%`). One of sets/reps alone gets its word ("10 - 15 reps", "2 sæt"). No load cell = nothing shown.
  - **Reference line** (week ≥ 2, `text-20`): "Sidste uge" in `--text-muted` + value in 500 `--text` ("100 kg", "62,5 kg", "kropsvægt", "kropsvægt + 10 kg"). Null: "Intet logget sidste uge", all muted. Never "0 kg". Week 1: no line.
  - **Accessible name:** "Squat, 1 sæt af 3 reps ved RPE 5, sidste uge 100 kg". SR-only rewrites: " - " → " til " ("8 til 12 reps", "RPE 6 til 7"). Visible text always as written. The NÆSTE row appends ", næste" (the visible tag is `aria-hidden`, an `sr-only` ", næste" goes last), so every name still starts with the exercise name.
- **NÆSTE slab** (Part B): the first unticked row in document order; none when all are ticked. `--slab` fill, `--on-slab` text including prescriptions, check ring 3px `--slab-mark`. Bleeds 8px each side (margin-inline −8px, padding 12px), 8px margin-block, `rounded-control`. Tag "Næste" (uppercase via CSS, `text-14` 700 +0.08em, `--slab-mark` fill, `--slab` text, padding 2px 8px, `rounded-mark`) right-aligned on the name line.
- **Check:** 28px circle, 2.5px ring.
  - Unticked: `--text-muted` ring.
  - Ticked: filled **`--slab`** with a **`--slab-mark`** ✓ (inline SVG, 2.5px stroke). The ✓ shape carries the meaning. Row text turns `--text-muted`; a run's name only when every row of the run is ticked. No strike-through, no reordering, rows never move.
  - Tap again unticks (undo).
  - Focus: 3px `--focus` outline, 3px offset, around the whole row (`label:has(:focus-visible)`), following `rounded-control`.
- **Motion** (Part B): the check scales to 0.9 on `:active` and fills in 120ms; on tick, the slab colour cross-fades off the row and onto the next unticked row in 180ms (colour only). `ease-out`. Under `prefers-reduced-motion: reduce` all 0ms and no scale. Nothing else moves: not numbers, not the zone marker.
- **Footnote** after the list (`text-14` muted): §5a.
- **Tick state:** in memory only (client provider in the root layout, keyed by date + block + sheet row). Survives in-app navigation, clears on reload. Controlled checkboxes. No storage, cookies or requests; works offline.

### Ride card (`Card id="ride-{n}"`, one per planned session, in table order)
- **Title:** "Cykel" (`text-32` display, uppercase via CSS). **Action:** "I alt 1:15 t" (`text-16` 600 tabular).
- **Name** `text-20` 700, as written ("Zwift – Over-unders 4×8"). Null name: "Tur uden navn". **Notes** `text-16`. **FTP line** `text-14` muted: "Mål ud fra FTP 250 W".
- **Steps** `<ol aria-label="Trin">`, 1px `--border` dividers, `py-3`:
  - Left: label as stored (`text-20` 700), duration below (`text-20` 400). No label: duration alone in 700.
  - Right, right-aligned: watts **`text-32` Condensed 700 tabular** with " W" the same size ("263 W", "225–250 W"); % FTP below in `text-16` muted ("105% FTP", "90–100% FTP", as intervals.icu writes it).
  - Repeat group: header "Gentag 4 gange" (`text-16` 600), steps indented 16px behind a 2px `--chart-mark` rule. Durations are per repetition.
- Formats: whole W and %, "8 min", "30 s", "1 min 30 s", "Gentag 1 gang".
- No FTP: right column % FTP in `text-32` (" FTP" in `text-20`); FTP line per §5a. Unreadable steps: no total, FTP line or steps; `WarningLine` per §5a. No steps: `EmptyState` per §5a.

### Rest card (`Card id="rest"`)
Depends on rides and strength *activities* only, never strength dates.
- **Title:** "Hviledag", or "Færdig for i dag" when a strength activity was logged today (`text-32` display). Body `text-20`: "Intet planlagt i dag." / "Ikke mere planlagt i dag."
- "Næste tur" (`text-14` 700 uppercase muted), date `text-20` 700 ("I morgen · tor. 1. okt." or "søn. 4. okt."), name `text-16`.
- None within 28 days: `EmptyState` per §5a.

## 3a. Strength sessions per ISO week
Rule: the sheet defines sessions 1..N per ISO week (Mon–Sun). The n-th strength activity from intervals.icu in the week **is** session n. Undone sessions have no date. N = sessions planned, k = strength activities so far. Matching happens in the daily run (≈ 05.00), so an activity logged today moves Today to k + 1 after the next run.

**Done list** (only when k ≥ 1; `<ul aria-label="Udført i denne uge">`, `text-16`, gap 4px, 1px `--border` divider below). Each line starts with a **20px `--slab` circle with a `--slab-mark` ✓** (same language as a ticked check: done = slab; no `--positive` on Today), in start-time order:
- `Session 1 udført i dag · Styrke 1:12:48` (activity name as logged, moving time h:mm:ss)
- `Session 1 udført tir. 29. sep. · Styrke 1:12:48`
- n > N: `Ekstra session udført i dag · Styrke 0:45:10 · ikke i programmet`
- Null/blank name or null moving time: drop it and its space; both missing drops the whole "· name time" segment. Never a placeholder.

**Session line** (`text-20` 700): `Session 2 af 3 i denne uge`. No date, no weekday.

| State | Strength card body (after the done list) | Head |
|---|---|---|
| (a) k < N | Session line, identity line, week-1 note, exercises, footnote | "0 af 11 udført" + progress |
| (b) done today, k < N | Done line(s) with "i dag", then (a) | as (a) |
| (c) k ≥ N > 0 | `text-20` 700 "Alle 3 sessioner er udført i denne uge." (N = 1: "Ugens session er udført.") + `text-16` "Næste uges session 1 vises her fra man. 5. okt." | empty, no progress |
| (d) N = 0 | `text-20` 700 "Intet styrkeprogram i denne uge." + `text-16` "Trænerens ark har intet for uge 40 endnu. Det vises her, når det er tilføjet." | empty |
| (e) k > N | Extra line(s) in the done list, then (c) or (d) | empty |

## 4. Above the fold at 390 × 844
Header (Part B spacing): nav ends ≈ y 56, title 16px below ends ≈ 116, updated line ≈ 140, compact ZoneBar (≈ 96px) ends ≈ 248, **first card starts ≈ y 264** (was 191: +73px, tech-lead's ~77 confirmed).
Strength card, week 1, k = 0: head + progress end ≈ 340, list starts ≈ 442. Rows: NÆSTE row ≈ 103px incl. its 8px margins, other first-of-run rows ≈ 79px, continuation rows ≈ 51px, +28px each with a reference line.

| Day | Fully visible without scrolling at 390 × 844 | Cut |
|---|---|---|
| Strength week 1, k = 0 (blok 12, 11 rows) | Squat run (ends ≈ 647); Bænk run only just (≈ 830), not guaranteed | From Bænk/Zercher on |
| Strength week 1, k = 1 | Done line, session line, Squat run (ends ≈ 689) | Bænk and later |
| Strength week ≥ 2 (references) | Squat run (≈ 731 at k = 0, ≈ 773 at k = 1) | The rest |
| Ride (≤ 5 steps, ≈ 548px) | Whole card | – |
| Ride + strength | Whole ride card; the Strength card's top edge peeks below it | STYRKE title and rows |
| Rest | Everything | – |

**Guarantee:** at 390 × 844 the first run is fully visible for k ≤ 1. In a real iPhone Safari viewport (≈ 390 × 660) the **NÆSTE row** is fully visible for k ≤ 1 (ends ≈ 545 / 587). If a build misses these, cut vertical space in this order: title→date gap, then the zone bar's threshold-number gap; never shrink the prescriptions.

## 5. States
| State | Where | Treatment |
|---|---|---|
| Loading | `app/loading.tsx` (nav is real) | h1 "I dag" real, a `text-16` bar for the date. Updated line: `text-14` bar w-1/3. **ZoneBar skeleton:** the label line as real text ("FORM (TSB)" · "TSS/dag"), then 38px empty (flag + notch height, so nothing shifts), then the 5 bands in `--track` at their exact spans with the 4px gaps, then the threshold numbers as real `--text-muted` text. No flag, no marker, no outline; total height = the loaded bar. One Card: a `text-32` title bar, an 8px progress bar, 4 rows each with a 28px `--track` circle, a `text-20` bar (w-1/2) and a `text-32` bar (w-2/3). `sr-only role="status"`. Pulse only under `motion-safe`. |
| Fresh / stale / unknown | Updated line | Copy §5a. Stale and unknown in `--warning` + triangle icon. The zone bar is unchanged when stale (no greying). |
| No `daily_load` rows | ZoneBar no-TSB state; updated line hidden | Bands without marker or outline; `text-16` muted sentence in place of the flag. |
| Zone null | ZoneBar | Flag shows the value only; `text-14` muted line under the numbers; no active outline. |
| Out of range (< −40 or > 30) | ZoneBar | Marker pinned to the bar end as an 8px outward chevron; flag shows the true value. |
| Form read fails | ZoneBar slot, `--warning` + triangle | Sentence + "Prøv igen" link (href `/`, `min-h-11`). Plan still renders. When the plan also failed, drop the link (the ErrorState's retry covers both). |
| Plan read fails | In place of all day cards | `ErrorState`, title + `what` from `describeDataError`, retry href `/`. **Never "Hviledag" when a plan source failed.** |
| Empty / nothing ahead | Rest card | §3 |
| Offline | – | No special UI; ticking needs no network. |

Every "Prøv igen" is an in-app navigation (`next/link`, `prefetch={false}`), so ticks survive a retry.

## 5a. Danish copy (Today + shared chrome)
| Key | Danish (exact) |
|---|---|
| Nav label / links | `Hovedmenu` · `I dag` · `Belastning` |
| h1 | `I dag` + `ons. 30. sep.` |
| Updated, fresh | `Opdateret 30. sep. kl. 05.03` |
| Updated, stale (Today) | `Forældet: sidst opdateret 28. sep. kl. 05.03. Form og styrkeprogrammet kan være forældet.` |
| Updated, unknown (Today) | `Opdateringstidspunkt ukendt, så form og styrkeprogrammet kan være forældet.` |
| ZoneBar label line | `FORM (TSB)` · `TSS/dag` · (not today) `fra søn. 27. sep.` |
| Zone names | `Høj risiko` · `Optimal` · `Gråzone` · `Frisk` · `Overgang` |
| No TSB | `Form er ikke beregnet endnu. Det daglige job beregner den omkring kl. 05.00.` |
| Zone null | `Zone ikke beregnet.` |
| Form read fails | `Kunne ikke hente form (TSB).` + `Prøv igen` |
| Loading (sr) | `Henter dagens plan …` |
| ErrorState title (plan) | `Kunne ikke hente dagens plan` |
| `describeDataError` | `Serveren mangler sine databaseindstillinger.` · `Læsning af {table} fra databasen mislykkedes.` · `Databasen returnerede data i et uventet format.` |
| Retry | `Prøv igen` |
| Strength | `Styrke` · `0 af 11 udført` · `Alle 11 udført` · `Session 2 af 3 i denne uge` · `… · uge 1` · `Næste` |
| Done list | `Udført i denne uge` (aria) · `Session 1 udført i dag` · `Session 1 udført tir. 29. sep.` · `Ekstra session udført i dag` · `ikke i programmet` |
| Week-1 note | `Uge 1 i blokken: ingen kg fra sidste uge at sammenligne med endnu.` |
| Reference | `Sidste uge 100 kg` · `kropsvægt` · `kropsvægt + 10 kg` · `Intet logget sidste uge` |
| Counts | `10 - 15 reps` · `2 sæt` · `1 sæt` |
| Footnote | `Flueben forsvinder, når siden genindlæses. Log kg i arket.` |
| States (c)/(d) | see §3a table |
| Ride | `Cykel` · `I alt 1:15 t` · `Mål ud fra FTP 250 W` · `Trin` (aria) · `Gentag 4 gange` / `Gentag 1 gang` · `Tur uden navn` |
| Ride gaps | `Ingen FTP fra intervals.icu, så målene står kun i % FTP.` · `Kunne ikke læse trinene, så der vises ingen mål. Ret dem i planned_sessions ({problem}).` · `Der er ikke indtastet trin for denne tur.` |
| Rest | `Hviledag` · `Færdig for i dag` · `Intet planlagt i dag.` · `Ikke mere planlagt i dag.` · `Næste tur` · `I morgen · tor. 1. okt.` · `Ingen tur planlagt de næste 28 dage. Ture kommer fra planned_sessions.` |
| Row sr name | `Squat, 1 sæt af 3 reps ved RPE 5, sidste uge 100 kg` (+ `, næste`); `8 til 12 reps`, `RPE 6 til 7` |

**ZoneBar sr sentence** (one `sr-only` sentence; numbers written out as words for sign, digits for size):
| Case | Sentence |
|---|---|
| Høj risiko | `Form minus 34 TSS per dag: høj risiko, under minus 30.` |
| Optimal | `Form minus 12 TSS per dag: optimal, som går fra minus 30 til minus 10.` |
| Gråzone | `Form plus 4 TSS per dag: gråzone, som går fra minus 10 til 5.` (0 reads `Form 0 TSS per dag: …`) |
| Frisk | `Form plus 11 TSS per dag: frisk, som går fra 5 til 20.` |
| Overgang | `Form plus 24 TSS per dag: overgang, over 20.` |
| No zone | `Form plus 4 TSS per dag. Zone ikke beregnet.` |
| Out of range | the zone sentence + ` Uden for skalaen, som går fra minus 40 til 30.` |
| Not today | any of the above + ` Tallet er fra søndag 27. september.` |

## 6. Flow
- **Gym:** open `/`, read the NÆSTE row, lift, tap the row. Tap again to undo.
- **Check load:** tap "Belastning", then "I dag": 2 taps, ticks kept.
- **Strength day:** the next session (k + 1) is already there. **Rest day:** "Hviledag" and the next ride, no taps.

## 7. Acceptance criteria (for `tester`)
1. `/` shows Today on every date; `/load` the dashboard with the nav; `/load?week=2026-W39` switches weeks; "Tilbage til denne uge" and the load retry go to `/load`.
2. Both screens show `nav[aria-label="Hovedmenu"]` with "I dag" and "Belastning". The current link has `aria-current="page"`, weight 700 and a `--text` fill. Both links ≥ 44px tall. Not sticky; visible during loading.
3. The h1's text is "I dag" + today's Europe/Copenhagen date as `ons. 30. sep.`; it renders uppercase at 44px.
4. The compact ZoneBar shows "FORM (TSB)", "TSS/dag", a flag with the signed whole value and the zone name in Danish, five bands, the thresholds −30/−10/5/20, and a 2px outline on the active band only. The active zone comes from `form_zone`. When the row is older than today, "fra {date}" shows on the label line. The sr sentence matches §5a.
5. The strength list has one `<li>` per sheet row of session k + 1, in sheet order; the head reads "0 af {rows} udført" and the progress has {rows} segments. No date or weekday for that session.
6. Visible sets, reps and load strings match the sheet exactly ("2 × 5", "-10%").
7. A run shows its name once, except the NÆSTE row, which always shows it. Every checkbox's accessible name starts with the exercise name; the NÆSTE row's ends with ", næste".
8. Week 1: the week-1 note, no reference lines. Week ≥ 2: every row has "Sidste uge …"; null reads "Intet logget sidste uge"; "0 kg" never appears.
9. A tap anywhere on a row toggles it within 100ms and updates the count and progress; tapping again unticks; Space toggles from the keyboard. The focus outline (3px, `--focus`) surrounds the whole row.
10. After a tick, the NÆSTE slab sits on the next unticked row; ticked checks are `--slab` with a ✓. With every row ticked there is no slab and the head reads "Alle {rows} udført".
11. Ticks survive I dag → Belastning → I dag; a reload clears them; ticking sends no request.
12. Ride card: name, "I alt h:mm t", "Mål ud fra FTP 250 W", steps in order, "Gentag 4 gange" with indented steps, whole watts with "W", ranges like "225–250 W". On a day with both, the ride card comes first and is fully visible at 390 × 844.
13. At 390 × 844, blok 12 week 1, 11 rows: the Squat run is fully visible for k = 0 and k = 1. At 390 × 660 the NÆSTE row is fully visible for k ≤ 1.
14. Rest card only with no ride today and k ≥ N; lists the next ride ("I morgen · …" for tomorrow); none in 28 days shows the EmptyState; title "Færdig for i dag" when a strength activity was logged today.
15. A plan read failure shows "Kunne ikke hente dagens plan" with "Prøv igen", never "Hviledag". A form read failure shows "Kunne ikke hente form (TSB)." while the plan renders.
16. Data older than 26 h shows the stale sentence in `--warning` with its icon; the zone bar is not greyed.
17. Computed sizes: 32px for prescriptions and watts, 20px for names, references, step labels, durations; nothing in a session card below 14px.
18. At 200% text on 390px: no horizontal scroll; the prescription wraps in its column; the zone-bar label line wraps.
19. Both themes: text ≥ 4.5:1; check ring, repeat rule and zone marker ≥ 3:1.
20. With `prefers-reduced-motion: reduce`, ticking changes state with no transition and no press scale.
21. Wed 30 Sept 2026 (week 40, N = 3, Styrke Tue 29 Sept, no ride): "Session 1 udført tir. 29. sep. · Styrke 1:12:48" (slab circle with ✓), then "Session 2 af 3 i denne uge" and session 2's exercises; no Rest card.
22. A strength activity logged today shows "Session n udført i dag · {name} {h:mm:ss}" above the next session or the all-done text.
23. k ≥ N > 0: "Alle N sessioner er udført i denne uge." + "Næste uges session 1 vises her fra man. {date}.", no list, no progress. N = 0: "Intet styrkeprogram i denne uge." Beyond N: "Ekstra session udført … · ikke i programmet".
24. `/load` week table per §8.
25. No English UI string remains on `/` (exercise names, sheet cells, activity/ride names and step labels excepted).

## 8. `/load` week table: strength by activity
Structure and look unchanged (DESIGN.md › Week card). Only what fills a day changes:
- Strength sits on the date of its matched intervals.icu activity; one strength section per activity, in start-time order.
- **Matched:** line 1 `text-16` 600 `Session 2 · Program - blok 12 (offseason) · uge 1`; line 2 `text-14` muted `Styrke 1:12:48 · 86 TSS`; then the exercises.
- **Unmatched (n > N or N = 0):** line 1 `Styrke · ikke i programmet`; line 2 `Styrke 0:45:10 · 0 TSS`; no exercise list. The strength column shows "0" (a real zero).
- **Rest:** a day with neither ride nor strength activity is the plain "Hvile" row.
- Planned-but-undone sessions are not shown in the week table.
(Danish copy for the week card: `design/specs/load.md` §6, deferrable.)
