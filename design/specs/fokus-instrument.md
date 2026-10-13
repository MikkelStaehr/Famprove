# Spec – Fokus in Instrument (pilot, 2026-10-13)

> **Revision 2 (user, 2026-10-13)** overrides this spec where they differ: air first (40px between groups, 12px inside, 56px around the timer, nothing below the primary), Inter with tabular figures for big numbers, headings and buttons (mono only for captions ≤ 14px, scale labels, small numbers; no slashed or dotted zero), warm-grey muted and Barley Corn only for captions, the primary as a red rule + red Inter label (no fill), ink lamp and ink progress tick, and the warm-up timer with its own scale. See DESIGN.md Part B "Revision 2".

Restyles `/fokus` only. **Look** comes from DESIGN.md Part B (Instrument); **structure, copy, flow, writes, states, focus and sr text** stay exactly as `traening.md` §4 + `fokus-pause.md`. Nothing here changes behaviour or data.

## 0. Scope and fonts
- The Fokus root element gets `data-direction="instrument"`; `globals.css` defines the Part B token table under `[data-direction="instrument"]` and under `@media (prefers-color-scheme: dark) { [data-direction="instrument"] { … } }`. `:root` stays Spurt.
- `web/src/app/fokus/layout.tsx` loads Inter (400) and JetBrains Mono (400, 500) via `next/font/google` (no new package) and puts their variables on the root. Utilities: `font-grotesk`, `font-mono`, `caption` (Part B Type).
- In scope: no `rounded-*`, no shadow, no `bg-slab`/`bg-surface` fills, no italic, no Condensed. Glyphs ✓ ◆ → are inline SVG.

## 1. Top bar (§4.1)
- Row: **Afslut** = mono `text-16` 500 `--text`, underlined (1px, offset 4px), `min-h-11`, no outline. Count right-aligned: `7` mono `text-24` + `af 24 sæt udført` `caption`-style mono `text-14` (not uppercase here: it is a sentence) `--text-muted`; skips follow as today.
- **Progress barcode** (replaces segments), 16px under, a 24px-tall `aria-hidden` row, ticks spread `justify-between` bottom-aligned, one per set in sheet order: done 2×16px `--text`; skipped 2×6px `--text-muted`; open 1×6px `--text-muted`; **current set 2×24px `--accent`** (none in the finished view). A 1px `--border` hairline under the row.
- Last-tap line: mono `text-14` `--text-muted` (`SQUAT · SÆT 1 UDFØRT KL. 18.42` stays mixed case: mono, not caption), **Fortryd** mono `text-16` 500 `--text` underlined, `min-h-11`. Reserved 44px row as today.

## 2. Set view (§4.2)
No card. Section, top to bottom:
1. `h2` exercise name as written, Inter 400 `text-32`, `--text`, wraps. `caption` under it: `SÆT 1 AF 2`. Hairline, 16px.
2. **Reps row** (flex-wrap, baseline, gap 16): caption `REPS` above; `5` / `8 - 12` mono 400 `text-56` + ` reps` mono `text-24` `--text-muted`; prescription `RPE 7` / `-12.5%` mono `text-32` `--text`, own caption `ARKET`.
3. 16px, hairline, 16px. **Kg block:** caption `FORSLAG` (or `SIDSTE UGE`, `KG`), then `142,5` mono `text-56` + ` kg` mono `text-24` `--text-muted`. Null: `Intet forslag` Inter `text-24` `--text-muted` + reason Inter `text-16`.
4. Adjustment / cap line (fokus-pause §5 table, copy unchanged): Inter `text-16` `--text-muted`, signed number in mono 500 `--text`. `(begrænset) i forhold til sidste uge` the same.
5. Last-week line: caption `SIDSTE UGE` + `140 kg` mono `text-24` `--text` on one baseline row. Null / week-1 text as today, Inter `text-16` muted.
6. 24px. **Udført** — the view's one filled accent: full width, `min-h-16`, radius 0, `--accent` fill, `--on-accent` label `UDFØRT` mono 500 `text-24` +0.08em, 24px ✓ SVG before it. Focus ring `--focus` 3px offset 3px.
7. 16px. **Spring over**: centred, `min-h-12`, padding 0 24px, 1px `--text-muted` outline, mono `text-16` 500 `--text`.

