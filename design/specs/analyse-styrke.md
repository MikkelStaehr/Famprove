# Spec – Analyse, section Styrke (`/analyse/styrke`)

Owner: design-lead · 2026-10-01 · task e2 (L, no migration) · for `ui`. Contract: `DESIGN.md` Part A + Part B (Spurt), pack `design/patterns/data-dashboard.md`. Language, date and number rules as `analyse.md` (top), plus: e1RM in kg with 1 decimal (`174,1 kg`); a set's load as logged (`102,5 kg`); tonnage in whole kg with a `.` thousands separator (`14.008 kg`, display rounding only); RPE with a decimal comma (`RPE 6,5`).

**Data:** `strength_weeks`, `blocks`, and `strength_sets.e1rm` (the sheet's 1RM), all read server-side through `web/src/lib/db/*`. The UI selects, filters, counts rows and maps dates to x. It does no arithmetic on metrics: no deltas, no sums, no block totals. The sheet 1RM for a (block, lift) is the single distinct non-null `strength_sets.e1rm` where `type` = the lift and `block` = the block. If there are 0 or ≥ 2 distinct values, there is no reference line for that span and a `console.warn` (never a guess).

## 1. Question and primary action
- **Question:** "Bliver jeg stærkere i de tre store løft?" (squat, bench, deadlift).
- **No primary action** (read-only). The controls are the section tabs, the week picker in each card (tap / ←→) and nothing else.
- **Cut:** the RPE trend (no LSRPE yet, see §5d), accessory lifts, per-session detail, block totals, deltas, any "Samlet" placeholder.

## 2. Routes and section tabs (applies to both routes)
- `/analyse` = Cykel (unchanged below the tab strip). `/analyse/styrke` = Styrke, document title `Analyse · Styrke`. A shared `app/analyse/layout.tsx` renders h1 `Analyse`. Skeleton: `app/analyse/styrke/loading.tsx`.
- **`AnalyseTabs`** is a server component with a `current` prop. Each page and its `loading.tsx` render it first, so the strip never flashes and needs no client JS. It sits in the slot where h2 `Cykel` was: 16px under the h1.
  - Markup: `<nav aria-label="Sektioner"><ul>` with two `<a>` links, `Cykel` → `/analyse` and `Styrke` → `/analyse/styrke`. The current one has `aria-current="page"`. No `role="tab"`, no client state. Each panel keeps an `sr-only` h2 (`Cykel` / `Styrke`) right after the nav.
  - **Look: the section word *is* the tab** (Spurt's headline type, not ScreenNav's pill track). Both words are `text-32` Barlow Condensed italic uppercase, `flex-wrap` with a 24px column gap. **Current:** weight 800, `--text`, with a 4px `--text` bar under the word (full word width, `rounded-mark`, 4px below the text). **Other:** weight 700, `--text-muted` (6.0 / 7.2:1), no bar; on hover `--text`. Current = weight + bar + colour, never colour alone. No `--slab`: that is "you are here" in data.
  - Each link has min-height 44px (32 text + 4 gap + 4 bar + 4 padding) and a focus ring of 3px `--focus`, offset 3px, `rounded-control`. At 200% text the words wrap onto two lines with no horizontal scroll.
- **Cykel changes only here:** the `UpdatedLine` moves from under the h1 to **8px under the tab strip** on both routes, because each section has its own source and freshness. The Cykel hero stays 12px under it.

## 3. Layout (390 first; 1280 = the same single column, max 720px)
1. Nav, h1 `Analyse`, tabs (`Styrke` current), `UpdatedLine` 8px under them.
2. **Hero: the lift board** (§4), 12px under the updated line, directly on `--bg` (no card).
3. **Card `Estimeret 1RM pr. uge`** (§5a): legend, block ruler, three panels (Squat, Bænkpres, Dødløft), x labels, then notes.
4. **Card `Tonnage pr. uge`** (§5b): legend, block ruler, three strips, x labels, explainer.
5. The RPE line (§5d), `text-14` muted, no card.

**Fold:** at 390 × 844, the Squat panel, the first panel of card 3, ends at or above 844px. Estimate: the hero ends at y ≈ 500 and the Squat panel at ≈ 780. To keep it there, the explainer and notes sit **under** the x labels, not above the plot.

## 4. Hero: the lift board (the screen's signature)
A three-row scoreboard, one row per lift in SBD order: three big tabular numbers with right-aligned decimal commas, like a meet board.
- **Label line** (`flex-wrap`, space-between): `Bedste e1RM · blok 12` (`text-14` 700 uppercase +0.04em) and `uden for sæson` (`text-14` 600 `--text`). The block is the **latest block** (highest `block_no` that has any `strength_weeks` row), even in a gap week.
- 8px, then a `<dl>`. Each row is a grid `1fr auto`, aligned to the baseline, with 12px between rows and no dividers.
  - **Left (`dt`):** the lift name (`text-20` Barlow 700). Under it, in `text-14` muted tabular, the set behind the number: `140 kg × 5 · RPE 6,5 · uge 1` (`e1rm_load_kg`, `e1rm_reps`, `e1rm_rpe`, and the block week, counted from the block's rows). The next line is `baseret på foreskrevet RPE` when `e1rm_rpe_source = 'prescribed'`, or `logget RPE` when it is `'logged'`.
  - **Right (`dd`):** `174,1 kg` in `text-56` Condensed 800 italic tabular, kg the same size. **Colour encodes provenance:** `--text` when the RPE is logged, `--text-muted` when it is prescribed (still ≥ 6:1). Today all three rows are muted. They turn ink as the user logs RPE: the visible reward for logging. The words on the left carry the meaning, so colour never does it alone.
  - The value is the row of that block and lift with `is_block_best = true`. If there is none: `–` (muted) and the left line `Intet e1RM i blok 12 endnu`.
- **Reference (pack: every number has one):**
  - For each lift, find the latest **earlier block in the same phase** that has an `is_block_best` row for that lift. If one exists, the left column gets a further line, e.g. when the latest block is blok 13: `Blok 12: 171,0 kg` (muted). That is selection, not a delta.
  - If no lift has one, a single line goes under the board instead (`text-14` muted, 60ch): `Blok 12 er den første blok uden for sæson, så der er ingen blok at sammenligne med endnu.` (In sæson: `… den første blok i sæson, …`.) This is the live state today.
- A delta in kg would be arithmetic. It is **not shown** (needs data, §9).

## 5. Charts
**Shared:** one x domain per page, from the first `strength_weeks.week_start` to the current week's Sunday, with one 7-day slot per week. Points and bars sit in their week's slot (points at the slot centre). Both cards use the **WeekStrips construction and interaction** from `AnalyseCharts.tsx`: absolute divs placed with `xCss`, one focusable `role="group"` for the card, tap or pointer to pick a week, ←/→ to step, Esc to close, and a `TipBox`. Generalise `WeekStrips` to N strips and a configurable unit rather than copying it. The e1RM line may be an inline SVG inside the panel (`preserveAspectRatio="none"`, `vector-effect: non-scaling-stroke`). No motion, and no Recharts needed.

**Block ruler** (both cards, an extension of `SeamOverlay` into `BlockOverlay`):
- Each block from `blocks` gets a `--block-fill` span from `start_date` to `end_date` + 7 days (an ongoing block runs to the current week). The span runs behind every panel or strip in the card, as on `/load`.
- Deload weeks (`deload_start` → `end_date`) get the `/load` deload hatch (reuse its pattern).
- In an 18px strip on top, the label `Blok 11` (`text-12` 600) is centred over its span. It is omitted when the span is narrower than the label, using the same `@container` rule as `Ingen ture`.
- Gap weeks between blocks have no fill and no label: they read as "between blocks", not as missing data.
- **Phase change:** a 1.5px solid `--text-muted` vertical rule, the full height of the card's plot stack, at the `start_date` of every block whose `phase` differs from the previous block's.

### 5a. Estimeret 1RM pr. uge
- **Legend** (8px under the title, wraps): `Logget RPE` (a 10px `--text` dot) · `Foreskrevet RPE` (a 7px `--chart-mark` dot) · `Bedst i blokken` (a ring) · `1RM i arket (ikke testet)` (a dashed swatch) · `Deload` (a hatch swatch).
- **Three panels**, stacked with 8px between them. Each has a label row `Squat` (`text-14` 600) and ` kg` (muted), then a 120px plot. Each panel has its own y domain: its e1RM points together with its sheet-1RM values, rounded out to 5 kg, plus 16px of headroom for the value labels. Use 2–3 ticks, a visible axis, and `text-12`. Only the bottom panel shows x labels: month starts (`aug.`, `sep.`, `okt.`), with the year on January and on the first tick when it is outside the current year.
- **Points** (rows with `e1rm_kg`):
  - **logged:** 10px, filled `--text`;
  - **prescribed:** 7px, filled `--chart-mark` ("faded"; 3.5:1 or more on the block fill). Two channels, size and tone, plus the tooltip and the note.
  - The status `pre_log` changes nothing in the point: it is real lifted data (see the note).
- **Line:** 1.5px `--text-muted`, linear through the points of **one block** in week order. It **breaks at every block boundary**, so it never crosses a gap or a phase change. Inside a block it bridges weeks without a point (no zero, no carry-forward mark).
- **Block best:** a ring around the point (2px `--text`, 16px outer). Its value sits above it: `179,6` in `text-12` 600 tabular `--text`. Only block-bests are labelled, so the eye compares block to block within a phase.
- **`1RM i arket (ikke testet)`:** one horizontal dashed line (1.5px `--text-muted`, 6 4) per block span at that block's sheet value. Its value `180` (`text-12` muted) sits at the right end of the span. It is a reference only: never connected to the points and never in a delta.
- **Notes under the x labels** (`text-14` muted, 60ch, 8px apart), each only when it applies:
  1. If any point is prescribed: `Lyse punkter er baseret på foreskrevet RPE. Log RPE på topsættet, så tæller punktet fuldt.`
  2. Always: `Blok 11 er i sæson, blok 12 uden for sæson. Den lodrette streg er faseskiftet: sammenlign blokke i samme fase.` This is built from `blocks`; with more blocks, list them as `Blok 11 er i sæson, blok 12–13 uden for sæson.`
  3. If any row is `pre_log`: `Blok 11 er fra før aktivitetsloggen. Dens uger tæller med, når ugen er slut, ikke når en session registreres.`
  4. Always: `e1RM er et skøn ud fra ugens bedste tunge sæt (kg, reps og RPE), ikke et testet maks.`
- **No e1RM at all for a lift:** the panel shows its label and, in place of the plot, `Intet e1RM endnu for squat.` (`text-14` muted, 120px tall so the panels stay aligned).

### 5b. Tonnage pr. uge
- **Legend:** `Uge med løft` (bar) · `Denne uge` (slab) · `Intet løftet` (zero tick) · `Deload` (hatch).
- **Three strips**, Squat, Bænkpres and Dødløft, each 80px with an 8px gap and its own y axis from 0 (`niceMax`), with the unit `kg`. Only the bottom strip has x labels.
- **One mark per `strength_weeks` row:**
  - `tonnage_kg > 0`: a `--text-muted` bar (slot − 1px).
  - `tonnage_kg = 0`: a **zero tick** (2px `--chart-mark` on the baseline). That covers gap weeks and weeks a lift wasn't trained, so zero weeks are always visible.
  - The current ISO week: `--slab`. This is the **only `--slab` on the page.** It is not used on the e1RM latest point, because in light `--slab` is ink and would read as "logged".
- **Explainer under the x labels:** `Kg × reps for alle løftede sæt af løftet, også varianter.`

### 5c. Week tooltip (both cards, one week, all three lifts)
- **Line 1:** `Uge 39 · 22.–28. sep. · blok 12, uge 1`. Appended when they apply: ` · deload`, ` · før aktivitetslog` (any `pre_log` row in the week), ` · indtil videre` (current week). A gap week reads `Uge 35 · 24.–30. aug. · mellem blokke`.
- **e1RM card, one line per lift:**
  - `Squat: 174,1 kg · 140 kg × 5 · RPE 6,5 foreskrevet`. With a logged RPE: `… RPE 8 logget`. If it is the block best, ` · bedst i blokken` is appended.
  - No `e1rm_kg`, but `sets_lifted > 0`: `Squat: intet tungt sæt med RPE`.
  - `status` null: `Squat: ikke trænet`.
- **Tonnage card:** `Squat: 2.100 kg · 12 sæt`, or `Squat: ikke trænet`.

### 5d. RPE trend: cut
No chart. While no row has `e1rm_rpe_source = 'logged'`, one line follows the tonnage card: `Udviklingen i RPE kommer, når du har logget RPE på topsæt i nogle uger.` It disappears once any logged row exists (then the RPE-trend task is due).

## 6. Copy (exact, beyond §4–5)
| Key | Danish |
|---|---|
| Tabs / sr h2 | `Cykel` · `Styrke` |
| Lift names | `Squat` · `Bænkpres` · `Dødløft` (lower case mid-sentence) |
| Phases | `i sæson` · `uden for sæson` |
| Card titles | `Estimeret 1RM pr. uge` · `Tonnage pr. uge` |
| Updated / stale | `UpdatedLine` strings as `/analyse`, unchanged |
| Page empty | `Der er ingen styrkeuger endnu. Det daglige job læser arket omkring kl. 05.00.` |
| Page error | title `Kunne ikke hente styrkedata`, `describeDataError`, `Prøv igen` → `/analyse/styrke` |
| No e1RM anywhere | in place of the 5a panels: `Der er intet e1RM endnu. Det kommer, når et tungt sæt med RPE er løftet.` |
| Sheet 1RM read fails | the reference lines and their legend item are omitted, and a note is added: `1RM i arket kunne ikke hentes.` |
| Chart error | as `/analyse` (`Grafen kan ikke vises` …) |
| Missing value | `–`, spoken `ikke registreret` |

## 7. Screen-reader text
- **Hero:** `Bedste estimerede 1RM i blok 12, uden for sæson: squat 174,1 kilo, bænkpres 106,2 kilo, dødløft 174,1 kilo. Alle tre er baseret på foreskrevet RPE.` With a mix, name the logged ones: `Squat er baseret på logget RPE, de andre på foreskrevet.`
- **e1RM card:** a figcaption per lift: `Squat: 6 uger med e1RM fra 10. aug. til 28. sep. Bedst i blok 11 (i sæson): 179,6 kilo. Bedst i blok 12 (uden for sæson): 174,1 kilo. 1RM i arket, ikke testet: 180 kilo.` Then one shared sentence: `Faseskift fra i sæson til uden for sæson den 28. sep.`
- **Tonnage:** an `sr-only` table, caption `Tonnage pr. uge`, with columns `Uge` · `Blok` · `Squat (kg)` · `Bænkpres (kg)` · `Dødløft (kg)`, one row per week. Zero weeks read `0`; gap weeks read `mellem blokke` in the Blok column.
- The rulers, hatches, rings, dots and dashed lines are `aria-hidden`. Write "kilo" and "minus" in words.

## 8. States
| State | Treatment |
|---|---|
| Loading | The h1 and the tabs are real (Styrke current), and the card titles are real. Then an updated bar; the hero label line real; three rows with two text bars on the left and a 56px bar (w-1/3) on the right; `--track` blocks of 18 + 3 × 148 and 18 + 3 × 108 + 30. Pulse under `motion-safe` only. |
| `DEV_FIXTURE=empty` | Page-empty EmptyState in place of the hero and the cards. Nav, h1 and tabs stay. |
| `DEV_FIXTURE=error` | Page-error ErrorState in the same place. A failed `blocks` read is a page error too. |
| `DEV_FIXTURE=stale` / real stale | Freshness = max(`strength_weeks.computed_at`). Older than 26 h: `UpdatedLine` in `--warning` with an icon, data unchanged. The fixture ages `strength_weeks`. |
| **`DEV_FIXTURE=lsrpe`** (new, dev only, ignored in production) | Real rows, with `e1rm_rpe_source` set to `'logged'` on the latest **two** e1RM rows per lift. The hero turns ink, the charts mix full and faded points, and the §5d line disappears. |
| `pre_log` (live) | Points and bars drawn normally. Note 3 and the tooltip suffix carry it. |
| Gap weeks (live) | No fill, zero ticks in tonnage, no points, `mellem blokke` in the tooltip. |
| Dark, 200% text | Tokens' dark values. At 200% text the tabs and the hero rows wrap (the `dd` drops under the `dt`), and the legends, notes and tooltips wrap. SVG and tick labels stay 12px (as `/load` §9d). |
| Reduced motion | Nothing animates. |

## 9. Needs data
- **Nothing blocking.** Every value above is a column or a row selection.
- **Optional, later:** a Python-owned `delta_kg` (block best vs the previous same-phase block best), if the user wants a signed number in the hero. Until then the reference value stands alone.

## 10. Acceptance checks (design review + `tester`)
1. **Tabs:** `/analyse` and `/analyse/styrke` both show `Cykel` · `Styrke` as links with exactly one `aria-current="page"`. There is no `role="tab"`, no Samlet, and no pill track. The current tab has weight 800 and a 4px bar. At 200% text they wrap with no horizontal scroll. Below the tabs, Cykel is unchanged except that the updated line now sits under the tabs.
2. **Hero:** three rows in SBD order. Each value is the `is_block_best` row of the latest block and is the largest text (56px). Today all three are `--text-muted` with `baseret på foreskrevet RPE`. Under `lsrpe` the logged rows are `--text`. There is no delta number.
3. **Fold:** at 390 × 844, light and dark, the Squat panel ends at or above 844px.
4. **e1RM:** the point count per lift equals the rows with `e1rm_kg` (live: Squat 6, Dødløft 5, Bænkpres 1). Prescribed points are 7px and faded, logged points 10px and ink. No line crosses the gap between blok 11 and blok 12. The block-best rings and labels match `is_block_best`. The phase rule sits at blok 12's start. The dashed `1RM i arket (ikke testet)` line sits at 180 / 102,5 / 180.
5. **Tonnage:** every week × lift has a bar or a zero tick, including the two gap weeks. The current week is `--slab` and is the only slab on the page. The deload weeks are hatched.
6. **Honesty:** notes 1–4 appear as specified. The `pre_log` weeks look identical to `lifted` weeks apart from text. The RPE line is present today and gone under `lsrpe`.
7. **States:** `empty`, `error`, `stale` and `lsrpe`, plus 1280, dark and 200% text, screenshotted via `run-web`. Every §4–6 string is verbatim, with no English UI string apart from the lift name `Squat`.
