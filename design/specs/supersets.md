# Spec: supersets (slice `supersets`, L; user 2026-10-15)

"Supersets vælges i appen … A1 → B1 → pause → A2 → B2. Ingen timer mellem A og B. Ingen TSS-ændring." Data: `superset_pairs` (migration `20261015200000_fokus_round.sql`). Builds on `fokus-flow.md` (the rest view is the next set), `button-type.md`, `variants.md` (name stack), `traening.md` §5 (save failed). Python and TSS are untouched.

**Readings (user decides):**
- R1: the ⇄ sits on the seam *between* the two rows. Option: inside A's expanded row only (calmer list, but you would have to open a row to find it).
- R2: A's warm-up done also reads `✓ Videre til <B>` (A0 → B0, no timer). Option: B's warm-up is skipped automatically in a pair (loses B's warm-up/set 1 boundary).
- R3: the rest after B uses the whole window with the larger `rest_max_s` (both bounds from it). Option: max of each bound separately.

## Træning (`/`): the seam (the one new surface)
- **S1 Where.** Between two consecutive exercise runs of the session (collapsed rows, `variants.md` §2), a 44px **seam** row: 1px `--border` hairline left and right, the control centred on it. Order of rows is unchanged (sheet order).
- **S2 Control.** A `<button aria-pressed>`, a compact dark button: visible 32px tall, 44 × 44 hit area via a transparent `::before` (as SegmentedControl), padding 0 12px, 1px `--text-muted` border, `--card` fill, `text-button` label `Superset` with the 18px `arrow-left-right` icon before it (an icon, never the ⇄ character). Accessible name `Superset: Bench og Pull-ups` (variant display names when set).
- **S3 States.**

| State | When | Look | Tap |
|---|---|---|---|
| Available | no row today, no paired earlier row (or today `paired = false`) | as S2, `aria-pressed="false"` | pairs (writes `paired = true`) |
| Suggested | no row today; the latest earlier row for this ordered (exercise, variant) pair says paired | as Paired + `Som sidst` Geist 13 `--text-muted` right of the control | switches off (writes `paired = false`) |
| Paired today | today's row `paired = true` | `--raised` fill, `check` icon replaces the swap icon, `aria-pressed="true"`; the pair is grouped (S4) | switches off |
| Locked | either run has a log row (A's warm-up begin excepted) | paired: the control becomes static text (not a button) `Superset · låst`, Geist Mono 13 caps `--text-muted`, swap icon; unpaired: no seam control | none |
| Not offered | A or B is already in another pair | no seam; the normal row divider | none |

- **S4 Group.** A paired (or suggested) pair reads as one block: a 2px `--text` rail on the left from A's row top to B's row bottom, the rows indented 12px from it; the seam control sits between them. Fill alone never carries "paired": check icon + rail + `aria-pressed` do. The list wraps the pair in `<li role="group" aria-label="Superset: Bench og Pull-ups">`.
- **S5 NÆSTE.** The NÆSTE slab and the Fortsæt state follow the tap order (S10), so after A1 the slab sits on B's group.
- **S6 Motion.** On a tap only: the rail draws in (`scaleY` 0 → 1 from the top, 160ms ease-out); switching off fades it (120ms). Never on first paint; none under `prefers-reduced-motion`. The control changes state at once (< 100ms, optimistic).
- **S7 Save failed** (the `traening.md` §5 (s) pattern): the control keeps its new state; a `WarningLine` directly under the seam: `Superset-valget er ikke gemt.` + `Det står her, men forsvinder, hvis siden genindlæses.` + **Gem igen** (dark, 44px). Gone when saved.
- **S8 Refused** (a run started meanwhile, e.g. in another tab): the control returns to the stored state; `WarningLine` `Supersettet kan ikke ændres, fordi Bench er gået i gang.` No retry button.
- **S9 sr.** After a tap, one polite status: `Bench og Pull-ups tages som superset.` / `Bench og Pull-ups tages hver for sig.` Locked text sr: `Superset, låst, fordi Bench er gået i gang.`

## Fokus (`/fokus`) in a pair
- **S10 Tap order.** A0, B0, A1, B1, A2, B2 …; the longer run's extra sets run alone at the end (4 + 3: … A3 B3 A4). A skip moves on like a done (writes no time). Fortryd walks back in this order.
- **S11 Pair line.** In the hero card, under the name stack, Geist 14 `--text-muted` with the 16px swap icon: on A `Superset med Pull-ups · den følger uden pause`; on B `Superset med Bench · pause bagefter`.
- **S12 A's done.** The one light done reads `✓ Videre til Pull-ups` (source sentence case, rendered caps; wraps to 2 lines, grows from 56px, never truncated). Accessible name `Videre til Pull-ups, sæt 2 af 4 udført, Bench`. Same on A0 (R2).
- **S13 A → B.** B's hero card shows at once with **no rest strip** (fokus-flow §1.2 is absent when the shown set's predecessor is its paired A). No vibration, no timer. Status: `Bench, sæt 2 udført. Næste: Pull-ups, sæt 2 af 3, 8 reps.`
- **S14 Rest after B.** B's done (`✓ Sæt 2 udført`) starts the rest; the view is the next A set (fokus-flow §1), its pair line saying B follows. `Anbefalet` and the vibration at Min use the pair's window (R3); the strip's label row reads `PAUSE` ↔ `Anbefalet 3–5 min · superset`. B0's done (`✓ Opvarmning udført`) leads to A1 the same way.
- **S15 Feel.** Each set's feel row shows once, on the view right after its own done, and names the exercise because the card shows the other one: `Hvordan var sæt 2 i Bench?` (on B's view) and `Hvordan var sæt 2 i Pull-ups?` (on A's view). The reps stepper follows the same rule (`Reps i sæt 2 · Bench`). Optional as before.
- **S16 Tail.** Sets after the shorter run ends are solo: done `✓ Sæt 4 udført`, the exercise's own rest window, pair line replaced by `Alene – Pull-ups er færdig`.
- **S17 Progress.** Fokus's and Træning's segmented progress order their segments by the tap order (A1 B1 A2 B2 …), so they fill left to right; count `3/19` unchanged. Warm-ups stay out of it, as now.

## States and fixtures
- **S18** `DEV_FIXTURE=superset`: a pair today (paired), A1 and B1 done, the rest view before A2. On `/` the pair is grouped and **locked**. Writes nothing.
- **S19** `DEV_FIXTURE=superset-suggested`: no row today, last session's row paired; `/` shows the Suggested state, nothing logged. Writes nothing.
- **S20** Loading, error, stale, no session: unchanged. Optional third word `superset-tail` (A4 after B3) if `ui` wants the tail shot.

## Acceptance (390 × 844, tester)
1. `superset-suggested`: the seam control between the two rows has `aria-pressed="true"`, a check icon, `Som sidst` and the rail; one tap sets `aria-pressed="false"`, removes the rail, and (outside fixtures) stores `paired = false`; reload keeps it off.
2. Available → one tap pairs; the control is ≥ 44 × 44 and keyboard-toggleable with a visible ring; the status sentence of S9 is announced.
3. An exercise already in a pair has no seam control toward its other neighbour.
4. After any log row of A or B (other than A's warm-up begin), the control is static `Superset · låst` and not focusable; a forced server refusal shows S8's sentence and reverts.
5. Save forced to fail: the state stays, S7's lines + Gem igen appear; Gem igen online saves and the warning goes.
6. Fokus `superset`: hero shows A2 with `Superset med <B> · den følger uden pause`, the rest strip, and `✓ VIDERE TIL <B>`; tapping it shows B2 with no rest strip and no timer.
7. B2's done shows A3 with the rest strip; `Anbefalet` equals the larger window; vibrate (stubbed) fires once at its min.
8. Feel rows name the exercise (S15); a done without a feel tap leaves `felt_rpe` null.
9. 4 + 3 sets: tap order A1 B1 A2 B2 A3 B3 A4; A4 shows `Alene – <B> er færdig` and `✓ SÆT 4 UDFØRT`.
10. Progress segments fill left to right in tap order on `/` and `/fokus`.
11. Strength TSS in `daily_load` is identical with and without a pair (Python never reads `superset_pairs`).
