# Spec – Fokus pause screen rebuild (2026-10-13)

> **Superseded in part (bookkeeping 2026-10-16):** `Til næste sæt` and the separate rest view by `fokus-flow.md` §1 (2026-10-15: the pause view is the next set); the `Forslag` / `FORSLAG` label by `fokus-kg.md` (today's kg under `I DAG`); a text-link Spring over by `button-type.md` B4 (bordered button); a Fokus note line (NOTES not shown since 2026-10-15); the rest windows by type only (main lift or variant 3–5 min, isolation and abs 1–2, the rest 1.5–3; slice `rest-by-type`). Mentions below are history.

> **Superseded 2026-10-20 (user, slice `warmup-no-ramp`):** the warm-up shows no ramp rows (the 40/60/80 % kg and reps, §2.3 and acceptance 3); the warm-up step, its clock and the basis line `Op mod X kg` stay, and the warm-up's spoken sentence says the basis line instead of the ramp. Python still computes `planned_sets.ramp`; the web parses it and shows only the basis line.

Extends `traening.md` §4 (Fokus). Replaces §4.3 (rest view); amends §4.1 (last-tap line), §4.2 (suggestion line), §4.4 (finished view), §4.7, §6, §7. Everything not named here is unchanged. Data model: main session's brief of 2026-10-13 (exercise_set_log `kind`, `derived`, `felt_rpe`, `reps_done`; planned_sets `adjustment_kg`, `adjustment_reason`, `rest_min_s`, `rest_max_s`, `ramp`; `strength_sets.notes`; `exercise_feel`).

**Readings taken (user away, "most reasonable reading"):**
- R1 Separate file, linked from `traening.md` §4, so §4 stays readable.
- R2 **Reps stepper default:** the top of the range is shown, and written as `reps` when the pause is left (Til næste sæt / Til sæt 1 / Tilbage til Træning) if no `reps` tap was sent. The value is on screen the whole time, so it is a visible pre-fill, not a silent default. Leaving by Afslut or reload writes nothing (`reps_done` stays null). **Open decision:** see the end of the file.
- R3 Fortryd (top bar) walks **progress taps** only: done, skip, warmup_end, begin. Feel and reps are corrected in place (§4). Fortryd of a done clears that set's felt_rpe / reps_done with its end (reviewer, 2026-10-13: the set is open again, and a new done writes the top of the range afresh). Python counts them only on rows with `ended_at` set and `skipped = false`.
- R4 The last set of the session gets its feel block on the finished view (otherwise it could never be rated).
- R5 Spring over shows no feel block. A skip that ends an exercise opens the next exercise's warm-up.
- R6 Fortryd of "Begynd træning" (no set done or skipped) removes the warm-up row and returns to `/`, the screen the tap came from.
- R7 Warm-up has no recommended-rest band. Recommended rest is a pause between working sets.
- R8 `adjustment_reason` is stored lowercase-first (`du ramte 10 reps to gange`), because it always follows a dash. The web never re-cases it.
- R9 Felt-RPE and reps exist only in Fokus. Overview ticks on Træning write neither.

## 1. Shared frame (all three pause variants)
Top bar §4.1 unchanged (0–128px at 390). The last-tap line gains two tap kinds: `Begyndt kl. 17.58` and `Squat · opvarmning færdig kl. 18.05`. Below the top bar, top to bottom, **nothing else** (no TSB, chart or history):
1. **Feel block** (only after a done tap), on `--bg`, 8px under the last-tap line. It sits directly under the line that names the set, so the two read as one unit.
2. **Phase card** (`--surface`, `rounded-card`, padding 16px): Pause *or* Opvarmning, with the timer.
3. **Next-set card** (mini slab, as §4.3.3), 12px under.
4. **Primary button**, 16px under: full width, 64px, `--text` fill, `--bg` text, `text-32` Condensed 800 italic uppercase, → after. `Til næste sæt` or `Til sæt 1`. This is the only filled pill on the screen.
5. **Footer**, 16px under: `text-16` 500 `--text-muted` tabular, one line. Not live.

### 1.1 Feel block
- Question `Hvordan var sæt 2?` (`text-20` 700, `id` for the group's `aria-labelledby`). In the after-last-set variant: `Hvordan var sæt 4 i Squat?`, because the card below names another exercise.
- 8px, then a `role="group"` row of three equal `<button aria-pressed>`, gap 8px, `min-h-14` (56px), `rounded-control`, `text-16` 700: **Lettere** · **Som ventet** · **Hårdere**, in that order.
  - Unselected: 2px `--text-muted` border, `--text`.
  - Selected: `--slab` fill, `--on-slab` text, and a 16px ✓ (inline SVG) before the label. The ✓ and the fill both carry the selection, so colour never does it alone. Labels may wrap to two lines inside 56px.
  - Tap: the button shows selected within 100ms and sends `feel` (−1/0/+1). Tapping another option overwrites. Tapping the selected one clears it (`feel` null; main session to confirm that the action accepts null).
- **Reps stepper** (only when `reps_text` is a range), 12px under the feel buttons. It is one row, `role="group"` `aria-labelledby`:
  - Left: `Reps i sæt 2` (`text-16` 600), with `6 - 10` under it (`text-14` muted, as written).
  - Right: `[−]` value `[+]`. The buttons are 56×56, `rounded-control`, 2px `--text-muted` border, a 24px glyph, with sr labels `Færre reps` / `Flere reps`.
  - The value is an `<output aria-live="polite">` in `text-32` Condensed 700 upright tabular (logged = upright), min-width 3ch, centred.
  - Default: the range top. Bounds: 1 to top + 10. At a bound that button is `disabled` (`--border` outline).
  - Each tap sends `reps` (debounce 600ms, last value wins). Leaving the pause writes the default per R2.
- Fixed-rep sets (`3`, `5`): no stepper.
- If the set was rated before (a re-done set after Fortryd), the stored feel and reps show preselected.

### 1.2 Next-set card (mini slab; amends §4.3.3)
`--slab`, `--on-slab`, `rounded-control`, padding 12px. Lines, 4px apart:
1. `Næste` tag + `Squat · sæt 2 af 4` (`text-20` 700). In warm-up variants, `Sæt 1 af 4`, because the card heading already names the exercise.
2. `5 reps · RPE 7 · forslag 142,5 kg` (`text-16` 500). With an adjustment, short form: `· forslag 87,5 kg (+2,5)`. Null: `· intet forslag`.
3. **New:** `Sidste uge` (`--on-slab-muted`) + `140 kg` (600). Null: `Intet logget sidste uge`. Week 1: `Uge 1 i blokken: ingen sidste uge`.
4. **Superseded 2026-10-15 (user, slice `variants-notes`):** Fokus shows no NOTES. ~~**New, only when `strength_sets.notes` is present:** `Note: Palloff + GHD` (`text-16` 400, as written, upright). Up to 2 lines show in full. A longer note gets `line-clamp-2` plus a `Hele noten` text button (`min-h-11`, underline) that expands it in place.~~

### 1.3 Footer
`Tid brugt 42 min · ca. 31 min tilbage`.
- Elapsed = now − the session's first start (warm-up or set), in whole minutes.
- Remaining = open sets × the mean span of today's done sets (`kind = 'set'`, not derived, `ended_at − started_at`), rounded to whole minutes. At 60 min or more: `ca. 1 t 5 min tilbage`.
- Fewer than 2 done sets: `Tid brugt 4 min` only.
- Both are computed in the browser, refreshed every 30 s.

## 2. Variant A – Warm-up (`Opvarmning · <øvelse>`)
Entered by **Begynd træning** (first exercise), by **Fortsæt træning** when the first open set is set 1 and neither it nor its warm-up has a start, or by the done or skip that ended the previous exercise (Variant C).
Phase card, top to bottom:
1. `h2` **`Opvarmning · Squat`**, `text-32` Condensed 800 italic, uppercase via CSS, wraps (never truncated).
2. 8px. Timer `text-56` Condensed 800 italic tabular, counting up from the warm-up's start. `role="timer"`, `aria-label="Opvarmning"`, `--text` throughout (no band).
3. 12px. **The ramp** (main lifts with `ramp`), the screen's signature:
   - A basis line, `text-14` muted: `Op mod forslaget 142,5 kg`, or `Op mod sidste uge 140 kg` when the ramp comes from last week's logged kg.
   - 4px, then an `<ol aria-label="Opvarmningssæt">` laid out as a 3-column grid, gap 8px. Each cell holds `57,5 kg` (`text-24` Condensed 800 italic tabular; computed = italic) and `5 reps · 40 %` under it (`text-14` muted).
   - Under each cell, a 4px `--slab` rule of width pct × cell width (40/60/80 %), `aria-hidden`. The rules rise left to right, so the ladder reads as a ramp at a glance.
   - At 200% text the grid becomes a single column.
   - Main lift with `ramp` null: one line `Intet kg at regne opvarmningen ud fra.` (`text-16` muted). Accessories: nothing (timer only).
Next-set card (set 1 of the exercise), then **Til sæt 1**. It sends `warmup_end`, which ends the warm-up and starts set 1, then shows the set view.
Last-tap line: `Begyndt kl. 17.58` (first exercise) or the previous exercise's done/skip line.

## 3. Variant B – Pause between sets of the same exercise
Feel block (after a done; never after a skip, which goes straight to the set view as today). Phase card:
1. Label row (`flex`, `justify-between`, baseline): `Pause` (`text-14` 700 uppercase `--text-muted`) and `Anbefalet 3–5 min` (`text-14` 600 `--text`; `1½–2 min` for 90–120 s). Copy is from `rest_min_s` / `rest_max_s`: whole minutes as `3`, halves as `1½`.
2. 4px. Timer `text-56` Condensed 800 italic tabular, counting from the done tap.
3. 8px. **Rest rail** (`aria-hidden`), 8px high, `--track`, full width:
   - The scale runs to 1.2 × `rest_max_s`.
   - 2px `--text` ticks at min and max (≥ 3:1).
   - The fill (`--slab`) grows once a second with no transition.
   - Past the scale it stays full.
4. 8px. **Band line** (`text-16` 600), the text that carries the state:
   - before the minimum: `Hvil mindst 3:00` (`--text-muted`), with the timer `--text`.
   - at or after the minimum: ✓ (16px) + `Klar til næste sæt` (`--positive`), with the timer digits in `--positive`.
   - after the maximum: ✓ + `Klar · over 5 min pause` (`--positive`).
   - with `rest_min_s` null: neither band line nor rail, and the label row shows `Pause` only.
Next-set card, then ~~**Til næste sæt**~~ (**Superseded 2026-10-15 by `fokus-flow.md` §1:** no rest step; the pause view is the next set, its primary `✓ Sæt n udført`.) (no write, apart from R2's reps), then the footer.

## 4. Variant C – After the last set of an exercise (= the next exercise's warm-up)
The two jobs are stacked in time order, each in its own group:
1. Feel block for the set just done, with question `Hvordan var sæt 4 i Squat?` (+ stepper if that set was a range).
2. 16px. Variant A's phase card for the **next** exercise (`Opvarmning · Bænkpres`, timer from the done tap, ramp).
3. Next-set card (`Sæt 1 af 4`), **Til sæt 1**, footer.
The rest rail is absent, because the warm-up replaces the rest. After a skip that ends an exercise, Variant A shows without the feel block (R5).

**Finished view (§4.4, amended):** when the last tap is a done, the feel block for that set sits between the top bar and the finish card. `Tilbage til Træning` writes R2's default reps first.

## 5. Suggestion line with an adjustment (set view §4.2, Træning group)
- Python stores `adjustment_kg` = what the rule actually added **after** the weekly cap, plus `adjustment_reason`. A "hold" is `adjustment_kg` 0 with a reason.
- **Fokus set card**, under the `text-56` figure (replacing today's `(begrænset) i forhold til sidste uge` line), one `text-16` line in `--on-slab-muted`, with the signed number in 600 `--on-slab`:

| Case | Line |
|---|---|
| Added | `+2,5 kg – de sidste to var lettere` |
| Range rule | `+2,5 kg – du ramte 10 reps to gange` |
| Hold | `Holdt – de sidste to var hårdere` |
| Added, partly cut by the cap | `+2,5 kg – de sidste to var lettere · begrænset i forhold til sidste uge` |
| Cap only (no rule) | `(begrænset) i forhold til sidste uge` (unchanged) |
| Basis `progression` (accessory with no lift) | label `Forslag`, italic figure (last week + step), and the line `+2,5 kg – du ramte 10 reps to gange` |

- **Træning group line and Fokus mini card:** `Forslag 87,5 kg (+2,5 – de sidste to var lettere)`. Combined with the cap: `(+2,5 – de sidste to var lettere, begrænset)`. Hold: `(holdt – de sidste to var hårdere)`. The mini card uses the short form `(+2,5)` / `(holdt)`.
- Signs: `+`, and U+2212 if one is ever negative. Decimal comma.
- sr: `forslag 87,5 kg, 2,5 kg mere, fordi de sidste to var lettere`.

## 6. Fortryd (top bar), per state
It always undoes exactly what the latest progress tap wrote (R3).

| Latest tap | Fortryd does | Then |
|---|---|---|
| begin (no set done/skipped) | removes the warm-up row | navigate to `/`. The button reads `Begynd træning`; focus is on it |
| warmup_end (Til sæt 1) | clears the warm-up's end and set 1's start | Variant A again, timer from the original warm-up start; focus `Til sæt 1` |
| done, mid-exercise | as today | set view of that set |
| done that ended an exercise | as today, plus removes the next warm-up row (that tap created it) | set view of that set |
| skip | as today (plus the next warm-up row, if the skip created it) | set view of that set |

- **Feel tap:** undone in place. Tap the chosen option again (cleared) or another one (overwritten). Fortryd never walks feel taps.
- **Reps change:** undone in place with the opposite stepper button.
- Status: `Fortrudt: Squat, opvarmning er i gang igen.` · `Fortrudt: træningen er ikke begyndt.` (the `/` status region, after navigation).

## 7. Analyse › Styrke feel line
- Card `Sådan føles sættene` after the Tonnage card (the hero and Squat-panel fold in `analyse-styrke.md` §3 are unchanged). Title `text-20` 700.
- A `<ul>` with one row per `exercise_feel` row, competition S/B/D first, then the rest alphabetically (da-DK).
- Each row: the exercise name (`text-16` 700), then Python's sentence verbatim (`text-16` 400, max 60ch). Example: `Du melder oftest lettere end foreskrevet – forslaget ligger 5 kg over <trænerens navn>s RPE`. Under it `Ud fra 12 vurderede sæt` (`text-14` muted; needs a `rated_sets` count on `exercise_feel`). Rows are separated by 12px, with no dividers.
- An exercise with fewer than 4 rated sets has no row (Python writes none). With no rows, the whole card is absent.
- Read fails: `WarningLine` in the card's place: `Kunne ikke hente dine vurderinger.` + `Prøv igen` (href `/analyse/styrke`).

## 8. States (DEV_FIXTURE)
Existing states (§5 of `traening.md`) apply. New and changed:
- `midsession`: also gives one row an `adjustment_kg` (+2,5, lettere), one capped and adjusted row, one hold, and one `strength_sets.notes`.
- **Proposed `warmup`:** `begin` just tapped. Variant A for a main lift with a ramp, `Begyndt kl. …` + Fortryd.
- **Proposed `pause`:** a done on set 1 of a range exercise with a note 2:10 ago. Variant B before the minimum, feel unset, stepper at the top.
- **Proposed `exercise-end`:** the last set of a range accessory done. Variant C with the next main lift's ramp and a 2-line note (the fold worst case).
- **Proposed `feel`:** `/analyse/styrke` with two `exercise_feel` rows.
- **Loading:** `fokus/loading.tsx` unchanged (the set-card skeleton).
- **Save failed (s):** feel / reps / warmup_end taps join the same queue and `Gem igen`. A failed feel tap keeps its selection on screen.
- **Stale:** as §5.
- **Dev switches:** nothing written, `Testvisning: sæt gemmes ikke.` under the footer.
- **`rest_min_s` null:** see §3.4.
- **Ramp null:** see §2.3.

## 9. Accessibility and sizes
- Every target is ≥ 44px: feel 56, stepper 56×56, primary 64, `Hele noten` 44, Fortryd 44.
- Focus rings are 3px `--focus`; inside the slab they are `--slab-mark`.
- Focus moves:
  - After Udført, to the primary button (`Til næste sæt` / `Til sæt 1`).
  - After Til sæt 1, to Udført.
  - After a Fortryd of warmup_end, to Til sæt 1.
- The status region (polite) announces each of these once:
  - `Squat, sæt 2 udført. Pause, anbefalet 3 til 5 minutter. Hvordan var sæt 2?`
  - `Squat, sæt 4 udført. Opvarmning, Bænkpres: 5 reps 57,5 kg, 3 reps 85 kg, 2 reps 115 kg.`
  - `Anbefalet pause nået: 3 minutter. Klar til næste sæt.` (once, at the minimum)
  - `Pausen er over 5 minutter.` (once, at the maximum)
- The timer itself is never announced.
- Type scale (gym, 60–80 cm):
  - `text-56`: the timer.
  - `text-32`: the warm-up heading and the stepper value.
  - `text-24`: ramp kg.
  - `text-20`: the question and the next-set title.
  - `text-16`: everything else.
  - Nothing below `text-14`.
- No new tokens. New uses: `--positive` on the timer digits; `text-24` Condensed italic for ramp kg.
- Motion:
  - The phase card cross-fades as §4.6.
  - Selecting a feel option fills in 120ms.
  - The rest rail and the digits never animate.
  - Reduced motion: 0ms.

## 10. Acceptance criteria (ui, reviewer, tester)
1. **Fold 390×844, `DEV_FIXTURE=pause` and `exercise-end`** (2-line name and note): the three feel buttons, the timer and `Til næste sæt` / `Til sæt 1` end ≤ 844px without scrolling. The footer may scroll in `exercise-end` only.
2. Begynd træning opens Variant A for the first exercise with `Opvarmning · <name>`, the timer and the ramp (main lift) or no ramp (accessory). `Til sæt 1` writes `warmup_end` and shows set 1.
3. Ramp kg = 40/60/80 % of the basis, rounded to 2.5, as Python's `ramp`. The web shows it and never computes it. The basis line names its source.
4. After Udført mid-exercise: Variant B with `Hvordan var sæt n?`, three 56px options, a stepper only for range `reps_text`, `Anbefalet …`, the rail and the band line.
5. At `rest_min_s`, the digits turn `--positive` and `✓ Klar til næste sæt` appears. The status region announces it once. Before that, `Hvil mindst m:ss` is shown.
6. Tapping a feel option shows it selected (fill + ✓, `aria-pressed`) within 100ms and sends one `feel`. Another option overwrites; the same option clears.
7. The stepper defaults to the range top, ±1 per tap within 1…top + 10, and sends `reps`. Leaving with an untouched stepper writes the top once (R2). Afslut writes nothing.
8. Variant C shows the feel block for the finished set (`… i Squat?`) above `Opvarmning · <next>`. The finished view shows the feel block for the session's last done set.
9. The next-set card shows `Sidste uge <kg>` (or its null / week-1 text) ~~and `Note: …` when notes exist~~ (NOTES not shown since 2026-10-15).
10. Fortryd per §6: it undoes begin (back to `/`, `Begynd træning`), warmup_end (Variant A, original start), and a done that ended an exercise (the warm-up row is gone). Feel and reps survive a Fortryd of their done.
11. The suggestion line matches §5 for added / range / hold / capped+added / cap-only / `progression`. "0 kg" never appears.
12. Footer: `Tid brugt n min`, plus `ca. n min tilbage` from 2 done sets.
13. `/analyse/styrke` with `feel`: one row per exercise, in §7 order. Without rows there is no card.
14. Both themes: text ≥ 4.5:1, borders and ticks ≥ 3:1, `--positive` timer ≥ 4.5:1 on `--surface` (computed at render time). Reduced motion and 200% text (no horizontal scroll; the ramp stacks) hold.
15. Nothing else is on the pause screen: no TSB, chart or history.

## Open decisions (main session / user)
- **O1 (R2):** Is an untouched reps default stored? Storing it makes "top of the range two sessions in a row" fire for a user who never touches the stepper. Not storing it means every top-of-range set needs a tap. The spec stores it on leaving the pause, because the value is visible the whole time.
- **O2:** Python now reads `exercise_set_log` (felt_rpe, reps_done). That contradicts CLAUDE.md "Python never reads it"; CLAUDE.md needs the update.
- **O3:** "<trænerens navn>s RPE" hardcodes the coach's name in code in a public repo. Suggestion: an env var, or "trænerens RPE".
