# Spec-lite – Visual reset: Analyse › Styrke (`/analyse/styrke`)

Reference: `design/reference/belastning-mockup.html` (A list rows + tiles, B solid vs hatched bars, C hero curve card). The mockup wins on look.
Supersedes the **visual** parts of `analyse-styrke.md` (§3, §4 drawing, §5 drawing, §11) and `instrument-analyse.md`.
**Unchanged:** every rule, number and Danish string in `analyse-styrke.md` (§4 board content and reference lines, §5 domain/points/lines/best/sheet-1RM/notes/tooltip text, §5d RPE line, §6 copy, §7 sr text, §8 states) and the feel card (`fokus-pause.md` §7). No new calculation, no migration, no range selector.
Shared look (header, tabs, chart-card language, today line, legend row, ListRow) is defined once in `reset-analyse-cykel.md` §2, §4; this spec only states what differs.

## 1. Question and primary action
"Am I getting stronger, block by block?" Read the lift board; the one action is tapping a chart to read a week.

## 2. Layout at 390 (padding 20 / 16, 12px between cards)
1. Screen header + section tabs as Cykel §2 (`Styrke` current). h2 `Styrke` sr-only.
2. **Hero card: the lift board** (§3).
3. **Card `Estimeret 1RM pr. uge`** (§4).
4. **Card `Tonnage pr. uge`** (§5).
5. **Card `Sådan føles sættene`** (§6), only with rows.
6. RPE line (`analyse-styrke.md` §5d) Geist 13 muted, inset 4px, no card, only while it applies.
7. TabBar.

## 3. Hero card – the lift board (C's hero card, A's list rows)
Card radius **26**, padding 22 20 16, gap 12.
- Top row: MonoCaption 12 muted `BEDSTE E1RM · BLOK 12` left; phase right as MonoCaption 11 muted uppercase (`UDEN FOR SÆSON`), C's "HØJ/LAV" corner.
- Three **ListRows** in SBD order (first row no top border, others 1px `--border` top, padding 12 0), grid `1fr auto`, baseline-aligned:
  - left: lift name Geist 16/500; under it the set line `140 kg × 5 · RPE 6,5 · uge 1` Geist Mono 12 muted; then provenance `baseret på foreskrevet RPE` / `logget RPE` Geist 13 muted; then the reference line `Blok 12: 171,0 kg` Geist Mono 12 muted when present.
  - right: value Geist Mono **40/500** −0.03em, `kg` Geist Mono 14 muted after it. Colour = provenance: `--text` logged, `--text-muted` prescribed (words on the left carry it too). None: `–` muted + `Intet e1RM i blok 12 endnu`.
- First-block note under the rows (hairline top, 12 above): Geist 13 muted, 60ch.
- `<dl>` stays `aria-hidden` with the sr sentence before it, as now.

## 4. Estimeret 1RM pr. uge (C's curve card ×3)
Card radius 22, padding 20 (18 sides allowed). Header: SectionTitle + MonoCaption 11 `KG` right. Then the readout row (Cykel §4: head = `Uge 39 · 22.–28. sep. · blok 12, uge 1`, one Geist Mono 12 line per lift, text `--text`).
- **Block ruler** (18px strip on top, spans all panels): per block a 1px `--axis` bracket (ticks 4px down at both ends), label `BLOK 11` Geist Mono 10 muted centred (omitted if narrower). Deload week: the bracket segment over it dashed (2 3). Gap weeks: nothing.
- **Phase change:** 1.5px solid `--shade-2` vertical through the ruler and all panels.
- **Three panels** (Squat, Bænkpres, Dødløft), 112px plot each, 10px apart. Panel label MonoCaption 11 `SQUAT` top-left; y labels Geist Mono 11 muted right-aligned (C), 2–3 dashed `--border` gridlines; only the bottom panel has x labels (Geist Mono 11 muted).
- **Points:** logged = filled `--text` dot r3.5; prescribed = **hollow** r3, 1.5px `--text-muted` stroke, `--card` fill (vocabulary: hollow = estimate).
- **Line:** 1.5px `--text-muted`, one block at a time, breaks at every block boundary.
- **Block best:** 1px × 6px `--text` tick 3px above the point, value Geist Mono 10 `--text` above it (`179,6`).
- **`1RM i arket (ikke testet)`:** 1px `--text-muted` dashed (6 4) line per block span; value Geist Mono 10 muted at its right end on a `--card` halo; never crosses a best label (rule unchanged).
- **Today:** the `--today` line at today's x through ruler + panels, `I DAG` label `--today` (Cykel §3).
- Legend (bottom): `Logget RPE` (filled) · `Foreskrevet RPE` (hollow) · `Bedst i blokken` (tick) · `1RM i arket (ikke testet)` (dashed) · `Deload` (dashed bracket) · `I dag`.
- **Notes** 1–4 after the legend, hairline `--border` top, Geist 13 muted, 8px apart, 60ch.
- No e1RM for a lift: its panel shows `Intet e1RM endnu for squat.` Geist 13 muted at 112px height. No e1RM anywhere: the `NO_E1RM` sentence Geist 15 muted replaces the panels.

