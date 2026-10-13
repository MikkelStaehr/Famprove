# Spec – Instrument restyle: Træning (`/`) (slice `instrument-rest`, 2026-10-13)

Restyles `traening.md` §3 and §5 to DESIGN.md Part B Revision 5. **Same data, flow, writes, copy, sr text and states** as `traening.md`; only the look changes, plus the living element (§2), which is a drawing scale over data the page already has. Fokus is the reference and is not touched.

## 1. Element map (390 first; from `lg` the same single column, `max-w-phone`, left-aligned)
| Current (`traening.md`) | Instrument form |
|---|---|
| h1 `TRÆNING` Condensed 44 italic uppercase + date | h1 `Træning` Inter 400 `text-32`, sentence case; date Inter 400 `text-16` `--text-muted` on the baseline, 12px after |
| UpdatedLine | Inter `text-14` `--text-muted`; stale = ◆ + words in `--text` (Rev 5 warning) |
| Form flag (slab pill, swatch, zone name) | **Text only, no pill, no swatch:** `caption` `FORM (TSB)`, 4px, then one row: value Inter 500 `text-24` tabular (`−24`, U+2212), 8px, zone name Inter 400 `text-16` `--text` (`Optimal`). Hint Inter `text-16` `--text`, `Tallet er fra …` `text-14` `--text`. Same sr sentence. No scale here: the living element is the barcode |
| Session block: h2 + block line + ink pill button | h2 `Styrke: session 2 af 3` Inter 400 `text-20`; block line `text-16` `--text-muted`; **week columns** (§2.2) right-aligned beside h2 + block line; **primary**: Fokus's ink slab (fill `--text`, label `--bg` Inter 500 `text-24`, `min-h-14`, full width, radius 0, → SVG `currentColor`, `:active` opacity .8) |
| Card (surface, radius 24, shadow) | **Section**: heading Inter 400 `text-20`, 8px, 1px `--border` hairline, 16px, content. No fill, no radius. 40px between sections |
| Strength head `0 af 24 sæt udført` + segmented progress | count Inter 500 `text-24` + rest `text-16`; **set barcode** (§2.1) 12px under, replaces the segments |
| Prescription line Condensed 32 | Inter 500 `text-32` tabular, as written |
| Forslag / Sidste uge line | `caption` labels (`FORSLAG`, `SIDSTE UGE`, 12px) above Inter `text-20` values, one row, gap-x 24 |
| 28px circle check | **Set tick** (§2.1): the check column becomes a vertical barcode |
| NÆSTE slab (filled, bleed, radius) | **No fill.** A 2px `--text` bar on the group's left edge (x −12px, full group height) + `NÆSTE` `caption` in `--text` on the first open set's line (right column). sr `, næste` unchanged |
| Dividers between runs | 1px `--border`, 16px above/below |
| Ride card: watts 32, repeat rule 2px `--chart-mark` | Section; watts Inter 500 `text-32` tabular (`238 W`); % FTP `text-14` muted; repeat groups behind a 1px `--text-muted` rule, 16px indent; `GENTAG 3 GANGE` as `caption` |
| Rest card | Section: heading + one sentence, no fill |
| Footnote, Testvisning, WarningLine + Gem igen | Inter `text-14` muted; WarningLine with ◆; **Gem igen** = secondary: 1px `--text-muted` outline, 44px, Inter 500 `text-16`, radius 0 |
| Focus ring | 3px `--focus`, 3px offset, radius 0, around the whole set line |

## 2. The living element: the set barcode (one element, two scales)
All `aria-hidden` SVG; state from the set log the page already reads; no motion (0ms state change).
### 2.1 Barcode of sets
- **Head barcode** (horizontal, under the count): `<svg height=20 width=100%>`, one tick per set **by position**, pitch = min(8, width / sets) px, tick width 2px. Done: 2×20 `--text` filled. Skipped: 2×8 `--text-muted`, top-aligned to the baseline gap (short = skipped). Open: 2×4 `--text-muted` at the baseline. +4px gap between exercises (sheet-row name change). Same as Fokus's progress, minus the current-set mark (Træning has no "now" set; NÆSTE carries it).
- **Set tick** (the checkbox visual, column 1 of each set line, 12px wide, centred in a 28px column): a 12×28 rect. Open = 1px `--text-muted` outline (≥ 3:1, [A5]), no fill. Done = `--text` fill. Skipped = outline + a 12×2 `--text-muted` bar across the middle. Read down the list, the ticks are a vertical barcode of the session. Native checkbox, `<label>` target ≥ 44px and the accessible name unchanged.
### 2.2 Week columns (beside the session heading)
- `<svg>` 3 × N columns: one column per session n of N in the ISO week, 8px wide, 8px apart, bottom-aligned, height = sets × pitch, pitch = min(3, 48 / max sets) px; one 8×1 horizontal tick per set, bottom up in sheet order. Done session (has a date): every tick `--text`. Today's open session: done/skipped ticks `--text`, open ticks `--text-muted`, and the **red today tick** 8×2 `--accent` under the column at the baseline (the only red on the page). Future sessions: ticks `--border` (extent only) with a 1px `--text-muted` outline around the column.
- sr-only sentence after the h2: `Ugen: session 1 udført, session 2 i gang med 7 af 24 sæt, session 3 ikke begyndt.` (done, i gang / ikke begyndt per session, counts only).

## 3. States (copy unchanged, `traening.md` §5)
- **Loading** (`app/loading.tsx`): real h1; `--surface` bars, radius 0: updated line, form row (24px), session block (heading bar, 48px column box, 56px primary box); strength section with a 20px barcode bar and three 72px group bars. Pulse only under `motion-safe`.
- **Empty / no session / finished week:** sections and copy as now; the week columns still draw (all done, no red tick).
- **Error:** ErrorState (Rev 5 look: ◆, Inter `text-20` title, sentence, outlined `Prøv igen`), never a rest day.
- **Stale** (`DEV_FIXTURE=stale`): UpdatedLine ◆ + words; data unchanged. `midsession`: barcode and columns mixed.

## 4. Fold and acceptance criteria
1. Fold: at 390 × 660 the primary button is fully visible above 660 − `--bottom-bar` on every day with an open session (`traening.md` §3.5 guarantee stands; owner computes the y at render). At 390 × 844 the session block is above the fold.
2. No `--accent` except the week-column today tick (computed styles + pixel check). No `--slab*`, `--zone-*`, Barlow, `rounded-*` or shadow in any element.
3. Primary: ink fill, `--bg` label 24px, 56px, full width; contrast ≥ 4.5:1 computed.
4. Head barcode tick count = sets; done/skipped/open heights per §2.1 in `midsession`; set ticks: open outline ≥ 3:1, done filled, skipped barred; target ≥ 44px; accessible names unchanged.
5. Week columns: N columns, tick count per column = that session's sets; sr sentence matches the fixture.
6. NÆSTE: no fill; 2px ink edge + `NÆSTE` caption on the first open set line.
7. Mono (Chivo) only in captions; no character in a system font (font check).
8. 40px between sections, 12px inside groups; text scales to 200% without horizontal scroll.
9. Screenshots 390 and 1280, dark and light: live, `midsession`, `stale`, `error`, `empty`.
