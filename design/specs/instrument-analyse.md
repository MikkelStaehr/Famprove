Superseded (visual) by the reset-*.md specs, 2026-10-14.

# Spec – Instrument restyle: Analyse, Cykel (`/analyse`) and Styrke (`/analyse/styrke`) (slice `instrument-rest`, 2026-10-13)

Restyles `analyse.md` (§3–§12) and `analyse-styrke.md` (§3–§11) to DESIGN.md Part B Revision 5. **Same data, copy, answer sentences, readouts, sr text, states and desktop grid** (rail = answers / lift board, `lg:sticky`; main = charts). One data read may widen: Cykel's dots need `ride_metrics.load`, an existing column (no migration); if the select lacks it, add it to the data layer.

## 1. Shared (both sections)
| Current | Instrument form |
|---|---|
| h1 `ANALYSE` Condensed | h1 `Analyse` Inter 400 `text-32` |
| Section tabs Condensed 32 italic + 4px bar | Inter 400 `text-24`; current `--text` 500 + 2px `--text` underline (offset 6px); other `--text-muted` 400. Links, `aria-current` |
| Cards | Sections (heading Inter 400 `text-20`, hairline, content); 40px between |
| Legends | Rev 5 swatches, `text-14` muted |
| Pause seam `Ingen ture` | 1px dashed 3 3 `--text-muted` rules; `INGEN TURE` caption in the 18px strip |
| `--slab` "you are here" (latest point, current week) | the **red today tick** 2×8 `--accent` on the x baseline at today; the latest point is ink (below) |
| Tooltip / readout | as Belastning (`--bg`, 1px `--text-muted`, radius 0); behaviour unchanged |
| ✓/arrows/◆ | inline SVG |

## 2. Cykel
- **Answer blocks** (rail on desktop): question row `caption` (`ER JEG STÆRKERE?`, 12px) + `?` = a 24px square, 1px `--text-muted` outline, radius 0 (open: `--text` fill, `?` `--bg`); number Inter 400 tabular (block 1 `text-56`, 2–3 `text-44`), unit same size; arrow SVG 24 `--text`; the caption line is Inter `text-14` muted (it is a sentence, not a label); verdict Inter `text-16` `--text`. Blocks 40px apart, no box.
- **eFTP pr. tur, dots sized by TSS** (Recharts `ScatterChart` → `<Scatter>` with a custom `shape`): each `eftp_ok` ride at (`date`, `rolling_ftp_w`), filled `--text` circle, **area ∝ load**: r = 1.5 + 4.5 × √(load / max load of the plotted rides) (r 1.5–6). `load` null: hollow ring r 3, stroke 1 `--text` (missing, not small). Latest ride: its dot + a 2px `--bg` ring and the today tick on the axis. **No connecting line**; a gap (`eftp_gap_before`) is just empty space plus the seam. Excluded rides: a 6px × cross (two 1px `--text-muted` lines) on the plot's bottom edge (never hollow: hollow means "estimated or missing"). Legend: `eFTP · størrelse = TSS` (three dot sizes) · `Udeladt tur` (×). sr figcaption gets one added clause: `Punkternes størrelse viser turens TSS.`
- **EF as a dot trend**: `ef_ok` rides r 2 `--text-muted` filled; `ef_trend` drawn as **dots, not a line**: r 1.25 `--text` at every row with a non-null `ef_trend` (it breaks by itself where Python breaks it). Legend `Trend (median over 28 dage)` (small ink dots) · `Tur` · `Udeladt tur`.
- **Timer og belastning pr. uge, thin bars**: two strips as now; one 2px `--text` bar per week at the slot centre (not slot-wide); zero week = 1×2 `--text-muted` stub on the baseline; null load = no mark; current week = bar unchanged + the red today tick under it on the baseline. Legend `Uge med ture` · `Uge uden ture` · `I dag`.
- **Excluded rides**: `<details>` Inter 500 `text-16`, 44px; from `lg` the `<table>` with hairline rows, header `caption`.

## 3. Styrke
- **Lift board** (rail): label `caption` `BEDSTE E1RM · BLOK 12` + phase word Inter `text-14`; per lift `dt` Inter 400 `text-20` + set line Inter `text-14` muted + provenance words; `dd` value Inter 400 `text-56` tabular (`174,1 kg`), `--text` logged / `--text-muted` prescribed (words carry it, as now). Hairline between rows.
- **Block ruler** (both cards): hairline **brackets** as Belastning (1px `--text-muted` line + 6px end ticks in the 18px strip, `Blok 11` mono 12 centred, deload part dashed 3 2). Phase change: 1px solid `--text` full-height rule. `--block-fill` and hatch removed.
- **e1RM panels** (inline SVG, as now): logged = filled `--text` r 3; prescribed = hollow r 2.5, stroke 1 `--text-muted` (estimated = hollow, app-wide rule); line inside a block 1px `--text-muted`; block best = the point + a 1×6 `--text` tick 3px above it and the value mono 12 `--text` above that (no ring); sheet 1RM dashed 1px `--text-muted` 6 4 with its value mono 12.
- **Tonnage strips**: 2px `--text` bars at slot centre; zero = 1×2 stub; current week = today tick under it (red, the page's only red; no `--slab`).

## 4. States (copy unchanged: `analyse.md` §8, §12d; `analyse-styrke.md` §8)
Loading: same grid; real h1, tabs, section headings; `--surface` bars radius 0 (answer: caption real + 56/44px bar w-1/3 + two text bars; plots = `--chart-height` blocks; Styrke as its §8 heights). Empty / error: page EmptyState / ErrorState (Rev 5) over the grid; section errors in place. Stale: UpdatedLine ◆ + words. `ef-few`, `answers`, `lsrpe` fixtures unchanged in meaning.

## 5. Acceptance criteria
1. Fold 390 × 844: Cykel's three verdicts end ≤ 844 − `--bottom-bar`; Styrke's Squat panel ends ≤ 844. 1280 × 800: rail + first plot incl. x labels visible (owner computes).
2. Red only as the today tick (one per chart, on the axis); no `--slab*`, `--block-fill`, hatch, area, line on eFTP, or Condensed type.
3. eFTP dot radius follows √load within r 1.5–6 (DOM check on two rides with known load); null load = hollow ring; excluded = × on the baseline.
4. EF trend = dots only; weekly and tonnage bars 2px at slot centre; zero weeks stubbed.
5. Prescribed e1RM points hollow, logged filled (`lsrpe` fixture shows both); brackets per block, deload dashed.
6. Seams align across Cykel's charts at 390 and 1280 (`analyse.md` §10.6).
7. Readout/keyboard per DESIGN.md "Charts: interaction"; contrast ≥ AA computed; font check passes.
8. Screenshots 390 and 1280, dark and light: Cykel (live, `answers`, `ef-few`), Styrke (live, `lsrpe`), `stale`, `empty`, `error`.
