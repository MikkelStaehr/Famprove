# Spec – Træning (`/`) and Fokus (`/fokus`)

Owner: design-lead · 2026-10-12, replaces `today.md` (Today / "I dag", 2026-09-28 → 2026-10-12; ride card, rest card, §3a sessions, freshness and states carried over) · for `ui`. Contract: `DESIGN.md` Part A (guardrails) and Part B (Spurt: tokens, type, NÆSTE slab, segmented progress, zone flag). `/load` has its own spec-lite: `design/specs/load.md`.

**Language:** all UI copy is Danish (§6). Never translate exercise names, sheet cells, block tab names, activity/ride names, step labels from `planned_sessions`, Python `problem` strings, or TSS / W / FTP / CTL / ATL / TSB / RPE / e1RM. Formats: dates `ons. 30. sep.` (Intl `da-DK` weekday abbreviations `man. tirs. ons. tors. fre. lør. søn.`, no override), times `kl. 05.03`, decimal comma (`142,5 kg`), U+2212 minus, en-dash ranges without spaces (`225–250 W`). `<html lang="da">`. "Today", "I dag" and "today" disappear from every visible string and title (the code may keep its names).

**Decided here (2026-10-12, user away; main session may overrule):** see §10 at the end.

## 1. Questions and primary actions
| Screen | Question | One primary action |
|---|---|---|
| `/` Træning | "What is my session, and how fresh am I for it?" | **Begynd træning** (or **Fortsæt træning**), one ink pill above the fold. The per-set ticks are a secondary, direct way to record a set. Ride and rest days have no action. |
| `/fokus` Fokus | "What do I lift now?" | **Udført** in the set view, **Til næste sæt** in the rest view, **Tilbage til Træning** when finished. Exactly one per view state, so Fokus needs no override of Part A's "one primary action per screen". |

**Cut from both:** writing kg (kg is logged in the sheet), charts, CTL/ATL, history, muscle-group `type`, ticking ride steps, the zone bar's bands on Træning (the zone flag stays, §3.1), and the sheet's own kg on the set (§10 D3).

