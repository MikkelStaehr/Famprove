# Spec: fokus-flow (user 2026-10-15) – the pause screen is the next set

"Intet 'start'-trin: pauseskærmen ER næste sæt." Amends `fokus-pause.md` §1–§4, §9 and `traening.md` §4. Buttons per `button-type.md`; kg per `fokus-kg.md`. Every primary is a **done**; nothing starts a set.

**Readings (user decides):** R1 the warm-up keeps its own done (`✓ Opvarmning udført`, today's `warmup_end` write, renamed), so set 1 keeps its own span for the HR split; option: merge it into `✓ Sæt 1 udført` (loses the warm-up/set boundary). R2 the warm-up's done is light (it is a done).

## 1. One layout: set = pause (`kind` `set` and `pause` render the same; `dismissed` and "Til næste sæt" are removed)
At 390 × 844, top to bottom, gaps 12px:
1. **Top bar** (unchanged): Afslut (dark, x) · count `3/19` · progress · Fortryd row.
2. **Rest strip** (Card 22, padding 16), only when `restStart(log)` is non-null: label row `PAUSE` (MonoCaption 13) ↔ `Anbefalet 3–5 min`; timer `text-56` Mono; rail (`--track`, span `--shade-2`, now tick `--text`); band line `Hvil mindst 3:00` → `✓ Klar til næste sæt` → `✓ Klar · over 5 min pause` (check icon + words; no colour carries it). Rest values: the row just done (after the warm-up: set 1's row). Null rest: timer only.
3. **Next-set hero card** (Card 26, padding 20): `NÆSTE · SÆT 2 AF 4` (MonoCaption 13); the name `text-32` (variant title + muted exercise name, `variants.md`); a two-column grid: reps `text-44` | the `I DAG` kg block (`fokus-kg.md` §1) and `Sidste uge` line (§2) under it. Bottom right inside the card: **Spring over** (dark, 44px, compact), because it acts on this set.
4. **Previous set (optional)**, only when the latest tap was a done, on `--bg`, no card: `Hvordan var sæt 1?` Geist 16/500 + `VALGFRIT` MonoCaption 13 muted on the same line; three dark choices (56px); the reps stepper under it on a range set (`Reps i sæt 1`, − value +).
5. **Dock** (sticky): the one light **✓ Sæt 2 udført**, 56px. It is a done on the next set (end = now; start = the previous tap, as today). If the stepper was untouched, its range-top `reps` write goes first in the same queue (fokus-pause R2).
Cut below the fold if needed: item 4's stepper, then the footer `Tid brugt …` (moves under the dock's scroll area). Never cut: timer, next set, done.
With no rest start (first load after a skip with no prior done, or after Fortryd to that state) items 2 and 4 are absent; the layout is otherwise identical.

## 2. Warm-up (A) and after-last-set (C)
Unchanged content (ramp, `Opvarmning · <name>`, clock), with C's feel row as §1.4 for the set just done. Primary: **✓ Opvarmning udført** (light; writes `warmup_end`). It leads to §1 for set 1, the timer counting from that tap. Finished view: unchanged, feel row for the last set, **Til Træning** dark.

## 3. Vibration
Once per rest, when the shown timer crosses `rest_min_s` while the page is visible: `navigator.vibrate?.(200)` (feature-detected; a no-op on iOS, nothing shown). Not on load when already past the minimum, not at the maximum, not in the warm-up clock, not when `rest_min_s` is null. Haptics are not motion: it fires under `prefers-reduced-motion` too. Under DEV_FIXTURE it still fires (it writes nothing).

## 4. Wake lock
Requested on Fokus when the log shows the session begun (any row today) and not finished; re-requested on `visibilitychange` → visible; released on the finished view and on leaving (Afslut, unmount). Unsupported or refused: silent, no UI.

## 5. Screen reader
- Primary: accessible name `Sæt 2 af 4 udført, Squat` (contains the visible words). Warm-up: `Opvarmning udført, Squat`.
- After a done, one polite status: `Squat, sæt 1 udført. Næste: sæt 2 af 4, 5 reps, i dag 142,5 kg. Pause, anbefalet 3 til 5 minutter.` (kg sentence per `fokus-kg.md` §4). Focus moves to the primary.
- Feel group: `role="group"`, name `Hvordan var sæt 1? Valgfrit.`
- At the minimum: `Anbefalet pause nået: 3 minutter. Klar til næste sæt.` once (with the vibration). The timer is never announced.

## 6. States
Loading, error, stale, save failed, no session: unchanged (`fokus-pause.md` §8). Fixtures: `pause` (timer before min), `exercise-end` (C), `midsession`.

## Acceptance (390 × 844, tester)
- **F1** `pause`: timer, the next set's name, reps, `I DAG` kg and `✓ SÆT 2 UDFØRT` are visible without scrolling; no "Til næste sæt" string anywhere on `/fokus`.
- **F2** One tap on `✓ Sæt n udført` from the pause layout ends set n (log row has `ended_at`) and shows set n+1 in the same layout with the timer at 0:00.
- **F3** The feel row is optional: a done without a feel tap saves, and `felt_rpe` stays null.
- **F4** Spring over sits inside the next-set card, is a dark 44px button, and skips that set.
- **F5** Warm-up: `✓ Opvarmning udført` writes `warmup_end` and shows set 1 in the §1 layout with the timer running.
- **F6** With `navigator.vibrate` stubbed: called once with 200 at `rest_min_s`, not again at the max, not when loading past the min, also under reduced motion.
- **F7** Wake lock stubbed: requested after begin, re-requested on visible, released on the finished view and on Afslut.
- **F8** Fortryd after a done shows that set again in the §1 layout, the timer counting from the tap before it.
- **F9** The status text and accessible names match §5; focus lands on the primary after every done.
