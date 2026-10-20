# clip-line (M, spec-lite, 2026-10-20)

**Question:** "Hvor meget fylder klippene, og skal jeg gemme eller rydde?" **Action:** none dominant. The line stays quiet so that Begynd træning remains the screen's one primary action. The way into a set's clip is now its Klip row (`clip-at-set`). This line replaces the Optagelser card. `ClipLibrary` stays mounted in the same place in `TrainTab.tsx` `DayCards` (right after the day card), so the player, the trim and delete timers and the overview keep working.

## 1. The line (390 px)
- **Place:** directly under the day card: `SessionBlock`, or `RideToday`/`RestToday` on days without strength. 8px gap.
- **Look:** no card, no border, no fill. Horizontal padding is 20px, so it lines up with the card's text.
- **Section:** `<section aria-label="Optagelser">`. At 1280 px it sits in the left column under the day card, and all controls fit on one row.
- **Row 1 (state):**
  - Left: `544 MB` (Geist Mono 12, tabular, `--text-muted`). This is the long-press target (600 ms) for the hidden overview, the only hidden entry. The overview still renders inline under the line.
  - Middle: the switch, visible label `Auto-klip`. It is the native checkbox in a 44px `<label>`, and its accessible name is the visible text. While the switch is off, its `aria-describedby` points to an sr-only copy of "Slået fra. Klip med Start her og Slut her i afspilleren."
  - Right: `Alle klip · 9` + Lucide `chevron-right` 16 (Geist 14, `--text`).
- **Row 2 (actions):**
  - `Gem alle fra i dag · 4` (`download` 16). It keeps its variants `Gem resten · n` and the progress line.
  - `Slet gemte · 2` (`trash` 16).
  - Both are quiet text buttons: Geist 13 `--text`, icon `--text-muted`, no fill. Each is hidden when its count is 0, and the row goes when both are hidden.
- **Targets and wrapping:** every control is min-h-11, at least 44px wide, `whitespace-nowrap`, with a 2px `--focus` outline at 2px offset. The rows use `flex-wrap gap-x-4`. If row 1 doesn't fit at 390 px (ui measures at render), `Auto-klip` moves to the end of row 2. A label never wraps inside itself.
- **No accent colour.** Orange stays the today marker.

## 2. "Alle klip"
- **Container:** a sheet with its own history entry.
  - 390 px: full-screen, `--card` background, top corners `rounded-card`.
  - 1280 px: a centred dialog, max-w 560, max-h 85vh.
  - It slides up in 200 ms. Under `prefers-reduced-motion` it appears instantly.
- **Title:** `Alle klip` + `9 klip` (`MonoCaption`). A Luk button (`x` 20, 44 × 44) sits top right.
- **Content, in this order:**
  1. The full space line (`544 MB af 10,7 GB · ældre end 8 uger slettes automatisk (☆ beholdes)`).
  2. The auto-clip muted line, when the switch is off.
  3. The persistence warning (`WarningLine`).
  4. The cleanup line, the server-error warning and "Denne browser kan ikke optage video".
  5. **All** rows. There is no "Vis alle".
  6. `Kameratest` last.
- **Closing:** back, Luk or Escape. Focus goes to the heading on open and back to `Alle klip` on close.
- **Clips:** a row opens the player over the sheet. Closing the player returns focus to that row.
- **Warning on the line:** while storage isn't persistent or the server read failed, `Alle klip` gets a Lucide `triangle-alert` 16 in `--warning` before it. Its sr text is "– se advarsel". It is never colour alone.

## 3. Fortryd countdowns
Row 3 of the line is the status row. It appears only while it has content.
- **What it shows:**
  - the delete window (`deleteWindowText` + `Fortryd 8`);
  - the trim's Fortryd once the player has closed;
  - `saveLine`.
  - The texts and buttons are today's, moved unchanged.
- **Two open windows:** two lines, delete first.
- **While the sheet is open:** the same row renders in the sheet's footer instead. It renders in only one place at a time, so nothing is announced twice.
- **Behaviour:** the countdown is not live. Fortryd is ≥ 44px. After Fortryd, focus goes to `Alle klip`, or to the restored row if the sheet is open.

## 4. Empty, loading, error, rest day
- **No clips:** the line shrinks to one row: `Ingen optagelser endnu` (Geist 13, `--text-muted`) and `Alle klip` + chevron, with no count.
  - In this state the sheet holds the sentence "Tryk Optag på et arbejdssæt i Fokus. Videoen bliver på telefonen.", the `Auto-klip` switch and Kameratest. The switch moves into the sheet only in this state.
  - The line never disappears, so the place stays stable and Kameratest stays reachable.
- **Rest or ride day:** the same line, in the same place, under that day's card. `Gem alle fra i dag` is hidden when there are no clips from today.
- **Loading:** row 1 renders at full height, with `Alle klip` and a blank space figure. After 1 s the space figure gets a 48 × 12 `bg-track` pulse (none under reduced motion). Row 2 is added when the index lands; only content below the line moves.
- **Error** (local read): row 2 becomes "Kunne ikke læse optagelserne på telefonen." followed by `Prøv igen`. `role="alert"`.

## 5. States to shoot (390 px, plus S1 at 1280)
- **S1:** `--dev-fixture clips --dev-today 2026-10-19`, the line.
- **S2:** the same, with Alle klip open.
- **S3:** S1 after `Slet gemte`, showing the status row with Fortryd.
- **S4:** a trim's Fortryd on the line after closing the player.
- **S5:** `--dev-fixture empty`, the one-row line.
- **S6:** `clips` on a rest day of the fixture week. ui names the date.

## Acceptance criteria
1. The Optagelser card is gone. The line sits directly under the day card on every day, with no border and no fill.
2. At 390 px with `clips`: row 1 = `NNN MB`, `Auto-klip`, `Alle klip · 9`; row 2 = `Gem alle fra i dag · n`, `Slet gemte · n`. No label wraps inside itself.
3. Every control on the line is ≥ 44 × 44 px, reachable by Tab and has a visible focus ring. The switch's accessible name contains "Auto-klip".
4. A control whose count is 0 is absent, not disabled.
5. `Alle klip` opens a sheet listing **every** clip, with the full space line, the warning (when relevant) and Kameratest. Back, Luk and Escape close it, and focus returns to `Alle klip`.
6. A row in the sheet plays its clip. Closing the player returns focus to that row.
7. The delete and trim Fortryd countdowns show on the line while the sheet is closed, and in the sheet while it is open, never both. Fortryd restores the clip.
8. Long-press (600 ms) on the space figure opens the overview. Nothing else changed in it.
9. `empty`: one row with `Ingen optagelser endnu` and `Alle klip`. The sheet has the switch and Kameratest.
10. With non-persistent storage, `Alle klip` carries the warning icon with sr text, and the sheet shows the full warning.
11. Under reduced motion the sheet opens without animation.
