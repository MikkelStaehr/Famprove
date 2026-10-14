# Træning (`/`) – visual reset (2026-10-14)

Supersedes the visual parts of `traening.md` and all of `instrument-traening.md`. Behaviour, copy, taps, set log, read-back and every state in `traening.md` stay as they are. Reference: `design/reference/Kurve.dc.html` (C, "I dag" card + 7-day box style), `Main.dc.html` (A, header + week list). Tokens, radii, fonts, icons and component names come from DESIGN.md. Where this spec and the mockup disagree, the mockup wins. Where the mockup and a guardrail disagree, the guardrail wins.

## 1. Question and primary action
"What do I train today, and how fresh am I for it?" One primary action: **Begynd træning / Fortsæt træning** in the InverseCard. It is the only light surface on the page, so it is dominant without extra weight.

## 2. Layout at 390 (top to bottom, page padding 20 16, card gap 12)
1. **Header** (A): `h1` "Træning" Geist 22/600, −0.01em. Under it MonoCaption 12 muted: "ons. 14. okt · opdateret 05.00" (`formatDay(today)` + UpdatedLine). Stale: the second half becomes "forældet · opdateret 13. okt 05.00" and the existing staleNote shows as a WarningLine under the header. No settings button (there is no settings page).
2. **InverseCard "I dag"** (C, radius 20, padding 18, gap 12, `--inverse-bg`). Variants are in §3.
3. **Form card** (Card, radius 20, padding 16). Row 1: MonoCaption "FORM (TSB)" left, ZonePill right (zone word in zone colour, 1px border at 40 % of the zone colour, fill at 8 %). Row 2: the TSB in Geist Mono 500 `text-28` in the zone colour (C's half-card size; review 2026-10-14) (`formatSigned`), then the hint `TSB_HINT[zone]` Geist 15 `--text`. Row 3: C's mini ZoneBar (full card width, 14px tall, active segment 4px in the zone colour, the others 3px at 35 %, a 2px `--text` marker at `position(tsb)`; aria-hidden). Not today's row: "Tallet er fra man. 13. okt." Geist 13 `--text`. Zone null: number in `--text`, "Zone ikke beregnet." muted, no pill. No TSB: "Form (TSB) er ikke beregnet endnu." muted, no bar.
4. **Ride card(s)** when a ride is planned today and strength holds the InverseCard (state "both"). Card radius 22, padding 20. Head: bike icon 18 + SectionTitle "Cykel · {ride.name}" + MonoCaption right "I ALT 1:00 T". Notes Geist 14 `--text`. "Mål ud fra FTP 230 W" Geist 13 muted. Steps as ListRows: label Geist 15/500 over the duration in Geist Mono 13 muted | right: watts Geist Mono 500 20 + " W", % FTP Geist Mono 12 muted under it. Repeat groups: MonoCaption "GENTAG 4 GANGE", then the inner rows indented 12px behind a 1px `--axis` left rule. WarningLine and EmptyState copy unchanged.
5. **Sæt card** (StrengthCard, state "next"; Card radius 22, padding 20, gap 16).
   - Head: SectionTitle "Session 2 · sæt" left. Right: SetCount in Geist Mono, "7 / 19" with the 7 in 500 `--text` and "/ 19" muted. Under it "2 sprunget over" (Geist Mono 12 muted) when skipped > 0.
   - **Progress strip** (replaces SetBarcode, same information): one segment per set in session order, height 6, gap 2, radius 2. Done `--text`, skipped `--shade-2`, open `--track`. aria-hidden; the existing sr sentence speaks it.
   - Week 1 note, Geist 13 muted, unchanged copy.
   - **Groups per sheet row**, in the existing order and with the existing `showName` / `dividerBefore` rules. Group head: name Geist `text-16`/500 (muted when `nameMuted`). Then one Geist Mono 500 `text-24` line (DESIGN.md glance size, review 2026-10-14): reps and prescribed RPE ("5 × 3   RPE 7"), muted when `closed`. Then two value pairs: MonoCaption "FORSLAG" over Geist Mono 16 "102,5 kg" + "(begrænset)" Geist 13 muted. MonoCaption "SIDSTE UGE" over Geist Mono 16 "100 × 3". The suggestion's words, or "Intet logget sidste uge", go in Geist 14 muted. No italics: the captions say which number is computed.
   - **Set rows** as ListRows: 1px `--border` top border, min-height 52, the whole row is the `<label>` with a native checkbox (as today). Columns: tick (24px circle in a 44 × 44 target) | "Sæt 1 af 3" Geist 15 | right status. Tick open: 1.5px `--shade-2` ring. Done: an `--inverse-bg` disc with a 1.5px `--inverse-text` check. Skipped: a `--shade-2` ring with a 1.5px dash. Right status: done "kl. 10.42" Geist Mono 12 muted; skipped "sprunget over" Geist Mono 12 muted. The next set shows "NÆSTE" as a Geist Mono 11/500 pill (`--text`, 1px `--shade-2` border, radius 999, padding 3 8), and its row text is `--text`. A row that is done or skipped is muted. The NÆSTE group keeps a 2px `--text` bar on its left edge at −12px, full group height.
   - SaveNotes (WarningLine + "Gem igen" as a secondary button) and the footnote (Geist 13 muted) unchanged in copy.
6. **Uge card** (Card, radius 20, padding 16, gap 12; A's list): head "Uge 42" Geist 16/500 left, MonoCaption right "12.–18. OKT". It replaces WeekColumns and DoneList and carries the same information. One ListRow per strength session this ISO week, in session order:
   - Done: day "Tir" (Geist Mono 12 muted, width 36) | barbell 18 `--text` | "Styrke · session 1" Geist 14 + under it, muted 13, ActivityWords ("Styrke · 52 min") | right Geist Mono 14 "19 sæt" + a done check 16. An extra session: "Ekstra session" + right "ikke i programmet" muted.
   - Current (today): day "Ons" in `--text` | barbell | "Styrke · session 2" | right "I DAG" Geist Mono 11 `--today`. This is the page's only orange.
   - Future: day "—" muted (a session has no date until it is done) | barbell muted | "Styrke · session 3" muted | right "plan" Geist Mono 12 muted.
   - all_done: every row is done, then the WeekNote in Geist 15/500 + 14: "Alle 3 sessioner er udført i denne uge." / "Næste uges session 1 vises her fra man. 19. okt." no_program: no rows, the note "Intet styrkeprogram i denne uge." + the existing body.
   - The week sentence (`weekSentence`) stays as sr-only text after the head.
7. **TabBar** (DESIGN.md): barbell Træning (active), trend Belastning, bars Analyse.

## 3. InverseCard variants (C's exact values)
Row 1: MonoCaption 11 `--inverse-muted` "I DAG · ONS 14" (upper-case `formatDay`), icon 20 `--inverse-text` right (barbell or bike). Title Geist 20/600, −0.01em. Summary Geist 13 `--inverse-muted`. Button: 48px tall, radius 14, `--inverse-text` fill, `--text` label Geist 15/500 + arrow-right 18.

| Case | Title | Summary (Geist 13) | Second line (Geist Mono 11 `--inverse-muted`) | Button |
|---|---|---|---|---|
| Strength next, nothing done | "Styrke · session 2 af 3" | "Dødløft, Dips, Pulldown og 3 øvelser mere · 19 sæt" | "BLOK 12 · UGE 3" | Begynd træning → |
| Strength mid-session | same | "… · 7 af 19 sæt udført" | same | Fortsæt træning → |
| Strength finished | "Alle sæt er klaret." | "Husk at logge kg i arket. Sessionen tæller som udført efter næste opdatering." | same | none |
| Ride only (kind "ride") | "Cykel · {ride.name}" (bike icon) | "I alt 1:00 t · mål ud fra FTP 230 W" (no FTP: "mål i % FTP") | none | none; the steps follow in the ride card (§2.4) directly below the form card |
| Rest (kind "rest") | "Hviledag" / "Færdig for i dag" (`doneToday`) | "Intet planlagt i dag." / "Ikke mere planlagt i dag." | "NÆSTE TUR · I MORGEN · TOR 15", then ride names in Geist 13 | none |
| Rest, no ride within the lookahead | same | same | "Ingen tur planlagt de næste 28 dage." (from `lookaheadDays`) | none |

Summary names: the distinct exercise names of `session.exercises` in sheet order, runs merged, the first 3 as written in the sheet, then "og N øvelser mere"; the set total is `view.progress.total`. One name: "Squat · 5 sæt". The Begynd/Fortsæt handler, the `beginUndone` focus + status line and the flush-then-push are unchanged. Two rides today: the title is the first ride, the summary is "+ 1 tur mere", and every ride gets its own ride card.

## 4. Desktop (≥ 1024px)
Max width 1200, centred, padding 32. Grid `grid-cols-[7fr_5fr]`, gap 16, `align-items: start`. Left column: InverseCard, then the Sæt card (or ride card(s) when there is no strength). Right column: Form card, ride card(s) (when the strength card is on the left), Uge card. Header spans both columns. 640–1023: one column, max width 640, centred. Tab bar placement on desktop follows DESIGN.md. The list text keeps its 45–75 character measure because the cards cap at their column width.

## 5. States (DEV_FIXTURE names)
- **loading**: header + three Card skeletons at the final heights (InverseCard 196, Form 132, Sæt 360), `--card` fill, no shimmer under reduced motion.
- **empty** (`empty`): the InverseCard in the rest variant and the Form card's "Form (TSB) er ikke beregnet endnu."; the Uge card shows the no_program note.
- **error** (`error`): form and plan fail independently, as today. A plan error replaces the InverseCard + Sæt + Uge cards with ErrorState in a Card (title "Kunne ikke hente dagens træning", what/why/next unchanged, the retry is a secondary button). A form error puts ZoneBarError in the Form card.
- **stale** (`stale`): the header caption says "forældet", and the WarningLine with the staleNote shows under the header. Taps still work.
- **midsession** (`midsession`): the Fortsæt variant, a partly filled strip, mixed tick states, NÆSTE on the first open set.
- **save failed**: SaveNotes in the Sæt card, the tick stays.

## 6. Data check (no new data, no new calculation)
| Shown | Status | Source |
|---|---|---|
| Day caption "ONS 14" | exists | `today` → `formatDay` |
| Session n af N, block, week | exists | `StrengthSession.session / of / block / week` |
| Exercise names in the summary | exists | `session.exercises[].name` (merged runs) |
| "3 accessories" (mockup) | **missing**: category is not in ExerciseView | substituted by "og N øvelser mere" (a count of names) |
| Total / done / skipped sets | exists | `view.progress` |
| TSB, zone word, hint, zone colour | exists | `TrainingHeader.tsb / zone`, `TSB_HINT` |
| Mini zone bar marker | exists | `zone-scale.position()` (geometry only) |
| Ride name, total time, FTP, steps | exists | `RideView` |
| Next ride date and names | exists | `NextDay` |
| Week rows: done date, activity words, extra | exists | `StrengthWeek.done[]` |
| Sets per session | exists | `WeekColumn.sets` |
| Week date range "12.–18. okt" | exists | ISO week of `today` (formatting) |
| Future session weekday | **missing**: no date until done | shown as "—" + "plan" |
| C's 7-day box row (rides per day, rest days) | **missing**: Træning has no done rides and no weekday for planned strength | dropped; the Uge list carries the sessions |
| Uge TSS "72 / ~430" | not on this screen | dropped; Belastning shows it |

## 7. Accessibility
- Text contrast ≥ 4.5:1 for `--text`, `--text-muted`, `--inverse-muted` on their surfaces, and for `--today` 11px "I DAG" and every zone colour used as text (number, hint, pill) on `--card`. Each pair is computed by `ui` at render and listed in the PR; a pair that fails moves to `--text` with the colour kept on the mark only.
- The tick ring (`--shade-2`), the button fill on the InverseCard and the zone marker are ≥ 3:1 against their surface (computed by `ui`). The future row's muted icon is not the only cue: "plan" says it.
- Zone colour always with the zone word. Done, skipped and open differ in shape (disc + check, ring + dash, ring), not only in colour.
- Targets: each set row ≥ 44px tall with a 44 × 44 tick hit area; the button 48px; tab items ≥ 44px.
- Focus: `--focus` ring 2px at 2px offset on every control; on the InverseCard the button's ring uses `--inverse-text` so it shows on the light card.
- Headings: h1 Træning; h2 per card ("I dag", "Form", "Cykel", "Sæt", "Uge 42"). The "I dag" caption is the h2, set in MonoCaption style.
- Reduced motion: no transitions beyond 120ms colour/opacity; none under `prefers-reduced-motion`.

## 8. Acceptance (tester, 390 and 1280, `pnpm dev` + DEV_FIXTURE)
1. At 390 the first card under the header is the light InverseCard. Its caption reads "I DAG · <day>". With a session next it shows the title "Styrke · session n af N", the summary with names and the set total, "BLOK x · UGE y", and a 48px "Begynd træning" button with an arrow.
2. With `midsession` the button reads "Fortsæt træning" and the summary says "7 af 19 sæt udført" (the fixture's counts). Tapping it opens `/fokus?view=set`, as before.
3. When every set is done or skipped, the InverseCard shows "Alle sæt er klaret." and no button.
4. With no ride and no session left, the InverseCard shows "Hviledag" (or "Færdig for i dag") and the next ride or the lookahead sentence, with no button.
5. The Form card shows the TSB number and the zone pill in the same zone colour, the zone word, and the zone's hint. No zone colour appears without its word.
6. Every set row is ≥ 44px tall. Tapping anywhere on it toggles the tick. Space toggles it from the keyboard with a visible focus ring. The tick survives a reload.
7. Exactly one set row shows "NÆSTE" while any set is open.
8. The Uge card lists this week's sessions: done ones with day + activity words + a check, today's with "I DAG" in orange, later ones with "—" and "plan". Orange appears nowhere else on `/`.
9. Fonts: every digit (TSB, counts, kg, reps, times, dates in captions) renders in Geist Mono, and all other text in Geist. The font check finds no system font.
10. At 1280 the content is ≤ 1200px wide in two columns: InverseCard + Sæt on the left, Form + Uge on the right.
11. `empty`, `error`, `stale` and loading render as in §5. A plan error never shows "Hviledag".
12. Card radii: InverseCard 20, Form/Uge 20, Sæt/ride 22. Page `--bg`, cards `--card` with a 1px `--border`.
