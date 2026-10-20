# Spec: superset-any (slice `superset-any`, L; user 2026-10-20)

"Et tryk på ⇄ viser en liste over sessionens øvelser, der ikke er gået i gang. Den valgte rykker op lige efter A, med samme mekanisme som springet, kun for denne session. 'Som sidst' øverst." The one new surface is the **partner list**. Builds on `supersets.md` (S1–S9, S10–S17), `fokus-superset.md`, `fokus-sheet.md` (Bottom sheet, order, R1), `button-type.md`, `variants.md`, `fokus-kg.md` §3. Look: DESIGN.md Part B.

**Readings (user decides):**
- R1 The list is the existing **bottom sheet**. Option: a small menu anchored under the seam (fewer pixels, but rows with kg would not fit at 390px).
- R2 On Træning, B's row moves up under A, so the rail can join them (the only row that ever moves; `fokus-sheet.md` §14 otherwise stands). Option: rows stay in sheet order and B gets a line `Superset med Bench`.
- R3 The old Suggested state (paired by default) stays only when the last partner is already A's neighbour; any other last partner is only `Som sidst` in the list. Option: drop Suggested and always ask.

## 1. Question and action
"Hvilken øvelse skal følge Bench uden pause?" One action: tap a row. The sheet has no primary button.

## 2. Rules
1. **Where it opens.** Wherever ⇄ is offered today: Træning's seam under A, Fokus's session sheet seam, A's warm-up button. The seam shows under every unstarted run A that is in no pair and has ≥ 1 candidate (the neighbour may itself be started).
2. **The control.** Available: a dark compact button `Superset` (S2 look), no `aria-pressed`, `aria-haspopup="dialog"`, name `Vælg superset til Bench`. On the warm-up: the dark 44px button `Vælg superset` with the 18px `arrow-left-right` icon. Paired: unchanged S3 (`--raised`, check, `aria-pressed="true"`, rail); a tap unpairs at once without the list (S9 status).
3. **The sheet.** Træning and the warm-up: the Bottom sheet (`fokus-sheet.md` §6–8, §15–17: scrim, rest strip above it, close by Luk/scrim/Escape/back/swipe, focus trap and return). In Fokus's session sheet the list replaces the sheet's content as step 2 of the same dialog, with a 44 × 44 `ChevronLeft` button `Tilbage` left of the title. No sheet on top of a sheet.
4. **Header.** Title `Superset med Bench` (SectionTitle, the dialog label; variant display name when set). Under it, Geist 13 muted: `Den du vælger, rykker op lige efter Bench og tages uden pause. Kun i dag.` Kg column caption `I DAG` (MonoCaption 11), right-aligned.
5. **Candidates.** Every run with no logged set, except A and runs in a pair, in the current tap order. `Som sidst` (A's partner the last time A was paired, if it is a candidate) goes first.
6. **Row.** One `<button>` per run, min 56px, `ListRow` dividers, padding 10px 0, gap 12px. Left: the name stack (`fokus-sheet.md` §10), and under it Geist Mono 12 muted `4 sæt · 8 reps` (a range as `8–10 reps`; differing reps per set: `4 sæt`). Right: the first working set's kg, Geist Mono 16, `fokus-kg.md` §3 rules; no kg = nothing. No chevron (it is a choice, not navigation).
7. **`Som sidst` mark.** Above the first row's name, MonoCaption 11 `--text` `SOM SIDST` with a 14px `history` icon, and a 1px `--border` divider plus 8px under the row before the others. Text carries it, never position alone.
8. **Pick.** Tap → the sheet closes (240ms) → B's run moves right after A in `session_order` and is paired (one save). The run that sat after A keeps its place in the remaining order, now after B.
9. **After a pick, B not the neighbour.** Træning: B's row slides up under A (R2); the 2px `--text` rail joins A and B with the Paired seam between them; under B's name a Geist 13 muted line with a 14px `arrow-up` icon: `Rykket op · kun i dag`. Between B and the old neighbour: the normal divider, no seam (B is paired). Fokus's bar and session sheet show the pair as one group with its bracket, in the new order. Fokus's warm-up button becomes the pressed `Superset med Pull-ups`.
10. **Unpair** keeps B where it is, and its `Rykket op · kun i dag` line.
11. **Save failed:** the `jump-retry` pattern (the pick is saved like a jump; later taps wait; **Gem igen** sends it, then them). WarningLine under the seam (Fokus: under the top bar): `Supersettet med Pull-ups er ikke gemt.` + `Rækkefølgen er som før.` + **Gem igen** (the stored order is back at once; Gem igen sends the pick again). A refused pick keeps rule 12's line.
12. **Refused** (B or A started meanwhile, not today): order and pair return to the stored ones at once; WarningLine `Pull-ups kan ikke tages som superset med Bench, fordi Pull-ups er gået i gang. Rækkefølgen er som før.` (or `… fordi sessionen er ændret.`). No retry.
13. **Empty state** (the candidates vanished, e.g. another tab): under the header, Geist 14 `--text` `Ingen øvelser kan tages som superset med Bench nu.` + Geist 13 muted `De andre øvelser er gået i gang eller allerede i et superset.` Luk is the only control.
14. **Motion.** Sheet as Bottom sheet. B's row moves with a FLIP `translateY` 380ms `--ease`, then the rail draws in (S6, 160ms). Under `prefers-reduced-motion`: open, close, move and rail all appear at once.

## 3. aria and copy
- Row name: `Pull-ups, 3 sæt, 8 reps, i dag 20 kg.` First row: `Som sidst: Pull-ups, …`. List is a `<ul>` labelled by the title.
- Polite status after a pick: `Pull-ups rykket op efter Bench. De tages som superset.` After unpair: `Bench og Pull-ups tages hver for sig. Pull-ups bliver, hvor den er.`
- Under DEV fixtures: `Testvisning: valget gemmes ikke.`

## 4. States and fixtures (built from real taps, `--dev-today` on a day with an open session)
- Loading, error, stale: unchanged; the list reads the page's data, so it has no loading state.
- `DEV_FIXTURE=superset-pick`: Træning, A unstarted, ≥ 3 candidates, the last partner a non-neighbour, the list open. `superset-picked`: the same after picking that partner (B moved, paired). `superset-pick-empty`: the list open with no candidates. None writes.

## Acceptance (390 × 844, tester)
1. `superset-pick`: the sheet's name is `Superset med <A>`; rows are only unstarted, unpaired runs except A; the first has `SOM SIDST` and its sr name starts `Som sidst:`.
2. Each row is a button ≥ 56px tall with the name stack, `n sæt · reps` and the I DAG kg; keyboard-reachable with a visible ring; focus is trapped and returns to the seam on close.
3. A tap pairs and moves B right after A; the old neighbour follows B; reload keeps it (outside fixtures); Fokus's next set after A1 is B1.
4. `superset-picked`: rail, Paired seam (`aria-pressed="true"`), `Rykket op · kun i dag` on B, no seam between B and the old neighbour.
5. Unpair: B stays put, the status of §3 is announced.
6. A forced failed save and a forced refusal show rule 11/12's lines; refusal restores the order at once.
7. `superset-pick-empty` shows rule 13's sentences and only Luk.
8. Reduced motion: no transition on open, close, move or rail.