## 3. Warm-up (fokus-pause §2)
- `h2` `Opvarmning · Squat` Inter 400 `text-32` (wraps). Hairline. Timer mono 400 `text-56` `--text`, `role="timer"` as today, no scale (R7).
- **Ramp = mono table**: caption `OP MOD FORSLAGET 142,5 KG` (or `OP MOD SIDSTE UGE 140 KG`), then the `<ol>` as a 3-column grid, gap 16, hairline between columns (1px `--border` left rule on columns 2–3). Each cell: caption `40 %`, `57,5` mono `text-24` `--text` + ` kg` `text-16` muted, `5 reps` mono `text-14` muted. Under each cell a 1px `--text` rule at pct × cell width ending in a 1×8px `--text` tick (`aria-hidden`): the rules rise left to right. 200 % text: one column, as today. Null ramp / accessory: as today, Inter `text-16` muted.
- **Til sæt 1** is the filled accent (as Udført, label `TIL SÆT 1`, → SVG after).

## 4. Pause (fokus-pause §1, §3, §4)
1. **Felt-RPE**: question Inter 400 `text-20` `--text`. Row of three `<button aria-pressed>`, gap 8, `min-h-14`, radius 0, mono 500 `text-16` labels `LETTERE` · `SOM VENTET` · `HÅRDERE` (uppercase via CSS; sr names stay mixed case). Each has a **lamp**: a 10×10px square before the label. Unselected: 1px `--text-muted` outline, hollow lamp (1px `--text-muted`). Selected: 2px `--text` outline, lamp filled `--accent` (≈ ≥ 3:1 both themes, computed at render), label `--text`. Selection is shown by fill-vs-hollow lamp and outline weight, not colour alone; no filled button (Part B single-accent table). Lights in 0ms; clear/overwrite as today.
2. **Reps stepper**: label `Reps i sæt 2` Inter `text-16`, range `6 - 10` caption under it; `[−]` `[+]` 56×56, radius 0, 1px `--text-muted` outline, 24px SVG glyphs; disabled at a bound: dashed 1px `--text-muted` outline + `aria-disabled` and `disabled` (shape, not colour). Value `<output>` mono 400 `text-32`, min 3ch.
3. 16px air, hairline. **Rest section**: caption row `PAUSE` left, `ANBEFALET 3–5 MIN` right (same row, baseline). Timer mono 400 `text-56` `--text` (digits never change colour).
4. **Rest scale** (`aria-hidden`), 8px under, full width, 56px tall:
   - Scale = 0 … 1.2 × `rest_max_s`. Baseline 1px `--text-muted`.
   - Minor ticks every 30 s: 1×6px `--text-muted`; whole minutes: 1×12px `--text` with mono `text-12` labels `0 1 2 3 4 5` under them (`--text-muted`).
   - **Minimum**: 2×24px `--text` tick with caption `MIN` above it. **Maximum**: 1×24px `--text` tick, caption `MAX`.
   - **The red tick**: 2×32px `--accent`, at elapsed / scale × width, moved once a second with no transition; pinned at the right end past the scale.
   - `rest_min_s` null: no scale, no `ANBEFALET`.
