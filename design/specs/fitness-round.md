# Fitness round (user order 2026-10-14) – spec-lite

Three changes. Look and tokens are in DESIGN.md Part B, which this spec updates (curve card header, tiles row, curve legend, zone colour rule). States use the `DEV_FIXTURE` words.

## 1. Belastning › fitness curve card: header as mockup C
Question: "how fit am I today, and is it rising at a healthy rate?" There is no action.
- **Header** (replaces `Fitness` + `TSS/DAG`): an `<h2>` `FITNESS` in `MonoCaption` text-12 muted uppercase (`aria-label="Fitness"`). The `TSS/DAG` caption is removed. The right side stays empty.
- **Figure row** (4px under the caption, baseline-aligned, gap 10px): fitness on the last measured day, one decimal with a Danish comma, e.g. `18,7` (Geist Mono `text-48` 500 tabular `--text`). Beside it the ramp in Geist Mono `text-14` 500 `--text`: `↑ 3,1 / 7 d` · `↓ 1,4 / 7 d` · `→ 0,0 / 7 d`. The arrow comes from the ramp after rounding, the number is its absolute value, and the source is the one the Fitness tile used. A null ramp shows `– / 7 d` in muted.
- **Verdict** (6px under the figure, Geist `text-13` 500, a plain word, **not a pill**). `ZonePill` means a TSB zone, and "Hård opbygning" uses the Pause colour, so a pill would read as a second form zone. Logic goes in the new `web/src/lib/ramp-verdict.ts` and works on the ramp **rounded to 1 decimal first** (−0,04 → 0,0 → Sund):
  - r < 0: `Falder` in `--zone-neutral`
  - 0 ≤ r < 5: `Sund opbygning` in `--zone-optimal`
  - 5 ≤ r ≤ 8: `Hård opbygning` in `--zone-transition`
  - r > 8: `For hurtigt` in `--zone-risk`
  - null ramp: the line is omitted.
  - Contrast as text on `--card` (DESIGN.md table, values computed at token time): 7.99 / 8.28 / 7.71 / 6.10, all ≥ 4.5. The colour always sits next to its word.
  - Stale: the verdict line adds `· seneste 11. okt.` in muted.
- **Legend:** only `- - - prognose` (when a prognose is drawn), plus `spænd` exactly when a band is drawn. `○ i dag`, `○ seneste` and `Blok` are gone (the bracket labels name themselves).
- **Y axis:** try steps 1, 2, 5, 10, 20, … in that order and take the first with ≤ 4 intervals. Bottom = the largest step multiple ≤ the window's lowest value (measured, prognose and `ctl_low`), never below 0. Top = the smallest step multiple ≥ the highest value (incl. `ctl_high`). If min = max, top = bottom + step. One gridline and label per step. Example: lowest 11,2 and highest 28,4 give step 5 with ticks 10–30.
- **Unit:** without the caption, `TSS/dag` lives in the sr sentence and the readout cells (DESIGN.md exception).
- **States:** loading = the card skeleton with a 48px bar for the figure. `empty` = `–`, no ramp, no verdict, the existing empty text. `error` = the existing ErrorState in the card. `stale` = as above.

Acceptance: 1a The header shows `FITNESS`, the figure with one decimal and `↑ x,y / 7 d`. No `TSS/DAG` anywhere on the card. 1b `node --test` on `ramp-verdict.ts` covers −0,1 → Falder, −0,04 → Sund opbygning, 4,96 → Hård opbygning (rounds to 5,0), 8,0 → Hård opbygning, 8,04 → Hård opbygning, 8,06 → For hurtigt, and null → none. 1c The legend shows only `prognose` (and `spænd` under `band`). 1d The y-axis bottom gridline is ≤ the window minimum and less than one step below it, at 4U, 12U and Sæson. 1e A null ramp shows `– / 7 d` and no verdict.

## 2. Tiles row: two tiles
The Fitness tile goes, because it duplicated the header. **Træthed** and **Uge N** become two equal tiles (`grid-cols-2`, gap 12px, at every width; in column 1 on desktop). Tile contents are unchanged: `33` / `TSS/DAG`, `72` / `TSS · 3/7 d`.
Acceptance: 2a The row has exactly 2 tiles of equal width at 390 and 1280. 2b At 390 × 844 the fold still shows the form card, the tiles and the top of the week card.

## 3. Styrke lift board: the last-known fallback
When a lift's `rolling_e1rm_kg` is null, the board shows the lift's **latest week with a weekly e1RM** (`strength_weeks.e1rm_kg`, the same one e1RM rule as the board and the suggestions since `e1rm-one-rule`, so that week is always older than the 4-week window).
- The value is, for example, `182,5 kg`, **always `--text-muted`**, even when the RPE was logged.
- The source line reads `seneste: blok 11, uge 4 · 145 kg × 3 · RPE 7`. The provenance line is unchanged (`baseret på foreskrevet RPE` / `logget RPE`). Muted already means "prescribed" on this board, so the word `seneste` carries the difference, not the colour.
- That week can fall inside the 4-week window (it uses a different rule). The text stays the same.
- If the lift has no weekly e1RM ever: `–` muted, and the left line `Intet e1RM endnu`.
- The sr text for that lift reads: `squat seneste 182,5 kilo, blok 11, uge 4`.

Acceptance: 3a A lift with a null rolling value and an older weekly e1RM shows a muted value and the `seneste: blok N, uge M` string. 3b A lift with neither shows `–` and `Intet e1RM endnu`. 3c A lift with a rolling value is unchanged (answers-round §3a).
