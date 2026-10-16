# Spec-lite – Review round (user, 2026-10-14)

Changes to `/load` and `/` after the Ember reset. Everything not named here stays as `reset-belastning.md`, `reset-traening.md`, `load.md` and `traening.md`. Where they disagree, this spec wins. **No new components:** the one `WeekCard` serves both screens (`WeekDays` is deleted); the curve, grid and bars keep their components and only change marks and interaction. Numbering follows the user's review points.

## 1. Belastning order and the week card's total
**Order at 390:** header → form card → tiles row → **week card** → fitness curve → training-day grid → TSS pr. dag. Above the fold at 390 × 844: the form card, the tiles and the top of the week card.
**Desktop (lg, 3 × 384):** column 1 holds the form card, the tiles and the week card, in that order. The fitness curve spans columns 2–3, rows 1–3. Row 4 holds the grid (column 1) and the bars (columns 2–3). The DOM order stays the 390 order.
**`I alt` row**, value column, Geist Mono `text-14`, tabular:
- **Current week with a planned value** (`weekly_plan.planned_tss` not null): `72 / ~257`. `72` (`done_tss`) is 500 `--text`; ` / ~257` is 400 `--text-muted`. The `~` means it is an estimate (the prognose: the coach's plan plus the typical cycling week). Spoken: `72 TSS udført af cirka 257 planlagt`.
- **Past weeks, and any week whose `planned_tss` is null:** done only, `72`. Never `/ ~0`, never `/ ~–`.
- Whole numbers. The figures are SQL's. The web only formats them and never adds them up.
**Plan rows:** a planned session with a date shows its day (`Tor`). An undated session comes after all dated rows, with `–` (en dash, U+2013, spoken `uden dato`) in the day column, a muted icon and `plan`. This replaces the `—` in `reset-belastning.md` §6 and `reset-traening.md` §2.6.
Acceptance:
- 1a. At 390 the cards come in the order above. At 1280 the placement is as above.
- 1b. On the current week (real data) `I alt` reads `<done> / ~<planned>` with the planned part muted. On `?week=` for a past week it reads the done figure only. A search of the DOM finds no `/ ~0`.
- 1c. Undated plan rows come last with `–` (U+2013), not `—`. A dated plan row shows its weekday.

## 7. One WeekCard on both screens
`WeekCard` gets one prop, `variant: "full" | "compact"`. **full** (/load): as `reset-belastning.md` §6, with `<details>` day rows and the switcher. **compact** (Træning):
- Same header (`Uge 42` + `12.–18. okt.`), same rows, same `I alt` row and the same week source (`weekly_load` + `weekly_plan` + `lib/week-plan.ts`).
- Rows are plain `ListRow`s with no `<details>` and no chevron. They are not interactive, so their minimum height is **36px** (the 44px target rule does not apply). Padding 7px 0, single line, no activity-words second line.
- No switcher and no `Tilbage til denne uge`. It always shows the current ISO week.
- On Træning it is the **first card under the header**. Then the "I dag" InverseCard, the form card, the ride card(s) and the Sæt card. The old Uge card at the bottom, its `16 sæt ✓` values and its week notes (`Alle 3 sessioner …`, `Intet styrkeprogram …`) are gone. Rows show TSS like /load. `weekSentence` stays as sr-only text.
- Desktop Træning: the right column holds the week card, then the form card, then the ride card(s). The left column holds the InverseCard, then the Sæt card.

**Fold check (390 × 844):** I measured this on the current screenshots, not on a live render. Header to first card = 88px. InverseCard = 224px (summary on 2 lines). Card gap = 12. `--bottom-bar` = 72px plus the safe area: 106 on an iPhone (34), 72 headless. The InverseCard's bottom must therefore stay ≤ 738 (iPhone) or ≤ 772 (headless), which leaves at most **414px** for the week card (iPhone).
| Week card | Rows (incl. `I alt`) | Height at 44px rows | Height at 36px rows | Fits (~~iPhone~~ phone; **Superseded 2026-10-15 (user):** the phone is Android Chrome.)? |
|---|---|---|---|---|
| Wed 14 Oct, real data and `midsession` | 5 | 302 | 262 | yes, 112 / 152px spare |
| Sunday, all 7 days + 1 undated | 9 | 478 | 406 | only at 36px (8px spare) |
Hence the compact variant uses 36px rows. With them the button fits on every day. If the render still overflows (for example the summary wraps to 3 lines on a Sunday), fall back to this order: InverseCard first, week card second. That is the option to bring to the user. Do not cut rows.
Acceptance:
- 7a. `web/src/components/WeekDays.tsx` no longer exists. `/load` and `/` both render `WeekCard`.
- 7b. Compact on `/`: no `<details>`, no switcher, rows ≥ 36px, `I alt` as §1.
- 7c. The 390 × 844 screenshots below must show the whole Begynd/Fortsæt træning button above the tab bar, with its bottom ≤ 844 − `--bottom-bar`. Shoot them at the default date, with `DEV_FIXTURE=midsession`, and with `DEV_TODAY=2026-10-18` (a Sunday). The tester reports the measured gap.

## 2. Fitness curve: smooth through weekly anchors
- **Anchors:** in the visible range, the first measured day, each ISO-week Sunday's CTL, and the last measured day. Prognose anchors are the last measured day (shared, so the line is continuous), each prognose Sunday, and the last prognose day shown. The band uses the same prognose anchors. Picking points from Python's series counts as drawing, not as a calculation.
- **Line:** a monotone cubic through the anchors (Recharts `type="monotone"`): 2px `--text` for measured, the prognose stroke unchanged (1.5px `--text-muted`, 3 4).
- **Today:** the existing ring (r 5, `--bg` fill, 2px `--text`) on the last measured anchor, where solid turns dotted. The legend adds `○ i dag`, or `○ seneste` when the last measured day is not today (stale).
- **Selected day:** a 1px `--text` vertical hairline, full plot height, at that day's x. No dot and no ring on the line. The exact daily values are in the readout (§3).
Acceptance:
- 2a. In 12U the measured line has no sawtooth: it bends only at Sundays and at the window ends.
- 2b. Prognose still dotted, band (`band`) still drawn.
- 2c. One ring at the last measured anchor, and the legend names it. A selected day shows only a hairline.

## 3. /load charts: values only on selection
This applies to the fitness curve, the training-day grid and the TSS bars. ~~Analyse is unchanged.~~ Reversed 2026-10-14: Analyse follows the same rule (`answers-round.md` §2); 3d is void.
- **At rest:** no values, no readout row and no reserved height. No `Seneste · …` row any more.
- **No hover anything:** no tooltip and no hover-following marker. Mouse hover changes only the cursor (`pointer`).
- **Select:** a tap, a click, a touch drag (scrub, `touch-action: pan-y` kept), or ←/→ (and ↑/↓ on the grid) once the plot has focus. The first arrow press selects the latest day. The selection shows **one readout** directly under that chart's x labels or legend: the existing readout layout (line 1 date, line 2 cells, facts), wrapping as needed, `aria-live="polite"`. It appears without animation, and the content below it moves down.
- **Close:** tap or click the selected day again, press Esc, or tap or click outside that card's plot. Focus stays on the plot.
Acceptance:
- 3a. At rest, none of the three /load charts shows a value or a readout, and no empty space where one goes.
- 3b. Hovering with a mouse shows nothing. Clicking shows the readout under that chart only.
- 3c. Tapping the same day again, Esc, and a tap outside each close it. Keyboard ←/→ selects, and Esc clears.
- 3d. Analyse › Cykel / Styrke still show their rest readout and tooltip.

## 5. No today line on the fitness curve
No `--today` anywhere on the curve: the line and the `I DAG` caption are removed. The x labels are the window start, the month starts and the window end. The grid's orange today cell and the week card's `I DAG` stay.
Acceptance:
- 5a. The curve's SVG contains no `--today` colour and no `I DAG` text. Orange on /load appears only on the grid's today cell and the week card's `I DAG`.

## 6. Training-day grid: week numbers and seven day labels
- **Week numbers** above each column: the ISO week (`31` … `42`), Geist Mono **10px** (`text-10`, user override [A9]), `--text-muted`, centred over the 20px cell, 6px above the first row. The current week's number is in `--text` 500. They are `aria-hidden`, because the hidden table has the dates.
- **Day labels:** all seven rows, `M T O T F L S`, mono 11 muted, as now.
- Month names stay below. Orange is only on today's cell.
Acceptance:
- 6a. 12 numbers above the 12 columns, ending with the current week in `--text`, the others muted, 10px, each centred on its column.
- 6b. Seven day labels M T O T F L S.

## 9. Træning: every exercise starts collapsed
- **Default:** all exercises collapsed, on load and after a reload. This replaces "the exercise with the next open set starts expanded". Expanding one leaves the others as they are.
- **Collapsed row** (the existing header `<button>`, ≥ 44px, `aria-expanded`, `aria-controls`): the name (Geist `text-16`/500), one dot per set (the existing dots: filled = done, empty ring = open, ring with a stroke = skipped), and the existing 16px chevron as the disclosure cue. No prescription and no kg.
- **Expanded:** the prescription line, `FORSLAG` (only when there is a suggestion), `SIDSTE UGE`, then the set rows, as `reset-traening.md` §2.5.
- Accessible name: `Dødløft, 0 af 4 sæt udført, 1 sprunget over` (the last part only when > 0), plus the `aria-expanded` state.
Acceptance:
- 9a. On a fresh load (real data and `midsession`) every exercise is collapsed and shows only name, dots and chevron.
- 9b. Tap or Enter expands it to prescription, suggestion (when present), SIDSTE UGE and set rows. `aria-expanded` flips.
- 9c. Each collapsed row is ≥ 44px. The dots show done, open and skipped by shape.

## 8. No "Intet forslag"
When there is no suggestion, nothing about a suggestion is shown or spoken. On Træning the `FORSLAG` pair is omitted, and the set rows' accessible name drops `, forslag …`. On Fokus with no suggestion, the kg block shows `SIDSTE UGE`. When neither exists, there is no kg block. The reason strings (`Intet forslag til %-sæt`, `… ingen e1RM endnu`, `… til denne øvelse`) are retired. `Intet logget sidste uge` stays.
Acceptance:
- 8a. `grep -ri "intet forslag" web/src` returns nothing. Neither the screens (real data, `midsession`) nor their accessibility trees contain it.

## States
Unchanged per screen. The compact week card's loading state is a skeleton of 5 rows. On error it shows the existing `ErrorState` inside the card, and the InverseCard is unaffected. `empty`: the header and rows say `Hvile` / no rows, and `I alt` shows `–`.