5. **Band line** (the state carrier, copy unchanged), Inter `text-16`: before min `Hvil mindst 3:00` `--text-muted`; at/after min a 16px ✓ SVG in `--accent` + `Klar til næste sæt` `--text`; after max ✓ + `Klar · over 5 min pause`. The status announcements are unchanged.
6. 16px air. **Next-set section, no background**: caption `NÆSTE` + `Squat · sæt 2 af 4` Inter `text-20` on one row; hairline; values in mono `text-16`: `5 reps · RPE 7 · forslag 142,5 kg` (short adjustment form as §1.2), then `SIDSTE UGE 140 kg` (caption + mono), then `Note: …` Inter `text-16` (clamp + `Hele noten` underlined mono, as today).
7. 16px. **Til næste sæt / Til sæt 1**: the filled accent, as Udført, → SVG after.
8. 16px. Footer mono `text-14` `--text-muted`: `Tid brugt 42 min · ca. 31 min tilbage`.
- Variant C: feel block, 16px air + hairline, then §3's warm-up section for the next exercise, next-set, `TIL SÆT 1`, footer.

## 5. Finished (§4.4 + fokus-pause)
Feel block (last set) if the last tap was a done. Then `h2` `Session 2 er klaret` Inter 400 `text-44` (existing token), hairline, a mono figure row: `22` mono `text-56` + `af 24 sæt udført` Inter `text-16` muted, `· 2 sprunget over`; `START 17.58 · SIDSTE SÆT 19.10` caption; `Husk at logge kg i arket.` Inter `text-20` `--text`. **Tilbage til Træning** is the filled accent (`TILBAGE TIL TRÆNING`). Barcode: no red tick.

## 6. Warnings, loading, dev
- WarningLine (stale, save failed): ◆ SVG `--text` 16px + Inter `text-16` `--text` + the action (`Gem igen`) as an outlined mono button. No red, no fill.
- `fokus/loading.tsx`: skeleton = hairlines + 1px `--text-muted` placeholder rules at the figure positions (no grey blocks, no shimmer).
- `Testvisning: sæt gemmes ikke.` caption under the footer.

## 7. Light and dark
Both themes use the same rules; only the token values swap (Part B table). Red fill label is `--on-accent` #141414 in both. Light uses `--text-muted` #665946 ([A2]).

## 8. Fold (unchanged from `fokus-pause.md` §10.1)
At 390×844 in `DEV_FIXTURE=pause` and `exercise-end` (2-line name and note): the three feel buttons, the timer and the primary button end ≤ 844px without scrolling; only `exercise-end` may scroll the footer. Set view at 390×660: Spring over ends ≤ 660 (§4.2 height check). If a fold fails, cut air first (24 → 16), then the scale's minute labels, never a target size.

## 9. Acceptance criteria (tester)
1. `/fokus` root has `data-direction="instrument"`; `/`, `/load`, `/analyse` render unchanged (Spurt) – screenshot diff at 390.
2. Font check: every glyph on Fokus renders in Inter or JetBrains Mono (no system fallback); ✓ ◆ → are SVG.
3. Each view (set, pause, warm-up, exercise-end, finished) has exactly one filled element, the primary in Part B's table, in `--accent` with a `--on-accent` label ≥ 24px.
4. No rounded corners, shadows, italic, Condensed or filled containers in scope (computed styles).
5. Progress barcode: one tick per set, heights match done/skipped/open/current; the red tick is the current set; the count text matches.
6. Rest scale: red tick position = elapsed / (1.2 × rest_max_s), steps once a second, no transition; MIN/MAX ticks at rest_min_s / rest_max_s; absent when rest_min_s is null.
7. Felt-RPE: selected shows a filled lamp and 2px outline within 100ms, `aria-pressed` true; unselected outlines and the stepper meet ≥ 3:1 (computed at render).
8. Both themes: text ≥ 4.5:1, captions ≥ 12px (14px on Fokus), no red text under 24px, borders/ticks/lamps ≥ 3:1 (computed at render). Focus ring visible on every control.
9. Fold per §8. 200 % text: no horizontal scroll, ramp stacks.
10. Reduced motion: cross-fade 0ms; nothing else animates.
11. All behaviour criteria of `traening.md` §9 and `fokus-pause.md` §10 still pass.
