# Answers round (user answers 2026-10-14) – spec-lite

Four small changes. Look and tokens: DESIGN.md Part B (unchanged). States use `DEV_FIXTURE` words.

## 1. Prognose: the cycling sentence (`lib/prognose-text.ts`)
Question: "what is the cycling part of my prognose built on?" A **calendar week** = an ISO week (Mon–Sun, both inclusive) inside the prognose with ≥ 1 planned ride in intervals.icu; it uses those rides only. Other weeks keep the typical week. Counts are Python's (`calendar_rides`, `calendar_weeks`, rides of the last 28 days); the web only formats. Singular: `1 tur`, `1 uge`.
- No calendar week (unchanged): `Cyklingen i prognosen bygger på 12 ture de sidste 28 dage.` (0 rides: the existing sentence.)
- Some: `Cyklingen i prognosen bygger på 3 planlagte ture i intervals.icu i 2 uger. De andre uger bygger på 12 ture de sidste 28 dage.`
- All weeks: `Cyklingen i prognosen bygger kun på dine 9 planlagte ture i intervals.icu.` Singular (accepted in review 2026-10-14): `… bygger kun på din 1 planlagte tur i intervals.icu.`
- Planned ride without a load estimate (that day uses the typical week), added as its own sentence: `1 planlagt tur har ingen belastning i intervals.icu, så den dag bruger din typiske uge.` / `2 planlagte ture har ingen belastning i intervals.icu, så de dage bruger din typiske uge.` If Python gives no count, this goes in the day readout only.
- Readout on a prognose day, cycling basis fact: `Cykel ≈ 45 TSS · planlagt i intervals.icu`; a no-load day: `Cykel ≈ 30 TSS · typisk ugedag (planlagt tur uden belastning)`; other days unchanged.
- Disclosure term 4 (`PROGNOSE_TEXT`), cycling clause becomes: `Cykling: i uger med planlagte ture i intervals.icu kun de ture, ellers dit gennemsnit for hver ugedag de sidste 28 dage.`
Acceptance: 1a `node --test` checks all four sentences verbatim, singular and plural. 1b A week with one planned ride shows only that ride's load on its days (readout says `planlagt i intervals.icu`). 1c No sentence says `0 af 0` or `0 planlagte`.

