# Spec: combo-parts (slice `combo-parts`, L; user 2026-10-17)

"Hver del af en kombineret variant har sin egen kg og reps." The sheet has one WEIGHT cell, so a variant with parts (e.g. `Pallof + weighted situps`) is logged in Fokus. Part names are set by hand per variant. The one new surface is the **parts editor** in Fokus. It builds on `fokus-flow.md` §1.4 (the previous-set section), `button-type.md` and `traening.md` §5 (save failed).

**Readings (user decides):**
- R1 The kg step is 2.5. The figure is also typeable (`inputmode="decimal"`), so 1 kg or 12,5 needs no extra taps. Option: a 1 kg step.
- R2 Autosave, with no Gem button: one save carries all parts. It runs on the next done (queued first, like the reps stepper's range-top write), on Afslut, and on `visibilitychange` → hidden. Untouched pre-filled parts are saved too, as the stepper does. Option: an explicit dark `Gem dele`.
- R3 The hero card keeps the `fokus-kg.md` kg block (the sheet's one cell). Option: replace it with last time's parts (`Pallof 12,5 kg × 10`).

## Rules
1. **Where:** in the previous-set section (`fokus-flow.md` §1.4), after the done of a set whose variant has parts. It sits under the feel row and **replaces** the reps stepper for that set. A variant without parts looks exactly as before. In a superset its caption names the exercise (`supersets.md` S15).
2. **Caption:** `DELE I SÆT 2` (MonoCaption 12, muted), with `VALGFRIT` on the right.
3. **One row per part,** in the variant's part order, with a 1px `--border` divider and 14px between rows:
   - Line 1: the part name (Geist 16/500) on the left. On the right, the toggle `Pr. side`: a compact dark button (32px visible, 44px hit, `aria-pressed`). On = `--raised` and the check icon. Its accessible name is `Weighted situps tæller pr. side`.
   - Line 2: two steppers side by side, gap 12px, each with a visible caption above it (`KG`, `REPS`, MonoCaption 11). A stepper is a 44 × 44 dark − / + pair with a typeable value in the middle (Geist Mono 24, tabular, `inputmode="decimal"` for kg and `numeric` for reps). Kg steps by 2.5 (R1); reps steps by 1. sr names: `Færre kg, Pallof press` / `Flere kg, …` / `Færre reps, …` / `Flere reps, …`.
4. **Pre-fill:** each part's kg, reps and per-side come from the last time that part was logged, including earlier sets today. Never logged: kg and reps show `–` (empty, not 0) and per-side is off. A part left at `–` saves nothing for that field (missing = null). Kg 0 is a real value (no added weight); reps must be ≥ 1.
5. **Validation on blur,** with the error under the field and the input kept: `Skriv kg som et tal, fx 12,5.` (comma or dot accepted) · `Reps skal være et helt tal over 0.` · kg above 300: `Over 300 kg ser forkert ud. Tjek tallet.` An invalid part is not saved, and the rest are.
6. **Save (R2):** optimistic. Fields never clear. On failure, a WarningLine under the section: `Delene i sæt 2 er ikke gemt.` + `De står her, men forsvinder, hvis siden genindlæses.` + **Gem igen** (dark). Under DEV fixtures: `Testvisning: sæt gemmes ikke.`
7. **Fortryd** of that set's done hides the editor with the set. The saved parts stay with the set and pre-fill when it is done again.
8. **Leaving and returning** (request 6): the flush on Afslut or hide saves the edits. On return, the section reads the saved parts back while that set is still the previous set.
9. **Height:** at 390 × 844, two parts add about 210px. The section may fall below the fold (`fokus-flow.md` §1: item 4 is cut first). The timer, the next set and the done never move.
10. **Træning:** on a done set that has parts, the expanded set line gets a second line in Geist Mono 13 muted: `Pallof 12,5 × 10 · Situps 10 × 12 pr. side` (wraps). Collapsed rows are unchanged (dots only). The sr sentence appends `, dele: Pallof press 12,5 kg gange 10, weighted situps 10 kg gange 12 pr. side`.
11. **Screen reader:** the section is `role="group"` with the name `Dele i sæt 2, valgfrit`. After a save, nothing is announced (it is quiet, like the stepper). A failure is announced once.

## States and fixtures
Loading, error and stale are unchanged. `DEV_FIXTURE=combo`: `midsession` where the set just done is a parts variant (two parts, one with per-side on), pre-filled from an earlier session, with the editor shown. It writes nothing.

## Acceptance (390 × 844, tester)
1. `combo`: under the feel row, `DELE I SÆT n` and one row per part with name, `Pr. side`, KG and REPS, and no reps stepper. Every control is ≥ 44 × 44 and has a visible label.
2. The values match the fixture's last logged values. A never-logged part shows `–`, never `0`.
3. + and − change kg by 2.5 and reps by 1. Typing `12,5` is kept as 12.5. `abc` shows §5's sentence under the field on blur and keeps the text.
4. One done after editing sends one save with every part (outside fixtures). A forced failure shows §6's lines and Gem igen, and the values stay.
5. Afslut mid-edit, then reopening `/fokus`, shows the edited values.
6. Træning shows the parts line on that done set, and its sr sentence includes the parts.
7. A variant without parts looks exactly as before (the screenshot matches `midsession`).
