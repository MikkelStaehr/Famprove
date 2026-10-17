# Spec: fokus-sheet (slice `fokus-sheet`, L; user 2026-10-17)

"Tryk på baren åbner hele sessionen; tryk på en øvelse springer derhen." The one new surface is the **session sheet**. Builds on `fokus-flow.md` (one set/pause layout), `supersets.md` S4/S10/S17 (rail, tap order, progress), `fokus-kg.md` §3 (row kg), `variants.md` (name stack), `button-type.md`. Look tokens: DESIGN.md Part B (Bottom sheet, Motion).

**Readings (user decides):**
- R1 Jump rule (**decided by the user 2026-10-17**): C moves to just after the finished runs, the rest keep their order, so a half-done B comes right after C.
- R2 Data (decided 2026-10-17): the done tap writes the next set's start, so the server must know the jumped order, and it must survive leaving Fokus (request 6). A jump is therefore a write: a new tap kind `jump` in the existing set-log write path (one shared transition), stored in `session_order`; the user's request (jump + "nothing lost on leaving") is the go, and CLAUDE.md's write-path paragraph says so.
- R3 Træning's progress strip gets the same groups (consistency). Option: Fokus only in this slice.
- R4 The sheet's height is fixed to "everything under the timer". Option: fit to content, up to that height.

## The grouped bar
1. **Segments** in tap order (`supersets.md` S10, after any jump): one per working set, warm-ups out (as now). Height, colours, radius and the current set's 1px `--text` outline stay as in `reset-fokus.md` (done `--text`, skipped `--shade-2`, open `--track`).
2. **Groups:** one group per exercise run. Gap 2px between sets inside a group, **6px between groups**. With more than 30 sets: 1px and 4px. Each group's width is in proportion to its set count (`flex: n`).
3. **Superset pair** = one group, its segments interleaved A1 B1 A2 B2…, with a 1.5px `--text-muted` bracket 3px under it (6px down-ticks at both ends, the strength-block bracket in small). The tail sets of the longer run stay in the group.
4. **Tap target:** the count and the bar together are one `<button>`, ≥ 44px tall, from the count's top to 8px under the bar. A 16px `ChevronDown` in `--text-muted` sits right of the count, so the button is visible without hover. Afslut and Fortryd stay outside it. Accessible name: `Vis hele sessionen, 7 af 19 sæt udført`.
5. **After a jump** the groups take their new order in 380ms `--ease` (FLIP translateX). None under reduced motion.