## 5. Tonnage pr. uge (B's bars)
Card as §4; header unit `KG`; same ruler, phase rule, today line and readout (`Squat: 2.100 kg · 12 sæt`).
- Three strips (Squat, Bænkpres, Dødløft), 72px each, 10px apart, label MonoCaption 11 left, y max Geist Mono 11 right, own y from 0.
- Lifted week: **solid `--text` bar**, slot − 2px, radius 2 top. **Deload week: the same bar hatched** (`--shade-2` 1px diagonal, 4px pitch, on `--card`, 1px `--shade-2` outline), B's solid vs hatched. Zero week: 2px `--axis` stub.
- Legend: `Uge med løft` · `Deload` (hatched) · `Intet løftet` (stub) · `I dag`.
- Explainer `Kg × reps for alle løftede sæt af løftet, også varianter.` Geist 13 muted under the legend. sr table unchanged.

## 6. Sådan føles sættene (A's list card)
Card radius 22, padding 20; SectionTitle h3. ListRows (1px `--border` top from row 2, padding 12 0): name Geist 15/500, verdict Geist 15 `--text` (Python's sentence verbatim), basis Geist 13 muted. Read fails: a Card with the WarningLine text + `Prøv igen` link (44px). No rows: no card.

## 7. Desktop (≥ 1024px)
Max-width 1200, `grid-cols-3`, gap 16; header and tabs span 3.
- Column 1: hero card (sticky top 24), the feel card under it.
- Columns 2–3: e1RM card, then tonnage card (same width so ruler, phase rule and today line align), then the RPE line.
- DOM order = phone order.

## 8. States
| State | Treatment |
|---|---|
| Loading | Header + tabs real. Hero skeleton: real caption, three rows with two 12px `--track` bars left and a 40px `--track` bar (w-1/3, radius 8) right. Chart cards with real titles, `--track` blocks 18 + 3 × 122 and 18 + 3 × 82 + 30, radius 12. Pulse `motion-safe` only. |
| `empty` / `error` | One Card with EmptyState / ErrorState (Cykel §7 styling), `Prøv igen` → `/analyse/styrke`. |
| `stale` | Header line as Cykel §2.1. |
| `lsrpe` | Hero values turn `--text` on logged rows; panels mix filled and hollow; RPE line gone. |
| `pre_log`, gap weeks | Drawn normally; note 3, tooltip suffix, `mellem blokke` carry it. |

## 9. Accessibility
- h1 `Analyse` › h2 `Styrke` (sr-only) › h3 per card; the board has `aria-label="Bedste e1RM"` and its sr sentence.
- e1RM figcaption per lift + phase sentence, tonnage sr table: unchanged (`analyse-styrke.md` §7). Ruler, ticks, hatching, dashed lines, today line `aria-hidden`.
- Chart groups focusable, ←/→/Esc, `--focus` ring 2px offset 2. Targets ≥ 44px (segments, chart group, `Prøv igen`).
- Provenance is never colour alone (words in the board, filled vs hollow on the plot). Deload is hatched + legend word + `· deload` in the readout. `--today` never as text.
- Hollow and hatched marks ≥ 3:1 against `--card` (computed at render).

## 10. Data check (all exist; nothing new)
| Value | Status | Field |
|---|---|---|
| Board value, set line, provenance, block best | exists | `strength_weeks.e1rm_kg`, `e1rm_load_kg`, `e1rm_reps`, `e1rm_rpe`, `e1rm_rpe_source`, `is_block_best`, `block_no` |
| Phase, block spans, deload | exists | `blocks.phase`, `start_date`, `end_date`, `deload_start` |
| Sheet 1RM | exists | `sheet_one_rm` (block, lift, kg) |
| Tonnage, sets, zero weeks, pre_log | exists | `strength_weeks.tonnage_kg`, `sets_lifted`, `status` |
| Feel lines | exists | `exercise_feel.name`, `verdict_text`, `rated_n` |
| Updated time | exists | max `strength_weeks.computed_at` |

## 11. Acceptance checklist (review against the mockup)
1. Same header, full-width 44px SegmentedControl tabs and TabBar as Cykel.
2. The lift board is a radius-26 hero card: three ListRows, values Geist Mono 40, `--text` = logged and `--text-muted` = prescribed, words on the left.
3. Every number (board, readout, axis, best labels, sheet values) is Geist Mono; sentences are Geist.
4. e1RM panels: dashed `--border` gridlines, right-aligned Geist Mono y labels, filled vs hollow points, line breaks at block boundaries, best tick + value, dashed sheet-1RM line labelled `1RM i arket (ikke testet)`.
5. Block ruler brackets with `BLOK n` labels and the phase rule run through every panel/strip in both cards, aligned to the same x.
6. Tonnage bars solid `--text`, deload weeks hatched, zero weeks `--axis` stubs.
7. `--today` appears only as the today line, at the same x in both chart cards.
8. Tapping/dragging updates the readout row (one line per lift, strings per `analyse-styrke.md` §5c) without moving the plot.
9. Feel card renders Python's lines verbatim as ListRows; absent with no rows.
10. At 1280: max 1200, hero + feel in column 1, charts in columns 2–3 with identical widths.
11. Loading, empty, error, stale and `lsrpe` render inside cards as §8.
12. Text ≥ 4.5:1, marks and control borders ≥ 3:1 (computed at render); targets ≥ 44px; visible focus on tabs and chart groups.