## 2. Routes, nav, titles
- `/` renders Træning on every date. "Today" = the Europe/Copenhagen date at request time.
- `/fokus` renders Fokus for the next undone strength session (session k + 1 of N, the same session Træning shows). Not a nav tab. Reached by Begynd/Fortsæt; a reload or a direct visit stays in Fokus.
- **`ScreenNav`** (root layout, `<header>` before `<main>`; since 2026-10-13 a fixed **bottom bar on phone** and a static top bar from `lg`, DESIGN.md Part A "Layout: phone and desktop"; the title now sits 12px from the top on phone): `<nav aria-label="Hovedmenu">` with **Træning** → `/`, **Belastning** → `/load`, **Analyse** → `/analyse`. Look unchanged (Part B). **Not rendered on `/fokus`**: Fokus is a full-screen mode whose only exit is "Afslut" (a route group or layout split is `ui`'s call).
- Document titles: `Træning` on `/`, `Fokus · Træning` on `/fokus`, `Belastning` on `/load` (unchanged).

## 3. Træning (`/`) at 390px, top to bottom

### 3.1 Page header (every day)
1. `h1`: "Træning" in `text-44` display (Condensed 800 italic, uppercase via CSS; the source text stays "Træning"), the date `tirs. 13. okt.` in `text-16` Barlow 500 `--text-muted` on the same baseline, 12px after it, with an `sr-only` ", " between.
2. Updated line (`UpdatedLine`), 4px under the title. Copy §6.
3. **Form flag + hint**, 12px under the updated line, one `flex-wrap` row, gap-x 12px, gap-y 4px, items centred:
   - **Form flag** = the ZoneBar flag on its own (Part B › Zone bar › Flag, compact size, no bands, notch or marker): a `rounded-pill` in `--slab`, padding 4px 12px, 32px high, holding "TSB" (`text-14` 700 uppercase `--on-slab-muted`), 6px, the signed value (`text-24` Condensed 800 italic tabular, `−24` with U+2212, `0` unsigned), 8px, the 12px zone swatch with its 1.5px `--on-slab` ring, 6px, the zone name (`text-14` 700 uppercase `--on-slab`). `aria-hidden`; the sr sentence carries it.
   - **Hint** (`text-16` 500 `--text`): one line per zone, §6. At 390px it usually wraps under the flag; never truncated.
   - **Latest row is not today:** a third item, `text-14` 600 `--text` (not muted): `Tallet er fra søn. 27. sep.`
   - **sr sentence** (`sr-only`, before the flag): `Form minus 24 TSS per dag, optimal. Forvent at ligge lidt under.` (+ ` Tallet er fra søndag 27. september.`). Sign words as the ZoneBar sentence.
4. **Session block** (only when the strength card is in state (a) or (b) of §5, i.e. a session is open), 16px under the form row, `<section aria-labelledby="session-heading">`:
   - `h2#session-heading` `text-20` 700: `Styrke: session 2 af 3`
   - `text-16`: `{block tab name as written} · uge {n}`, e.g. `Program - blok 12 (offseason) · uge 3`
   - **Primary button**, 12px under: a real `<button>` (it writes "begin", §7) that then navigates to `/fokus`. Full width, `min-h-14` (56px), `rounded-pill`, `--text` fill, `--bg` text, `text-24` Condensed 800 italic uppercase, centred, with a 24px → arrow (inline SVG, `aria-hidden`) after the words. Label: **Begynd træning** when no set of the session is done or skipped, else **Fortsæt træning**. When every set is done or skipped, the button is replaced by the finished note (§5 (a′)).
   - Why `--text` and not `--slab`: `--slab` means "you are here" (the NÆSTE group sits right below it); the ink pill is the same "chosen/go" language as the nav's current tab. It is the largest filled shape above the fold in both themes (16.1 / 17.1:1 text).

### 3.2 Content order
Ride card(s) planned for today, then the Strength card (always), then the Rest card (only when no ride today **and** k ≥ N). Unchanged; the primary action no longer depends on it, because it sits in the header.

### 3.3 Strength card (`Card id="strength"`)
- **Title** "Styrke" (`text-32` display 800 italic, uppercase via CSS). **Action:** `**0** af 24 sæt udført` (count `text-24` display, rest `text-16` 600 tabular). With skips, a second line `text-14` muted: `2 sprunget over`. All sets done or skipped: `Alle sæt klaret` (+ the skipped line). Not a live region.
- **Segmented progress** 12px under the head (Part B), **one segment per set, by position** (not by count, since skips sit in between): done `--slab`; skipped `--track` with a 2px `--text-muted` horizontal bar centred in it (shape, not colour); open `--track`. Gap 4px, or 2px when the session has more than 30 sets. `aria-hidden`.
- **Done list** (16px) and identity are as before: the done list per §5 stays in the card. The session line and identity line moved to the header (§3.1.4) and are **not repeated** here.
- **Week-1 note** (week 1 only, `text-14` muted), 12px under the done list or progress.
- **List** `<ol aria-label="Øvelser">`, 12px under. One `<li>` per **sheet row** ("set group"), in sheet order; inside it an `<ol aria-label="Sæt">` with one tick line per set. Consecutive sheet rows with the same trimmed name form a **run**.

**Set group anatomy** (grid `28px 1fr`, gap-x 12px; the group's text sits in column 2):
1. **Name line** (`text-20` 700): only on the first group of a run, and always on the NÆSTE group. Continuation groups carry the name `sr-only`.
2. **Prescription line** (`flex-wrap`, gap-x 16px, gap-y 4px, **`text-32` Condensed 700 upright tabular**, as written): reps with their word (`5 reps`, `8 - 12 reps`) and the prescription (`RPE 7`, `RPE 5 - 7`, `-12.5%`). The set count is no longer here: each set has its own line. A missing cell renders nothing.
3. **Reference line** (`text-20`, `flex-wrap`, gap-x 16px, no "·" glyph so a wrap never starts with one):
   - `Forslag` (400 `--text-muted`) + `142,5 kg` (Barlow 700 `--text`). Null: `Intet forslag` + the reason (§6), all muted.
   - `Sidste uge` (muted) + `140 kg` (500 `--text`) / `kropsvægt` / `kropsvægt + 10 kg`. Null: `Intet logget sidste uge`, all muted. Week 1: item absent (the week-1 note covers it).
   - The suggestion is **never** in the 32px prescription line: as written = big, the app's estimate = reference size with its label. `0 kg` never appears.
4. **Set lines**, 4px under the reference line, flush (no gap between them). Each is a `<label>` wrapping a native checkbox: `min-h-11` (44px), padding 8px 4px, grid `28px 1fr auto`, gap-x 12px, items centred:
   - the 28px check (Part B), centred on the line;
   - `Sæt 1 af 2` in `text-20` 600, numbered across the run (§10 D11);
   - right-aligned status, `text-14` muted tabular: done `kl. 18.42` (its `ended_at`); skipped `sprunget over`; open nothing; the NÆSTE set shows the **Næste** tag here instead (Part B tag style).
   - **Accessible name** (one `sr-only` sentence; visual text `aria-hidden`): `Squat, sæt 1 af 2, 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg` (+ `, sprunget over` / `, udført kl. 18.42` / `, næste`). Null suggestion: `, intet forslag`. Null last week: `, intet logget sidste uge`. SR rewrites " - " → " til ". Every name starts with the exercise name.
   - Checked = done. Skipped is unchecked with the skip mark and its words.
5. Spacing: 12px between groups of one run; between runs a 1px `--border` divider with 12px above and below. The slab hides the dividers it touches.

**Check marks** (28px circle):
- Open: 2.5px `--text-muted` ring.
- Done: `--slab` fill + `--slab-mark` ✓ (unchanged).
- Skipped: 2.5px `--text-muted` ring with a 12 × 2.5px `--text-muted` bar across the centre (a "minus"). Shape + words carry it.
- Inside the NÆSTE slab: open ring 3px `--slab-mark`; done = `--slab-mark` fill with a `--slab` ✓; skipped = `--slab-mark` ring and bar.
- Done and skipped lines: text `--text-muted` (`--on-slab-muted` inside the slab). A group's prescription and reference lines turn muted only when all its sets are done or skipped; a run's name only when all its sets are. No strike-through, no reordering, lines never move.

**NÆSTE slab:** the **set group that holds the first open set** in document order (skipped sets are not open) is the slab: `--slab` fill, `--on-slab` text including the prescription, `--on-slab-muted` for labels ("Forslag", "Sidste uge"), bleeds 8px each side (margin-inline −8px, padding 12px), 8px margin-block, `rounded-control`. The **Næste** tag sits on that first open set's line (right column), not on the name line. Why the whole group and not one 44px line: the slab must carry what you need to load the bar (reps, RPE, kg), and a lone "Sæt 2 af 2" on a slab would not. No slab when no set is open.

**Tick behaviour** (writes, §7): tapping an open set marks it done; tapping a done set reopens it (undo); tapping a skipped set marks it done. The tick shows within 100ms and never waits for the save. Space toggles from the keyboard. Focus: 3px `--focus` outline, 3px offset, around the set line (`label:has(:focus-visible)`), `rounded-control`.

- **Footnote** after the list (`text-14` muted), two sentences, §6.
- **Save failed:** a `WarningLine` under the list, §5 (s).

### 3.4 Ride card, Rest card
Unchanged from `today.md` (moved here verbatim in §8).

### 3.5 Above the fold at 390 × 844 (and 390 × 660, real iPhone Safari)
Nav ends ≈ 56 · title ≈ 72–116 · updated line ≈ 120–140 · form row ≈ 152–208 (flag 32 + wrapped hint 24) · session block ≈ 224–274 · **button ≈ 286–342** · first card ≈ 358.
- **Guarantee:** the primary button is fully visible at 390 × 660 on every day with an open session, including ride days (it is above the ride card). Since the bottom bar (2026-10-13) the limit is 660 − `--bottom-bar` = 592px; the top strip's 68px is gone, so the button ends ≈ 274px.
- **Desktop (from `lg`):** the page is one column of `max-w-phone` (560px), left-aligned with the top bar; Fokus is the same width, centred. Nothing else changes.
- Strength-only day: the card head + progress end ≈ 430; the first set group (NÆSTE, ≈ 200px for 2 sets) ends ≈ 650 at 844. The rest scrolls; that is accepted, because the gym view is now Fokus.
- If a build misses the button guarantee, cut in this order: title→date gap, form row gap-y; never shrink the button or the prescriptions.

## 4. Fokus (`/fokus`) at 390px
> **2026-10-13: the pause screen is rebuilt in [`fokus-pause.md`](fokus-pause.md)** (warm-up, felt-RPE and reps, recommended rest, next-set card, footer). It replaces §4.3 and amends §4.1, §4.2's suggestion line, §4.4, §4.7, §6 and §7. Where they differ, `fokus-pause.md` wins.
> **2026-10-13: Fokus is the pilot of the Instrument direction** ([`fokus-instrument.md`](fokus-instrument.md)). It replaces every visual rule here (slab, Condensed italic, pills, segments); structure, copy and behaviour stay as written.

Full-screen: no ScreenNav, no page title text, no zone flag. Page gutter 12px. `h1` is `sr-only` "Fokus". Readable at 60–80 cm: **reps and kg are `text-56`, the largest things on the screen** (≈ 6.4mm cap height on a 390pt iPhone, ≈ 30 arc-minutes at 70 cm; text-32 is ≈ 18').

### 4.1 Top bar (every view state; fixed layout so nothing jumps)
1. Row, 12px from the top, `justify-between`, items centred:
   - **Afslut**: a `<a href="/">`-style `next/link` (navigation, no write), `min-h-11`, `rounded-pill`, padding 0 16px, 2px `--text-muted` border (≥ 3:1 control border), `text-16` 600 `--text`.
   - Count: `**7** af 24 sæt udført` (count `text-24` display, rest `text-16` 600 tabular). With skips, `· 1 sprunget over` follows on the same line, wrapping under it if needed.
2. **Segmented progress**, 12px under: identical to the strength card's (by position, done / skipped / open). 8px high. `aria-hidden`.
3. **Last-tap line**, 8px under, a reserved 44px row (empty when there is no tap yet, so the card never moves): `text-16` `--text-muted`, `Squat · sæt 1 udført kl. 18.42` or `Squat · sæt 2 sprunget over`, then a **Fortryd** button (`text-16` 600 `--text`, underline 1px offset 3px, `min-h-11`, padding-inline 8px). Fortryd undoes the latest done or skip of this session; tapping it again walks one tap further back. After an undo the line shows the tap before it, or empties.
4. Stale (> 26 h) or save failed: a `WarningLine` takes this row's place (it may be taller; then the card moves once, which is acceptable for an error). §5 (s), §6.

### 4.2 Set view (the current set: the first open set)
**Set card**, 8px under the last-tap row: `--slab` fill (it is "you are here", blown up), `--on-slab` text, `rounded-card`, padding 24px 16px 16px.
1. Exercise name as written, `text-32` Condensed 800 italic, uppercase via CSS, wraps (no truncation). `h2`.
2. `Sæt 1 af 2`, `text-20` 700, 4px under, numbered across the run (§10 D11).
3. 16px. **Reps + prescription** row (`flex-wrap`, baseline, gap-x 16px): reps as written in **`text-56` Condensed 700 upright tabular** followed by ` reps` in `text-32` Condensed 700 (`5 reps`, `8 - 12 reps`), then the prescription as written in `text-32` Condensed 700 (`RPE 7`, `RPE 5 - 7`, `-12.5%`).
4. 16px. **Kg block:** a label line `text-14` 700 uppercase +0.04em `--on-slab-muted`, then the figure:
   - Suggestion present: label `Forslag`; `142,5` in **`text-56` Condensed 800 italic tabular** + ` kg` in `text-32` Condensed 800 italic (U+00A0 between). **Italic = computed by the app; upright = as written in the sheet** (the same rule the zone-flag value already follows). So the suggestion can never pass for a prescription.
   - Suggestion null, last week present: label `Sidste uge`; the last-week kg in `text-56` Condensed 700 **upright** (it is what you logged) + ` kg` `text-32`; under it `text-16` `--on-slab-muted` the reason, e.g. `Intet forslag til %-sæt`.
   - Both null: label `Kg`; `Intet forslag` in `text-32` Condensed 700 `--on-slab-muted`; under it the reason (`text-16`).
5. **Last-week line** (`text-20`), 4px under the kg block, only when the suggestion is shown: `Sidste uge` (`--on-slab-muted`) + `140 kg` (600). Null: `Intet logget sidste uge` (muted). Week 1: `Uge 1 i blokken: ingen sidste uge` (muted).
6. 24px. **Udført** button inside the card: full width, `min-h-16` (64px), `rounded-pill`, **`--slab-mark` fill with `--slab` text** (the NÆSTE tag's colours: volt on ink in light, ink on volt in dark, 16.2:1), `text-32` Condensed 800 italic uppercase "Udført" with a 28px ✓ (inline SVG) before it.

**Spring over**, 16px under the card, centred: `min-h-12` (48px), `rounded-pill`, padding 0 24px, 2px `--text-muted` border, `text-16` 600 `--text`. Secondary by size, fill and position.

Height check (390 × 660): top bar to last-tap row ends ≈ 132; card ≈ 140–540; Spring over ≈ 556–604. Everything fits without scrolling.

### 4.3 Rest view (after Udført, until "Til næste sæt")
Same top bar; the last-tap line reads `Squat · sæt 1 udført kl. 18.42` + Fortryd.
**Rest card** in place of the set card: `--surface` (not slab: you are between sets), `rounded-card`, padding 24px 16px 16px.
1. `Pause` (`text-14` 700 uppercase `--text-muted`).
2. The timer, **`text-56` Condensed 800 italic tabular**, counting up from the last done tap: `0:07`, `1:42`, `12:05`, `1:02:10`. Updates once a second; the digits never animate. `role="timer"`, `aria-live="off"`, `aria-label="Pause"`.
3. 16px. **Next set, small**: a mini slab (`--slab`, `--on-slab`, `rounded-control`, padding 12px) with the **Næste** tag (Part B) on its first line next to `Squat · sæt 2 af 2` (`text-20` 700), then `5 reps · RPE 7 · forslag 142,5 kg` (`text-16` 500; here "·" is fine, the line is short and `flex-wrap` is off: it wraps as text). Null suggestion: `· intet forslag`. When the next set is the last of the session, the same; when there is no next set, the finished view replaces the rest view.
4. 24px. **Til næste sæt** button: full width, 64px, `rounded-pill`, `--text` fill, `--bg` text, `text-32` Condensed 800 italic uppercase, → arrow after. UI only, no write: the next set's `started_at` was written by Udført. It switches to the set view.
- No Spring over in the rest view (there is no current set to skip until you continue).

### 4.4 Finished view (no open set left)
- Top bar as before (bar full of done/skipped segments; Fortryd still undoes the last tap).
- **Finish card** (`--slab`, padding 24px 16px 16px): `Session 2 er klaret` in `text-44` display (uppercase via CSS); `22 af 24 sæt udført · 2 sprunget over` (`text-20` 700; without skips `Alle 24 sæt udført`); `Start kl. 17.58 · sidste sæt kl. 19.10` (`text-16`, from the log; omit a part that has no time); `Husk at logge kg i arket.` (`text-20` 700).
- **Tilbage til Træning** button: full width, 64px, `--text` fill, `--bg` text, `text-32` Condensed 800 italic uppercase. Navigates to `/`.

### 4.5 Reload and entry rules
- Fokus is rebuilt from the set log on every load: current set = the first open set; rest view if the session's latest tap is a done tap and there is still an open set (the timer counts from that tap's time); finished view if no set is open.
- Entering via Begynd/Fortsæt opens the set view at the first open set.
- **Screen wake lock:** while Fokus is visible, request `navigator.wakeLock.request("screen")`; release it on Afslut, Tilbage, and `visibilitychange` to hidden; re-request on visible. Unsupported or refused: do nothing, show nothing (enhancement only). Reason: between sets the phone otherwise locks and the timer is lost from view.

### 4.6 Fokus motion
- Press: Udført, Til næste sæt and Spring over scale to 0.97 on `:active` (120ms).
- View change (set ↔ rest ↔ finished): the card cross-fades, opacity only, 180ms `ease-out`. Nothing slides; the top bar never moves.
- Progress: the touched segment fills in 120ms.
- Never animated: the timer digits, kg, reps.
- `prefers-reduced-motion: reduce`: all 0ms, no press scale.

### 4.7 Fokus accessibility
- Focus management: after Udført, focus moves to **Til næste sæt**; after Til næste sæt and after Spring over, to **Udført**; after Fortryd, to **Udført** (the undone set is current again); entering the finished view, to **Tilbage til Træning**. Focus never lands on `<body>`.
- One `sr-only` `role="status"` (polite) region announces each change once: `Squat, sæt 1 udført. Pause.` · `Squat, sæt 2 af 2: 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg.` (on entering a set view) · `Sæt 2 sprunget over.` · `Fortrudt: Squat, sæt 1 er åben igen.` · `Sessionen er klaret.` The timer is never announced on its own.
- All controls are `<button>` (Afslut and Tilbage are links), ≥ 44px; visible 3px `--focus` outline, 3px offset. `--focus` on the slab is invisible (ink on ink in light, volt on volt in dark), so **inside a slab the focus outline is `--slab-mark`** (16.2:1 against the slab).
- 200% text: no horizontal scroll; `142,5` and `kg` may wrap onto two lines (`[overflow-wrap:anywhere]` on the figure, like today's §3b), the reps row wraps.

## 5. States
**Træning strength card** (N = sessions planned, k = strength activities matched so far):
| State | Header session block | Strength card |
|---|---|---|
| (a) k < N, no set touched | `Styrke: session k+1 af N`, block · uge, **Begynd træning** | head `0 af 24 sæt udført` + progress, done list (if k ≥ 1), week-1 note, groups, footnote |
| (a) some done/skipped | same, **Fortsæt træning** | as (a), with done/skipped lines |
| (a′) every set done or skipped | same two lines, then `text-20` 700 `Alle sæt er klaret.` + `text-16` `Husk at logge kg i arket. Sessionen tæller som udført efter næste opdatering.`; no button | head `Alle sæt klaret` (+ skipped line), no slab |
| (b) a session done today, k < N | as (a) | done line "i dag" first, then (a) |
| (c) k ≥ N > 0 | absent | `Alle 3 sessioner er udført i denne uge.` (N = 1: `Ugens session er udført.`) + `Næste uges session 1 vises her fra man. 19. okt.` |
| (d) N = 0 | absent | `Intet styrkeprogram i denne uge.` + `Trænerens ark har intet for uge 42 endnu. Det vises her, når det er tilføjet.` |
| (e) k > N | absent | extra line(s) in the done list, then (c) or (d) |

Done list (k ≥ 1, `<ul aria-label="Udført i denne uge">`, `text-16`, 20px `--slab` circle with `--slab-mark` ✓), unchanged: `Session 1 udført i dag · Styrke 1:12:48`, `Session 1 udført tirs. 29. sep. · Styrke 1:12:48`, `Ekstra session udført i dag · Styrke 0:45:10 · ikke i programmet`. Null name or time drops that part; never a placeholder. Matching happens in the daily run (05, 12, 20), so a session finished in Fokus moves Træning to k + 1 after the next run.

**Every state, both screens:**
| State | Træning | Fokus |
|---|---|---|
| Loading | `app/loading.tsx`: real h1 "Træning"; date bar `text-16`; updated bar `text-14` w-1/3; a 32 × 180px `--track` pill + a `text-16` bar w-1/2 (form row); `text-20` + `text-16` bars and a 56px `--track` pill (session block); one Card with title bar, 8px progress bar, 2 groups each with a `text-20` bar, a `text-32` bar w-2/3, a `text-20` bar w-1/2 and two 44px lines with a 28px `--track` circle. `sr-only role="status"` `Henter dagens træning …`. Pulse only under `motion-safe`. | `fokus/loading.tsx`: real Afslut link; count bar; 8px `--track` progress; empty 44px row; a `--track` card in the set card's exact shape (name bar, two 56px bars, 64px pill); a 48px `--track` pill. `role="status"` `Henter sættet …`. |
| Fresh / stale / unknown | Updated line, copy §6; stale and unknown in `--warning` + triangle. The flag is not greyed. | Fresh: nothing. Stale/unknown: `WarningLine` in the last-tap row, §6. |
| No `daily_load` rows / TSB null | No flag; in its place `text-16` muted `Form (TSB) er ikke beregnet endnu.`; updated line hidden | – |
| Zone null | Flag shows TSB and value only (no swatch, no zone name); hint `Zone ikke beregnet.` muted | – |
| Form read fails | `WarningLine` in the form row: `Kunne ikke hente form (TSB).` + `Prøv igen` (href `/`, `min-h-11`); the plan still renders. When the plan also failed, no link. | – |
| Plan / session read fails | `ErrorState` in place of all day cards, title `Kunne ikke hente dagens træning`, `what` from `describeDataError`, retry href `/`. Never "Hviledag" when a plan source failed. The session block is absent. | `ErrorState` title `Kunne ikke hente sættet`, retry href `/fokus`, plus an `Afslut` link. |
| Set log read fails (plan fine) | The groups render with every set shown open, and a `WarningLine` above the list: `Kunne ikke hente dine afkrydsninger. Sættene vises som ikke lavet.` + `Prøv igen`. Begynd/Fortsæt stays (label = Begynd). | `ErrorState` as above (Fokus can't know the current set without the log). |
| No session to train (c/d/e, or `DEV_FIXTURE=empty`) | §5 table | A centred note card (`--surface`): `Ingen styrkesession at træne nu.` (`text-20` 700) + the (c) or (d) sentence (`text-16`) + a `Til Træning` link styled as the `--text` pill. |
| Null suggestion | Reference line `Intet forslag` + reason (§6) | Kg block per §4.2 |
| Null last week | `Intet logget sidste uge` | `Intet logget sidste uge`, or as the kg block's fallback (both null) |
| Week 1 | Week-1 note, no last-week item | `Uge 1 i blokken: ingen sidste uge` |
| Skipped sets | Skip mark + `sprunget over`; progress dash; count line `2 sprunget over` | Last-tap line, count `· 1 sprunget over`, progress dash |
| (s) Save failed | The tick stays on screen. A `WarningLine` under the list: `1 sæt er ikke gemt.` / `3 sæt er ikke gemt.` + `De står her, men forsvinder, hvis siden genindlæses.` + a **Gem igen** button (`min-h-11`, `text-16` 600 underline) that resends the unsaved taps in order. It disappears when all are saved. | Same `WarningLine` + Gem igen in the last-tap row. Fokus keeps going (the next set shows). |
| Dev switches (`DEV_TODAY`, `DEV_FIXTURE`) | Nothing is written. A muted line under the list: `Testvisning: sæt gemmes ikke.` Taps are kept in memory for the visit. `DEV_FIXTURE=empty` → (d)-like empty; `error` → plan ErrorState; `stale` → stale line; `band` → no effect here. | Same line under Spring over; `empty` → no-session note; `error` → ErrorState; `stale` → stale WarningLine. |
| Offline | Ticks work; their saves fail into (s). | Same: the gym session continues, (s) shows the count. |

Every "Prøv igen" / "Gem igen" is in-app; nothing reloads the page.

## 6. Danish copy
| Key | Danish (exact) |
|---|---|
| Nav | `Hovedmenu` (aria) · `Træning` · `Belastning` · `Analyse` |
| Titles | `Træning` · `Fokus · Træning` |
| h1 | `Træning` + `tirs. 13. okt.` · Fokus sr-only `Fokus` |
| Updated, fresh | `Opdateret 13. okt. kl. 05.03` |
| Updated, stale | `Forældet: sidst opdateret 11. okt. kl. 05.03. Form og styrkeprogrammet kan være forældet.` |
| Updated, unknown | `Opdateringstidspunkt ukendt, så form og styrkeprogrammet kan være forældet.` |
| Fokus stale | `Programmet er sidst opdateret 11. okt. kl. 05.03 og kan være forældet.` |
| Flag | `TSB` · value · zone name: `Høj risiko` · `Optimal` · `Gråzone` · `Frisk` · `Overgang` |
| **Hint, high_risk** | `Meget træt: forvent at ligge klart under` |
| **Hint, optimal** | `Forvent at ligge lidt under` |
| **Hint, grey_zone** | `Forvent dit normale niveau` |
| **Hint, fresh** | `Frisk: forvent at ligge på niveau eller over` |
| **Hint, transition** | `Meget frisk, men fitness er på vej ned` |
| Zone null | `Zone ikke beregnet.` |
| TSB null | `Form (TSB) er ikke beregnet endnu.` |
| Not today | `Tallet er fra søn. 11. okt.` (sr: `Tallet er fra søndag 11. oktober.`) |
| Form sr | `Form minus 24 TSS per dag, optimal. Forvent at ligge lidt under.` · no zone: `Form plus 4 TSS per dag. Zone ikke beregnet.` |
| Form read fails | `Kunne ikke hente form (TSB).` + `Prøv igen` |
| Session block | `Styrke: session 2 af 3` · `Program - blok 12 (offseason) · uge 3` |
| Primary | `Begynd træning` · `Fortsæt træning` |
| All sets done (header) | `Alle sæt er klaret.` + `Husk at logge kg i arket. Sessionen tæller som udført efter næste opdatering.` |
| Strength head | `Styrke` · `0 af 24 sæt udført` · `2 sprunget over` · `Alle sæt klaret` |
| Group | `5 reps` · `8 - 12 reps` · `Forslag 142,5 kg` · `Sidste uge 140 kg` · `kropsvægt` · `kropsvægt + 10 kg` · `Intet logget sidste uge` |
| Set line | `Sæt 1 af 2` · `kl. 18.42` · `sprunget over` · `Næste` |
| **Null suggestion reasons** | `not_rpe`: `Intet forslag til %-sæt` · `no_e1rm`: `Intet forslag: ingen e1RM endnu` · `no_lift`: `Intet forslag til denne øvelse` |
| Set sr name | `Squat, sæt 1 af 2, 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg` (+ `, udført kl. 18.42` / `, sprunget over` / `, næste`); `8 til 12 reps`, `RPE 5 til 7`; `, intet forslag`; `, intet logget sidste uge` |
| Week-1 note | `Uge 1 i blokken: ingen kg fra sidste uge at sammenligne med endnu.` |
| Footnote | `Forslag er et skøn ud fra din e1RM og RPE, ikke trænerens tal. Hvert sæt gemmes, når du sætter flueben; kg logger du i arket.` |
| Save failed | `1 sæt er ikke gemt.` / `{n} sæt er ikke gemt.` + `De står her, men forsvinder, hvis siden genindlæses.` + `Gem igen` |
| Log read fails | `Kunne ikke hente dine afkrydsninger. Sættene vises som ikke lavet.` + `Prøv igen` |
| Dev switches | `Testvisning: sæt gemmes ikke.` |
| Loading (sr) | `Henter dagens træning …` · `Henter sættet …` |
| ErrorState titles | `Kunne ikke hente dagens træning` · `Kunne ikke hente sættet` |
| `describeDataError` | unchanged: `Serveren mangler sine databaseindstillinger.` · `Læsning af {table} fra databasen mislykkedes.` · `Databasen returnerede data i et uventet format.` |
| Fokus top | `Afslut` · `7 af 24 sæt udført` · `· 1 sprunget over` |
| Last-tap line | `Squat · sæt 1 udført kl. 18.42` · `Squat · sæt 2 sprunget over` · `Fortryd` |
| Set card | `Sæt 1 af 2` · `reps` · `Forslag` · `Sidste uge` · `Kg` · `Intet forslag` · `Intet logget sidste uge` · `Uge 1 i blokken: ingen sidste uge` · `Udført` |
| Secondary | `Spring over` |
| Rest | `Pause` · `Næste` · `Squat · sæt 2 af 2` · `5 reps · RPE 7 · forslag 142,5 kg` · `Til næste sæt` |
| Finished | `Session 2 er klaret` · `22 af 24 sæt udført · 2 sprunget over` · `Alle 24 sæt udført` · `Start kl. 17.58 · sidste sæt kl. 19.10` · `Husk at logge kg i arket.` · `Tilbage til Træning` |
| No session (Fokus) | `Ingen styrkesession at træne nu.` + the (c)/(d) sentence + `Til Træning` |
| Fokus status (sr) | `Squat, sæt 1 udført. Pause.` · `Squat, sæt 2 af 2: 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg.` · `Sæt 2 sprunget over.` · `Fortrudt: Squat, sæt 1 er åben igen.` · `Sessionen er klaret.` |
| States (c)/(d), done list, ride, rest | as §5 and §8 |

## 7. Flow and writes
All writes go through the one server action (set log); nothing else is written, kg never.
| Tap | Write | Then |
|---|---|---|
| Begynd træning | `begin` = `started_at` on the first open set | navigate to `/fokus` (does not wait for the save) |
| Fortsæt træning | `begin` only if the first open set has no `started_at` | navigate to `/fokus` |
| Udført (Fokus) | `ended_at` on this set, `started_at` on the next open set | rest view (or finished view) |
| Til næste sæt | none | set view |
| Spring over | the set is `skipped`, no timestamps on it; `started_at` on the next open set (§10 D7) | set view of the next set (no rest) |
| Fortryd | undo the latest done/skip tap (only what that tap wrote) | set view of the reopened set |
| Afslut | none | `/`, progress kept, button reads Fortsæt |
| Overview tick, open → done | `done` (same as Udført) | NÆSTE slab hands over |
| Overview tick, done → open | undo of that set's done | |
| Overview tick, skipped → done | `done` | |

Minimum gym flow: open `/` → **Begynd træning** → per set: lift → **Udført** → rest → **Til næste sæt** → … → **Tilbage til Træning**. Two taps per set, both on 64px targets in the same thumb zone.

## 8. Carried over unchanged from `today.md`
**Ride card** (`Card id="ride-{n}"`, one per planned session, in table order): title "Cykel" (`text-32` display), action "I alt 1:15 t" (`text-16` 600 tabular); name `text-20` 700 as written (null: "Tur uden navn"); notes `text-16`; FTP line `text-14` muted "Mål ud fra FTP 250 W". Steps `<ol aria-label="Trin">`, 1px `--border` dividers, `py-3`: left label (`text-20` 700) and duration (`text-20` 400; no label: duration in 700); right watts `text-32` Condensed 700 tabular with " W" the same size ("263 W", "225–250 W"), % FTP below in `text-16` muted. Repeat group: "Gentag 4 gange" (`text-16` 600), steps indented 16px behind a 2px `--chart-mark` rule, durations per repetition. Formats: whole W and %, "8 min", "30 s", "1 min 30 s", "Gentag 1 gang". No FTP: % FTP in `text-32` (" FTP" in `text-20`) and `Ingen FTP fra intervals.icu, så målene står kun i % FTP.` Unreadable steps: no total, FTP line or steps; `WarningLine` `Kunne ikke læse trinene, så der vises ingen mål. Ret dem i planned_sessions ({problem}).` No steps: `EmptyState` `Der er ikke indtastet trin for denne tur.`

**Rest card** (`Card id="rest"`), depends on rides and strength *activities* only: title "Hviledag", or "Færdig for i dag" when a strength activity was logged today; body `text-20` "Intet planlagt i dag." / "Ikke mere planlagt i dag."; "Næste tur" (`text-14` 700 uppercase muted), date `text-20` 700 ("I morgen · tors. 1. okt." or "søn. 4. okt."), name `text-16`. None within 28 days: `EmptyState` `Ingen tur planlagt de næste 28 dage. Ture kommer fra planned_sessions.`

**Sessions per ISO week:** the sheet defines sessions 1..N per ISO week (Mon–Sun); the n-th strength activity from intervals.icu in the week is session n; undone sessions have no date.

**`/load` week table: strength by activity** (referenced from DESIGN.md › Week card): strength sits on the date of its matched activity, one section per activity in start-time order. Matched: line 1 `text-16` 600 `Session 2 · Program - blok 12 (offseason) · uge 1`, line 2 `text-14` muted `Styrke 1:12:48 · 86 TSS`, then the exercises. Unmatched (n > N or N = 0): `Styrke · ikke i programmet` / `Styrke 0:45:10 · 0 TSS`, no exercise list, strength column "0" (a real zero). A day with neither ride nor strength activity is the plain "Hvile" row. Planned-but-undone sessions are not shown.

## 9. Acceptance criteria (for `tester`)
Run with `serve.ps1` on port 3100; states via `DEV_FIXTURE` / `DEV_TODAY` where named.
1. Nav reads `Træning` · `Belastning` · `Analyse` on `/`, `/load`, `/analyse`; "I dag" appears nowhere in visible text or titles. `/` title is `Træning`, `/fokus` title `Fokus · Træning`. `/fokus` has no `nav[aria-label="Hovedmenu"]`.
2. `/` h1 reads "Træning" + the date (uppercase render at 44px). The form row shows the flag (`TSB`, signed value, zone name) and the hint for that zone exactly as §6; TSB null shows `Form (TSB) er ikke beregnet endnu.`; zone null shows the value and `Zone ikke beregnet.`; an old row adds `Tallet er fra …`.
3. With an open session, `Styrke: session k+1 af N`, the block line and the primary button are fully visible at 390 × 660, also on a day with a planned ride. The button reads `Begynd træning` with no set touched and `Fortsæt træning` once one set is done or skipped; it is the only `--text`-filled pill on the page besides the current nav tab.
4. Every set of every sheet row has its own `<label>` with a checkbox, ≥ 44px tall; its accessible name matches §6 (`Squat, sæt 1 af 2, 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg`).
5. Prescriptions render at a computed 32px Condensed 700 as written; `Forslag` and `Sidste uge` render at 20px with their labels; no suggestion is ever in the 32px line; "0 kg" never appears; a null suggestion shows the reason for its basis.
6. The NÆSTE slab covers the group of the first open set; the `Næste` tag sits on that set's line; skipped sets are never NÆSTE. With no open set there is no slab and the head reads `Alle sæt klaret`.
7. Ticking an open set shows ✓ within 100ms and sends one write; reloading `/` keeps it ticked and shows `kl. hh.mm`; unticking reopens it and survives reload. A skipped set shows the minus mark and `sprunget over`.
8. With the save forced to fail (offline), the tick stays and `1 sæt er ikke gemt.` + `Gem igen` appears; `Gem igen` back online saves it and the warning goes.
9. Begynd træning writes `begin` and opens `/fokus` on the first open set. Fokus shows only: Afslut, the count, the progress bar, the last-tap row, the set card (name, `Sæt n af m`, reps, prescription, kg block, last-week line, Udført) and Spring over. Reps and the kg figure are the two largest computed font sizes (56px); the suggestion is italic, the reps upright.
10. Udført → rest view: `Pause`, a timer counting up from the tap (m:ss), the next set in a small slab, `Til næste sæt`. Reloading in the rest view shows the rest view with the timer still counting from the original tap. Til næste sæt writes nothing and shows the next set.
11. Spring over marks the set skipped (no timestamps), shows the next set directly, adds a dash segment and `· 1 sprunget over`. Fortryd undoes the latest done/skip and the set becomes current again; a second Fortryd walks one tap further.
12. Afslut returns to `/` with progress kept and the button reading `Fortsæt træning`; reloading `/fokus` mid-session returns to the same set.
13. With every set done or skipped, Fokus shows the finished view (`Session n er klaret`, counts, start and last-set times, `Husk at logge kg i arket.`, `Tilbage til Træning`); `/` shows the (a′) header note and no button.
14. Progress segments are by position: done `--slab`, skipped dash, open `--track`; the count text matches.
15. Focus moves as §4.7; the status region announces each set change once; the timer is never announced on its own. Every control has a visible focus outline (inside the slab: `--slab-mark`).
16. Both themes: text ≥ 4.5:1; the check ring, skip mark, Afslut/Spring over borders ≥ 3:1; the Udført button text 16.2:1.
17. `prefers-reduced-motion: reduce`: view changes, tick and progress change with no transition and no press scale.
18. At 200% text on 390px: no horizontal scroll on `/` or `/fokus`; the kg figure may wrap, nothing is clipped.
19. States: `DEV_FIXTURE=empty` (no-session note in Fokus, (d)-like card on `/`), `error` (ErrorState on both), `stale` (stale line on `/`, WarningLine on Fokus); loading skeletons match §5 with no layout shift on load. Under any dev switch, `Testvisning: sæt gemmes ikke.` shows and no write is sent.
20. Ride card, Rest card, done list and the `/load` week table behave as §8 (former today.md AC 12, 14, 21–24).
21. No English UI string on `/` or `/fokus` (exercise names, sheet cells, activity/ride names, step labels excepted).

## 10. Decisions taken by design-lead (2026-10-12, user away)
- **D1 Session block in the page header, above the ride card.** The brief puts session/block/week and TSB in the header; doing so also keeps Begynd above the fold on ride days, without changing the ride-first card order.
- **D2 Form = the zone flag + a hint, no bands on Træning.** The brief asks for a badge; the flag is the ZoneBar's own pill, so it is still the same element as `/load`'s hero. Saves ≈ 40px.
- **D3 The sheet's own kg (§3b of today.md) is dropped from Træning and Fokus.** The brief's set line has none; the app's copy of the sheet is up to 8 h old mid-session; two kg figures per set would make "forslag" ambiguous. Reversible: it would go back as a third reference-line item `Arket 140 kg`.
- **D4 Shared values once per sheet row.** Reps, RPE, forslag and sidste uge are identical for every set of a sheet row, so the group shows them once and each set line is `Sæt n af m` + its tick; the full sentence is in each set's accessible name. Halves the list's height versus repeating them.
- **D5 NÆSTE slab = the group of the first open set**, the tag on the set line (the slab must carry reps/RPE/kg).
- **D6 Italic = computed, upright = as written** for Condensed figures. This is how the suggestion "never looks prescribed", together with its `Forslag` label.
- **D7 Spring over also stamps `started_at` on the next set**, so the set after a skip has a start. (Data change for main session to confirm.)
- **D8 Fokus undo exists**: a `Fortryd` in a reserved last-tap row, repeatable. Needs the latest tap (set, kind, time) from the log, not only the latest done time.
- **D9 Save failures are queued and retryable** (`Gem igen`), replacing "Et tidspunkt blev ikke gemt. Fluebenet står." (the tick no longer lives in memory only, so "står" would be untrue after reload). Whether a retry carries the original tap time is the main session's call; the spec only requires the order.
- **D10 Screen wake lock in Fokus**, enhancement only.
- **D11 Set numbers count across the run (changed 2026-10-12, design review).** `Sæt n af m` numbers sets across the **run** (consecutive sheet rows with the same trimmed name), not per sheet row: Bænk's 1 + 1 + 2 sets read `Sæt 1 af 4` … `Sæt 4 af 4`. Applies everywhere the number shows: Træning set lines (§3.3.4), their accessible names, Fokus set card (§4.2.2), rest-view next set (§4.3.3), last-tap line (§4.1.3), status announcements (§4.7). Why: per-row numbering showed `SÆT 1 AF 1` on three consecutive Fokus cards, which reads as "my tap didn't register". A single-row run is unchanged (`Sæt 1 af 2`).
- No new colour or size tokens. New uses of existing tokens: `text-56` Condensed 700 upright (Fokus reps, last-week fallback), `--slab-mark` as the focus outline inside a slab.
