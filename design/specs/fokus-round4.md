# Spec – Fokus round 4: red only as a tick, real buttons, one living element (2026-10-13)

Overrides `fokus-instrument.md` and DESIGN.md Part B Revisions 2–3 where they differ (recorded as **Revision 4**). Flow, writes, copy not named here, focus and sr text stay as `traening.md` §4 + `fokus-pause.md`. **Nothing new is stored or fetched.** The three generative elements are drawing scales computed in the browser from the set log and sheet rows Fokus already has (like the rest tick's position): no number is derived, shown or stored by them. Reps for drawing = `reps_done` when present, else the prescribed reps (a range's stored midpoint). A warm-up (set 0) is never a set.

## 1. Colour and controls
- **Red** (`--accent`) is only the moving tick on the rest/warm-up scale (and later the charts' "today" mark). No red text, rule, box, lamp or fill anywhere on Fokus.
- **Primary** (Udført, Til sæt 1, Til næste sæt, Tilbage til Træning): full width, `min-h-14` (56px), radius 0, no border, fill `--text`, label `--bg` Inter 500 `text-24`, ✓/→ SVG in `currentColor`. `:active` opacity 0.8 (both themes). Focus: 3px `--focus` ring, offset 3px (reads as a second ring after a bg gap). Pinned dock unchanged. Contrast ink/bg: computed at render (≈ 14:1 dark, ≈ 10:1 light).
- **Rating**: `role="group"` labelled by the question; one box with a 1px `--text-muted` outline (≥ 3:1, [A5]), `grid-cols-3`, three equal `<button aria-pressed>` segments, `min-h-14`, separated by 1px `--border` hairlines inside only. Labels Inter 500 `text-16`, mixed case: `Lettere` · `Som ventet` · `Hårdere`. No lamp, no checkbox. Selected: segment fill `--text`, label `--bg` (0ms). Focus: 3px `--focus` outline, offset 2px, `relative z-10` so it draws over neighbours. Tap the selected one to clear (as today).
- **Spring over**: centred text link, Inter 400 `text-16` `--text-muted`, underline 1px offset 4px, `min-h-11 px-4`, no box.

## 2. Set view value row
One row, `grid-cols-[auto_auto_1fr]`, gap-x 24, captions (`caption`, 14px) directly above Inter tabular `text-44` values (existing token). Unit once, small: `kg` Inter `text-20` `--text-muted` after the kg only.
| Column | Caption | Value |
|---|---|---|
| 1 | `REPS` | `3`; range `8–12` (en dash, no spaces) |
| 2 | `RPE` / `PROCENT` | `7`; range `7–8`; a %-row shows `-12.5` + small `%` as written, caption `PROCENT`; no cell → column absent |
| 3 | `FORSLAG` if a suggestion, else `SIDSTE UGE`, else absent | `145` + `kg` |
Below 21rem container width the kg column wraps to its own line. Under it, in order (12px apart): the **dot row** (§3.2), the adjustment line (kept, Inter `text-16` `--text-muted`, signed number `--text`), the coach note (Inter `text-16` `--text-muted`, 3-line clamp + `Hele noten`). With FORSLAG shown, last week stays as a muted line `Sidste uge 140 kg`.

## 3. The three generative elements (all `aria-hidden` SVG + an sr sentence; no CSS transition or animation, ever)
### 3.1 Pause: dot field (replaces the tick scale; warm-up uses it too)
- `<svg viewBox="0 0 360 60" class="block w-full h-auto" data-scale-s data-filled>`: a grid of **60 columns × 6 rows** at a 6-unit pitch (`<circle cx=3+6c cy=15+6r r=1.5>`, field y 12–48), 360 circles. Scale 0 … 1.2 × `rest_max_s` as today; **one dot = scale_s / 360 s** (1 s at a 5-min max).
- Fill: `filled = min(360, floor(elapsed / scale_s × 360))`, column-major, top to bottom, so the front column builds downward. Filled dot `--text`; empty dot `--border` (decoration: the field's extent); a filled dot past MAX is a hollow ring (`r 1.25`, stroke 1 `--text`), so "over" is shape, not colour. Steps once a second with the timer (reduced motion: identical).
- **MIN** 2-unit `--text` rect, **MAX** 1-unit, both y 4–56 (8 above and below the field), at `min/scale × 360`; HTML captions `MIN`/`MAX` above, `0` and the end minutes below (as round 3).
- **Red tick**: 2×60-unit `--accent` rect at the front (`elapsed/scale × 360`, clamped to 358): taller than MIN/MAX.
- 0:00: all dots empty, tick at x 0. Warm-up: same field, scale 0–10 min, no MIN/MAX, labels `0` / `10`. `rest_min_s` null: no field.
- sr: the existing `role="timer"` + band live region stay; nothing added.

### 3.2 Set view: dot row
- `<svg height=8 aria-hidden>` single line, wraps (`flex-wrap` of rows at the content width): one dot per **set tapped today in this session**, sheet order: done = filled circle r 3 `--text`; skipped = ring r 2.5, stroke 1.5 `--text`; open and current sets draw nothing (the barcode shows them). Pitch 10px, +6px between exercises. Warm-ups never. 0 tapped: the 8px row is reserved empty, so Udført doesn't move between sets 1 and 2.
- sr-only: `I dag: 7 sæt udført, 1 sprunget over.`

### 3.3 Finished: session signature (above the time summary)
- `<figure>`: `<svg viewBox="0 0 360 128" class="block w-full h-auto">` + legend + `<figcaption class="sr-only">`. Baseline 1px `--text-muted` at y 116. Bars grow up from it, max 96 units; marker zone y 4–16.
- **x**: walk rows in sheet order. Δ = ended_at of this tapped-done row − ended_at of the previous done row (set or warm-up). Gap before it = `2 + 14 × min(Δ, 360 s)/360` units (Δ unknown → 2). A done set then draws a **4-unit bar**; a warm-up's done draws nothing (it shows as a longer gap at the exercise boundary); a skipped set draws a 4×4 `--text-muted` stub after a 2-unit gap. Scale all x by `s = min(360 / total, 2)`, left-aligned.
- **Height**: kg known (sheet `logged_kg` > 0 for today) → `h = 8 + 88 × reps·kg / max(reps·kg of the session)`, **solid**. kg unknown (common: the sheet is synced at 05/12/20) → `h = 8 + 88 × reps / max(reps)`, **hollow** (1px stroke, no fill): a different unit, never 0 kg.
- **Rating** (shade + shape): Lettere = `--text-muted` + ring above the bar; Som ventet = `--text` + 4×1 dash; Hårdere = `--text` + 4×4 square; unrated = `--text`, no marker.
- **Legend** under it, mono `caption` 14px, inline SVG glyphs: `○ Lettere · — Som ventet · ■ Hårdere` / `Hul søjle: kg ikke i arket endnu`.
- **sr**: `Sessionens forløb, et sæt pr. søjle: 22 udført, 2 sprunget over. Kg kendt for 9 sæt; resten er tegnet efter reps. 3 lettere, 15 som ventet, 4 hårdere, 0 uden vurdering.` (counts only).
- **Deterministic**: a pure function `signature(rows, log)` → SVG; no randomness, no clock. Unit test: same input → identical markup.

## 4. Grain
`[data-direction="instrument"]` gets `isolation: isolate` and a `::before { content:""; position:fixed; inset:0; z-index:-1; pointer-events:none; opacity:.03; background:url("data:image/svg+xml,…") repeat; background-size:160px }`, the data URI = 160×160 `<feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch">` + `<feColorMatrix type="saturate" values="0">` on a full rect. Both themes, /fokus only, static. The root carries `bg-bg`. Text contrast with grain: computed at render (worst pixel), must stay ≥ 4.5:1.

## 5. Fixtures (write nothing) and acceptance criteria
- `DEV_FIXTURE=pause-rated`: last done tap = now − 3:40 (between MIN and MAX), that set rated `Hårdere`. `finished`: every set tapped, 2 skipped, warm-ups, reps_done on range sets, logged kg for the first exercise only, mixed ratings incl. unrated, rests 1:30–5:00 and one > 6 min.
1. No `--accent` on Fokus except the scale's tick (computed styles of every element; screenshot pixel check for red).
2. Every primary: ink fill, bg label 24px, 56px tall, full width; contrast ≥ 4.5:1 computed.
3. Rating: group outline ≥ 3:1, hairlines inside only, equal widths, selected = ink fill + inverted label + `aria-pressed`; all segments ≥ 44px; focus ring visible on each.
4. Spring over: no border/background, ≥ 44px target, muted ≥ 4.5:1.
5. Value row captions per §2 (no `ARKET`); kg unit appears once.
6. Dot field: `data-filled` = floor(elapsed/scale × 360); MIN/MAX/tick x per §3.1; past MAX dots are rings; steps once a second; no transition or animation (also under reduced motion).
7. Dot row: count = tapped sets; skipped are rings; reserved height with 0 sets; sr sentence matches.
8. Signature: one bar per done set, hollow exactly where kg is unknown, warm-ups draw no bar, same fixture → identical SVG; sr counts match the fixture.
9. Grain present at opacity 0.03 in both themes, `pointer-events: none`; text contrast unchanged within AA.
10. Fold 390×844 in `pause-rated`: rating, timer + field and primary visible without scrolling.
11. Screenshots at 390, dark and light: set view (`midsession`), `pause-rated`, `finished`. Font check passes; all `traening.md` §9 / `fokus-pause.md` §10 behaviour criteria still pass.