## 2. Analyse calm: one chart rule app-wide
The /load rule (`review-round.md` §3) now applies to **every chart on Analyse** (Cykel eFTP, EF, Timer og belastning; Styrke e1RM, tonnage). §3's "Analyse is unchanged" and 3d are reversed. The Cykel answer cards are unchanged.
- **At rest:** no readout row, no reserved height, no `Seneste · …`, no value in the plot, no SVG `<title>` with a value. The sr sentence and hidden tables stay.
- **No hover:** no tooltip, no hover marker; the mouse changes the cursor only.
- **Select:** tap, click, touch drag (`touch-action: pan-y`), or ←/→ with the plot focused; the first arrow press selects the latest point. One readout under that chart's legend (layout as DESIGN.md "Readout row"). **Close:** the same point again, Esc, or a tap outside that card's plot.
- **Text left inside a plot:** axis tick labels, panel/strip labels (`SQUAT`, `TIMER`), block labels (`BLOK 12`), `INGEN TURE`, `I DAG`. Nothing else: Styrke's block-best value labels (`174,0`) and the sheet-1RM values (`180`, `102,5`) go; their marks (best tick, dashed line) stay. Any value label on a Cykel plot goes.
- Legend: `Bedst i blokken` becomes `Blokkens bedste` (matches the readout).
Readout content (line 1 / cells / facts; formats as DESIGN.md):
- eFTP ride: `tirs. 3. jun. 2025 · Udendørs tur` / `eFTP 212 W` · `NP 182 W` · `VI 1,08` / `1:45 t · 48,2 km` (excluded: `… · Udeladt: For kort`).
- EF: `tirs. 3. jun. 2025` / `EF 1,24` · `Trend 1,22` / `NP 165 W · puls 133 · 1:45 t`.
- Timer og belastning: `Uge 23 · 2.–8. jun. 2025` (` · indtil videre`) / `Timer 4:30 t` · `Belastning 210 TSS` · `Ture 3` / `1 udeladt fra trends`.
- Styrke e1RM: `Uge 42 · 12.–18. okt. · blok 12, uge 3` / one line per lift `Squat 174,0 kg · 145 kg × 3 · RPE 7 foreskrevet · blokkens bedste` (` · blokkens bedste` only on that lift's best week; `Dødløft ikke trænet`) / last fact `1RM i arket: squat 180 kg, bænkpres 102,5 kg (ikke testet)` (lifts without a sheet 1RM omitted; line omitted when none; gap week: `mellem blokke`, no sheet line).
- Styrke tonnage: as e1RM line 1 / `Squat 2.138 kg · 4 sæt` per lift (`Dødløft ikke trænet`).
Acceptance: 2a At rest no Analyse chart shows a value, readout or empty reserved space (390 and 1280). 2b Mouse hover shows nothing; a click shows one readout under that chart only. 2c Same point / Esc / outside closes; first → selects the latest point. 2d No number inside any Analyse plot except axis ticks and `BLOK n`; no `<title>` with a value. 2e The e1RM readout names `blokkens bedste` and `1RM i arket: … (ikke testet)` per the strings above.

## 3. Styrke lift board: the 4-week e1RM
Question: "how strong am I now, by the number the suggestions use?" Value = `strength_weeks.rolling_e1rm_kg` of the lift's latest week; the set behind it from `rolling_e1rm_week`. Window = the 4 ISO weeks ending with the latest week, both inclusive.
- Header left: `E1RM · SIDSTE 4 UGER`; right: the latest block's phase (unchanged). `aria-label="E1RM de sidste 4 uger"`.
- Source line: `145 kg × 3 · RPE 7 · uge 3` (block week of the source week); source week in an earlier block: `145 kg × 3 · RPE 7 · blok 11, uge 4`. Provenance line and colour unchanged (`baseret på foreskrevet RPE` / `logget RPE`).
- Empty lift: `–` muted, left line `Intet e1RM de sidste 4 uger`.
- Comparison line (that block's best, `is_block_best`): `Bedst i blok 11: 171,0 kg` (muted). None for any lift: `Blok 12 er den første blok uden for sæson, så der er ingen blok at sammenligne med endnu.`
- **"endnu" rule (user-approved):** a block-scoped text keeps `endnu` only while that block runs (`blocks.end_date ≥ today`); after: `… så der er ingen blok at sammenligne med.` All-history texts (`Intet e1RM endnu for squat.`) keep it.
- Note under the board (Geist 13 muted): `Samme e1RM som de foreslåede kg: bedste sæt med højst 5 reps ved RPE 7 eller mere de sidste 4 uger.`
- sr: `Estimeret 1RM de sidste 4 uger: squat 174,0 kilo, bænkpres 105,0 kilo, dødløft intet. Baseret på foreskrevet RPE.`
Acceptance: 3a Board values equal `rolling_e1rm_kg` (not the block best). 3b Header and empty text verbatim. 3c `DEV_TODAY` after blok 12's end_date: no `endnu` in the comparison sentence; before it: `endnu`.

## 4. Træning footnote
`Forslag er et skøn ud fra din e1RM og RPE, ikke trænerens tal.` shows only when ≥ 1 shown set has a suggested kg. `Hvert sæt gemmes, når du sætter flueben; kg logger du i arket.` always shows.
Acceptance: 4a A session with no suggestion has no `Forslag er et skøn`; `midsession` (with suggestions) has it.

## States (all sections)
Loading / empty / error / stale as each screen's spec; nothing new. `empty`: no board values, no prognose sentence (unchanged). `stale`: unchanged warning line.