## The sheet
6. **Position:** anchored to the bottom. Its top is 12px under the rest strip (or under the top bar when there is no strip). The content scrolls inside (`overscroll-behavior: contain`). At 390 × 844 with a strip, about 540px, which is room for 8 rows.
7. **Above it:** the rest strip stays at full contrast **above the scrim**. The timer keeps running, and the vibration and the minimum announcement still fire (the status region sits outside the inert part). The top bar is under a scrim (`#000` at 0.55) and is inert while the sheet is open.
8. **Look:** `--card` fill, 1px `--border` top edge, top corners `--radius-hero` (26). A grabber (36 × 4, `--shade-1`, radius 2) sits 8px from the top and is decorative (`aria-hidden`). Padding 8px 16px 24px, plus `env(safe-area-inset-bottom)`.
9. **Header row:** the title `Hele sessionen` (SectionTitle, the dialog's label) on the left, then the count `7/19` (MonoCaption 12), then a 44 × 44 icon button (`X`, `aria-label="Luk"`) on the right. Under it, Geist 13 muted: `Tryk på en øvelse for at tage den nu. Rækkefølgen ændres kun i dag.` Above the kg column sits one right-aligned column caption, `I DAG` (MonoCaption 11).
10. **Rows** (tap order, one per exercise run, `ListRow` dividers, min 56px, padding 10px 0, gap 12px):
    - **Name stack:** the variant's display name in Geist 16/500 `--text`, and when a variant is set, the exercise name in Geist 13 muted under it. Names wrap and are never truncated.
    - **Set dots** under the name stack: 10px, gap 6px, one per working set. **Done** is a filled `--text` disc. **Skipped** is a 1.5px `--text-muted` ring with a minus bar. **Now** is a 1.5px `--text` ring with a 4px `--text` centre dot. **Upcoming** is a 1.5px `--text-muted` ring. Shape carries the state, never colour alone.
    - **Kg** on the right: Geist Mono 16, the kg of the run's next open set, with `fokus-kg.md` §3's rules (italic for computed, `~`, `kropsvægt`). A finished run shows its last set's kg in `--text-muted`. No kg: nothing.
    - **Pair:** the two rows share the 2px `--text` rail and the 12px indent (`supersets.md` S4), wrapped in `role="group"` with `aria-label="Superset: Bench og Pull-ups"`. The ⇄ control between rows is specified in `fokus-superset.md`.
11. **Current row:** a `--raised` fill (radius 14, bleeding 8px each side) and the word `NU` (MonoCaption 11 `--text`) before the kg. Not a button.
12. **Finished row** (every set done or skipped): text in `--text-muted`, not a button. Its sr name ends with `, færdig`.
13. **Tappable row** (any other run, also a half-done one): the whole row is a `<button>` with a trailing 16px `ChevronRight` (muted). **The tap jumps:** the sheet closes, the view shows that run's next open set (its warm-up when the run has not started), and the bar and the sheet reorder by R1. The sets jumped past stay upcoming. The rest strip is unchanged, because a jump is not a done. A tap on either row of a pair jumps to the pair's next set in tap order.
14. **No Fortryd for a jump.** Fortryd keeps undoing the latest set tap. Jumping back is the undo. Træning's NÆSTE and Fortsæt follow the same order. Træning's rows stay in sheet order (they never move).

## Closing, focus, motion
15. **Close by:** the `Luk` button; a tap on the scrim or the rest strip; Escape; the back gesture (opening pushes one history entry, and `popstate` closes; closing any other way pops it); a swipe down on the grabber, the header or the list when it is scrolled to the top. The sheet follows the finger and closes on release past 25 % of its height or at a flick of > 0.5 px/ms. Otherwise it settles back in 240ms.
16. **Dialog:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` = the title. The background is `inert`. On open, focus goes to the title (`tabindex="-1"`). Tab cycles inside the sheet. On close, focus returns to the bar button. After a jump it goes to the view's primary (as after every done).
17. **Motion:** opens with translateY 100 % → 0 in 380ms `EASE_EMBER` (`--ease`) and closes in 240ms. The scrim fades 0 → 0.55 at the same duration. Under `prefers-reduced-motion` it appears and disappears at once, and a release snaps. The swipe still follows the finger (direct manipulation, not animation). Nothing animates on first paint (a fixture that loads open is open at once).

## Copy (Danish)
- Row sr: `Bench, 2 af 4 sæt udført, 1 sprunget over, i dag 85 kg. Tag den nu.` · current: `Squat, nu, sæt 3 af 5, i dag 142,5 kg.` · finished: `Deadlift, 3 af 3 sæt udført, færdig.`
- After a jump, one polite status: `Pull-ups nu. Bench venter med 2 sæt.` (a run not started: `Pull-ups nu, først opvarmning.`)
- Save failed (the `traening.md` §5 pattern, a WarningLine under the top bar): `Springet er ikke gemt.` + `Rækkefølgen står her, men forsvinder, hvis siden genindlæses.` + **Gem igen** (dark). Refused (not today, session changed): the order returns to the stored one and the line reads `Kunne ikke springe til Pull-ups: sessionen er ændret. Rækkefølgen er som før.`
- Under DEV fixtures nothing is written: `Testvisning: sæt gemmes ikke.`

## States and fixtures
- Loading, error and stale stay as `fokus-pause.md` §8. The sheet reads the data already on the page, so it has no loading state of its own. On the finished view every row is finished and none is tappable.
- `DEV_FIXTURE=sheet`: `midsession` with the sheet open. `sheet-superset`: `superset` (A2 next) with the sheet open. `jumped`: `midsession` after a jump (C current and right after the finished runs, B half done and next after C). None of them writes.

## Acceptance (390 × 844, tester)
1. `midsession`: the bar has a 6px gap between runs and a 2px gap inside a run. The count + bar button is ≥ 44px tall, has the chevron, and its name matches §4.
2. `superset`: the pair is one group, interleaved, with the bracket under it.
3. A tap or Enter on the bar opens the sheet. The rest strip stays visible above the scrim and its timer keeps counting (two screenshots 2s apart differ only in the timer).
4. `sheet`: one row per run in tap order. Done, skipped, now and upcoming dots differ by shape. The current row has `NU` and is not a button. Finished rows are not buttons.
5. A tap on an upcoming row closes the sheet, shows that run's next open set (its warm-up when unstarted), and announces §Copy's status. The bar and the sheet show the R1 order. Reloading and leaving and returning to `/fokus` keep it (outside fixtures).
6. `jumped`: B's done sets stay done, its open sets are upcoming, and Træning's NÆSTE sits on C.
7. Luk, the scrim, Escape, the back gesture and a swipe past 25 % each close the sheet. A swipe of 10 % settles back. Focus returns to the bar button.
8. Focus stays inside the open sheet (Tab from the last element goes to the first). The dialog has `aria-modal="true"` and its name is `Hele sessionen`.
9. Under reduced motion, open, close and the bar reorder happen with no transition.
10. A forced failed jump save shows §Copy's line and Gem igen. The order stays until a reload.
