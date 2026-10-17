# Spec-lite: fokus-superset (slice `fokus-superset`, M; user 2026-10-17)

Pair two runs in Fokus as well as on Træning. Same write, same states (`supersets.md` S3, S7–S9), same tap order (S10–S16). The sheet is specified in `fokus-sheet.md`.

**Readings (user decides):** R1 the set-screen control shows on A's warm-up **and** on A1 until A1 is done. If you pair on A1 (A's warm-up done), B's warm-up comes next (supersets R2: warm-ups stay alone), so the view changes to it. Option: offer it on A's warm-up only, so the view never changes under the thumb.

## 1. Question and action
"Kan jeg tage disse to som superset, uden at forlade Fokus?" The primary action is unchanged (the light done). The superset control is dark and never competes with it.

## 2. Rules
1. **In the sheet:** between two adjacent rows that are also consecutive in sheet order, the Træning seam as-is (S1–S4): a 44px seam row and the compact dark toggle `Superset` (32px visible, 44px hit, `arrow-left-right` icon, `aria-pressed`). The states are S3: Available, Suggested (+ `Som sidst`), Paired (`--raised` + check + rail), Locked (`Superset · låst`, static), and Not offered (no seam). Finished or started neighbours that are unpaired have no seam.
2. **On the set screen:** on A's view (warm-up or set 1, R1) while the pair is unlocked, B is A's next run in sheet order, and neither run is in another pair. It sits in the hero card under the name stack, in the slot where the pair line (S11) goes. The slot is at least 44px, so nothing below it moves.
3. **Its look:** a dark button (`button-type.md`), auto width, 44px, the 18px `arrow-left-right` icon, label `Superset med Pull-ups` (variant display name, wraps, never truncated). It is a toggle (`aria-pressed`). On = `--raised` fill, check icon, and the pair line (S11) appears under it at once. A second tap unpairs (the undo). In the Suggested state it starts on, with `Som sidst` after it.
4. **After A1's done** the pair is locked. The button goes, and only the pair line stays.
5. Each tap changes the state at once (< 100ms, optimistic) and writes `setSupersetPair` once (idempotent).

## 3. Flow
- **Sheet:** bar → `Superset` between Bench and Pull-ups → the rail draws in (S6 motion) → close. The view already follows A1 B1 A2…
- **Set screen:** on Bench's warm-up, `Superset med Pull-ups` → the pair line `Superset med Pull-ups · den følger uden pause` shows. One tap, no navigation.

## 4. Copy
- Accessible name: `Superset med Pull-ups` (pressed state from `aria-pressed`).
- Status (S9): `Bench og Pull-ups tages som superset.` / `… hver for sig.` On A1 (R1): `Bench og Pull-ups tages som superset. Først opvarmning til Pull-ups.`
- Save failed (S7, a WarningLine directly under the control, in the sheet or the hero card): `Superset-valget er ikke gemt.` + `Det står her, men forsvinder, hvis siden genindlæses.` + **Gem igen**.
- Refused (S8): the control returns to the stored state, with `Supersettet kan ikke ændres, fordi Bench er gået i gang.` There is no retry.

## 5. States
Loading, error and stale are unchanged. `DEV_FIXTURE=superset-offer`: A's warm-up current, no pair today, B unstarted (the button shows, off). `sheet-superset` (`fokus-sheet.md`) shows the Locked seam. Fixtures write nothing.

## Acceptance (390 × 844)
1. `superset-offer`: the hero card shows `SUPERSET MED <B>`, which is ≥ 44px, dark, and `aria-pressed="false"`. One tap shows the pair line without moving the done button.
2. A second tap removes the pair line, and both taps announce S9's sentences.
3. In the sheet, the seam between two unstarted neighbours toggles the same pair, and the set screen reflects it after close.
4. After A1's done, there is no superset button on any view and the sheet's seam reads `Superset · låst`.
5. A forced failed save and a forced refusal show §4's lines and behave as S7/S8.
