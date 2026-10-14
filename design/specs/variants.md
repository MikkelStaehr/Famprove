# Exercise variants on Træning, Fokus and Analyse › Styrke (spec-lite, 2026-10-14)

Data: each set's `variant_id` → `exercise_variants.display_name`, shown **verbatim** (first spelling seen, e.g. `DB Preacher Curl`). Null (`ukendt`) = today's screens, unchanged. When the display name equals the exercise name (trimmed, case-insensitive), show the exercise name once, as null. `planned_sets.basis = new_variant`: no suggestion and no last week. Extends `review-round.md` §8–§9, `reset-traening.md` §2.5, `reset-fokus.md`, `fokus-pause.md` §1. Only the strings and the name stack below are new; tokens and components are reused.

## 1. Name stack (one pattern, everywhere a set's exercise is the title)
Title = the variant's display name. Directly under it, in the same block (4px gap, no divider), the sheet's exercise name in `--text-muted`, Geist 400. Both wrap at word boundaries: never truncated, no ellipsis, `text-wrap: balance`. The text column is `min-w-0 flex-1`. Anything to its right is `shrink-0` and top-aligned to the title's first line.

## 2. Træning (`/`)
- **Collapsed row** (the existing header `<button>`, `aria-expanded`, `aria-controls`): title Geist `text-16`/500, exercise name Geist `text-13` muted, then dots + 16px chevron on the right, aligned with line 1 as above. `Single arm cable triceps pushdown` breaks over 2 lines at 390px. The row grows; the dots and the chevron don't move down. Row stays ≥ 44px. `nameMuted` mutes both lines.
- **Expanded:** same head, then as today. `FORSLAG` is omitted on `new_variant` (§8). `SIDSTE UGE` caption over `Ny variant – intet fra sidste uge` (Geist 14 muted, the slot `Intet logget sidste uge` uses). Week 1 of the block keeps its own text, which wins.
- **sr, collapsed button:** `DB Preacher Curl, Bicep of choice, 0 af 3 sæt udført` (+ `, 1 sprunget over` when > 0).
- **sr, set row:** `DB Preacher Curl, Bicep of choice, sæt 1 af 3, 20 til 30 reps ved RPE 8 til 9, ny variant, intet fra sidste uge`. With a last week: `…, sidste uge 9 kg`.
- Progress strip, Uge card and set rows' visible text are unchanged.

## 3. Fokus (`/fokus`)
- **Set view** (hero card): title Geist 32/600, exercise name Geist 16/400 muted under it, then the existing caption and grid. At 390px, `Single arm cable triceps pushdown` takes 2–3 lines; the reps/kg grid moves down, the dock stays pinned. kg block on `new_variant`: no FORSLAG, no figure, one line `Ny variant – intet fra sidste uge` (Geist 16 muted) where the kg block was.
- **Warm-up (Variant A / C card):** `Opvarmning · DB Preacher Curl`, exercise name muted under it (Geist 14).
- **NextSetCard (pause):** line 1 `Næste` + `DB Preacher Curl · sæt 2 af 3`, then `Bicep of choice` Geist 14 muted. The Sidste uge line reads `Ny variant – intet fra sidste uge` on `new_variant`. In warm-up variants line 1 stays `Sæt 1 af 3`, since the card head names it.
- **Feel question after the last set:** `Hvordan var sæt 3 i DB Preacher Curl?`
- **Status region:** `DB Preacher Curl, Bicep of choice, sæt 2 af 3`.

## 4. Analyse › Styrke feel lines
Row name: `Bicep of choice · DB Preacher Curl` (exercise `text-16` 700, ` · ` and variant in 400). Null variant: the exercise name alone. Sentence and `Ud fra n vurderede sæt` are unchanged.

## 5. States
Loading, empty and error are unchanged. Stale: unchanged. Fixture: `midsession` should carry one variant with a last week (`Tricep of choice` → `Single arm cable triceps pushdown`) and one `new_variant` (`Bicep of choice` → `DB Preacher Curl`), so every string can be shot without writing (main session's call).

## Acceptance
- V1. A set with a variant: Træning's collapsed row shows the display name verbatim, with the exercise name muted under it inside the same button. The dots and chevron stay right, on line 1.
- V2. At 390px, `Single arm cable triceps pushdown` wraps without an ellipsis or horizontal overflow, and the row is ≥ 44px.
- V3. Null variant, or a display name equal to the exercise name: the row and Fokus look exactly as today (pixel-compare `midsession` without variants).
- V4. Accessible names match §2 and §3 (collapsed button, set row, Fokus status region).
- V5. `new_variant`: Træning shows `SIDSTE UGE` + `Ny variant – intet fra sidste uge` and no FORSLAG. Fokus shows the same sentence in place of the kg block. `grep -ri "intet forslag" web/src` is still empty.
- V6. Fokus set view, warm-up title (`Opvarmning · <variant>`), NextSetCard and the feel question use the variant name, with the exercise name muted where §3 says.
- V7. Analyse › Styrke feel lines read `<exercise> · <variant>` when the line has a variant.
