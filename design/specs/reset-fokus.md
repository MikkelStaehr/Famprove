# Fokus (`/fokus`) – visual reset (2026-10-14)

Supersedes the visual parts of `fokus-instrument.md`, `fokus-round4.md` and `fokus-pause.md`. **Logic, layout, order, copy, tap behaviour, the timer, warm-up, felt RPE, the reps stepper, Spring over, Fortryd, Afslut, the progress strip, the sticky dock and the read-back are unchanged.** Only tokens, fonts, surfaces, buttons and the focus ring change. Tokens, radii, fonts and component names come from DESIGN.md. There is no tab bar on Fokus (as today).

## 1. Global swaps
| Now (Instrument) | Becomes |
|---|---|
| `--bg` warm paper / `#141414` + grain (`--grain`, `fokus-dock` grain) | `--bg`, no grain anywhere |
| `--surface` | `--card` |
| `--border` hairline | `--border` (dividers, scale baseline) |
| `--text` / `--text-muted` | `--text` / `--text-muted` (new values) |
| `--caption` (brown captions) | `--text-muted` |
| `--accent` red (rest scale "now" tick) | `--text`: Fokus has no "today", so no orange |
| `--warning` (ink) + ◆ | `--text` + ◆ (WarningLine unchanged) |
| `font-grotesk` (Inter) | Geist (400 body, 500 labels and buttons, 600 exercise name) |
| `font-mono` | Geist Mono |
| `.caption` | MonoCaption at **13px** uppercase, 0.04em, `--text-muted` (Fokus is read at arm's length, so it is larger than the 11–12px elsewhere) |
| square corners everywhere | the radii below |
| italic suggested kg (= computed) | upright Geist Mono. ~~The caption "FORSLAG" vs "SIDSTE UGE" says computed vs logged.~~ **Superseded 2026-10-15 by `fokus-kg.md`:** today's kg under `I DAG` (the sheet's kg first; computed shown `~`), last week's kg smaller under it; no "Forslag". No synthesized italic (`font-synthesis: none`) |

## 2. Numbers in Geist Mono (500 unless noted, `tabular-nums`)
Reps and kg figures (`text-44` → Geist Mono 44, −0.03em), the RestTimer and WarmupClock (`text-56` → Geist Mono 56, −0.03em), the finished view's counts (`text-56` / `text-44`), the progress count "0/19" (16), the reps stepper value (32), the warm-up ramp kg (24) and reps (14 muted, 400), the rest scale labels (12, 400), the Footer times (14 muted, 400), prescribed RPE, last week's "100 × 3" (20, the `text-20` muted line), and error codes in FokusError (14, 400). Words stay Geist: the exercise name (`text-32` → Geist 32/600, −0.01em), questions ("Hvordan føltes sættet?" Geist 20/500), notes and sentences (Geist 16).

## 3. Surfaces (no layout change: the same blocks in the same order with the same gaps)
- **Set view**: the figure block (name, caption, reps / kg / last-week grid, notes, DotRow) sits in a hero Card (radius 26, padding 20, `--card`, 1px `--border`). The existing margins become the card's outer margin. The 21rem container query uses the card's inner width.
- **PauseCard, WarmupCard, NextSetCard**: Card (radius 22, padding 20). The NextSetCard's dashed outline becomes a 1px dashed `--shade-1` border, since it is a preview. The words "Næste sæt" say so; the dash is not the only cue.
- **Note**: removed 2026-10-15 (user, slice `variants-notes`): NOTES holds the variant, already the title, so Fokus shows no note.
- **FinishedView**: the counts in a hero Card. The "Til Træning" link is the primary dock.
- **Dock** (`PRIMARY_DOCK`): `--bg` fill, sticky as today, no grain. A 12px gradient from transparent to `--bg` above it hides content scrolling under it.

## 4. Buttons and controls
- **Primary** (`PRIMARY_BOX`: Udført, Til sæt 1, Næste sæt, Til Træning; Træning's `PRIMARY` is the dark InverseCard button instead, see `reset-traening.md` §3): the InverseCard button inverted for a dark page. `--inverse-bg` fill, `--inverse-text` label, Geist 20/500, min-height 56, radius 14, 1.5px icons (check / arrow-right) at 20px. Pressed: opacity 0.85 (instant). There is one per view, always the only light control.
- **Secondary** (`OUTLINED`, `SECONDARY`: Gem igen, the stepper's − / +, Afslut, Fortryd): `--card` fill, 1px `--text-muted` border, `--text` label Geist 16/500, radius 14, min-height 44 (stepper buttons 56 × 56 with 1.5px minus / plus icons). The mockup's `--raised` border is below the 3:1 control-border floor on `--bg`, so the border is `--text-muted`. Afslut (top left) and Fortryd (its own row, right) keep their positions and become compact secondary buttons (padding 0 14). Afslut gets a 1.5px x icon at 18px before the word.
- **Spring over** (`MUTED_LINK`): **Superseded 2026-10-15 by `button-type.md` B4:** a bordered button ≥ 44px, not a link. ~~stays a subordinate text button (a real `<button>`), Geist 16/400 `--text-muted`, underline 1px at 4px, centred, 44px target. ~~ It must never compete with the primary.
- **Felt RPE** (FeelBlock): a SegmentedControl. Container: 1px `--text-muted` border, radius 10, padding 3, gap 2, `--bg` fill. Segments: radius 7, min-height 56, Geist 16/500. Off: transparent, `--text`. On: `--raised` fill, `--text`, and a 1.5px check icon (16px) before the label, so the choice is not carried by fill alone. `aria-pressed` unchanged.
- **Focus ring**: 2px solid `--focus` at 2px offset on every control (was 3/3). On the light primary the ring sits outside on `--bg`, so it stays visible.

## 5. Marks
- **FokusProgress**: done `--text`, skipped `--shade-2`, open `--track`, current a 1px `--text` outline. Segments get radius 2, with a 2px gap kept and the same height. The baseline hairline `--border`.
- **Rest Scale** (PauseParts): the track `--track`, the recommended span `--shade-2`, minor ticks `--axis`, the now tick 2px `--text` (was `--accent`), labels Geist Mono 12 muted.
- **SessionSignature** glyphs and **DotRow**: `--text` / `--text-muted` as today. Lines that were 1px stay 1px, and icon-like glyphs use a 1.5px stroke.
- **Warm-up ramp** rows: ListRow style (1px `--border` top, min-height 44): "40 %" Geist Mono 14 muted | kg Geist Mono 24 | "5 reps" Geist Mono 14 muted.

## 6. Desktop
Fokus stays one column and phone-first. Max width 480, centred in the viewport, with the dock the same width. No grid and no tab bar. It is a full-screen mode whose only exit is Afslut.

## 7. States (unchanged content, new surfaces)
NoSessionNote and FokusError render in a Card (radius 22). The error's retry is a secondary button. Stale and unsaved notes stay WarningLines in the top area. The DEV note "Testvisning: sæt gemmes ikke." is Geist Mono 13 muted. Loading: the hero Card at its final height with `--card` fill, no shimmer under reduced motion. The view fade (`FADE_IN`) stays ≤ 150ms opacity only, off under `prefers-reduced-motion`.

## 8. Acceptance (tester, 390 and 1280, DEV_FIXTURE=midsession and the pause fixtures)
1. Every Fokus view (set, warm-up, pause, next set, finished, no session, error) shows the same elements in the same order as before the reset. Only colours, fonts, radii and button shapes differ.
2. The page is `--bg` with no grain. No `--accent`/orange anywhere on `/fokus`.
3. Reps, kg, the rest timer, the warm-up clock, the progress count, the stepper value, ramp kg and footer times render in Geist Mono, and all other text in Geist. The font check finds no system font and no synthesized italic.
4. Each view has exactly one light (`--inverse-bg`) button, ≥ 56px tall, radius 14. It stays in the sticky dock and is reachable at 390 × 844 without scrolling.
5. Gem igen, Afslut, Fortryd and the stepper − / + are outlined secondary buttons ≥ 44px. The stepper buttons are 56px.
6. Felt RPE: the three segments are ≥ 56px tall. The chosen one has the `--raised` fill and a check icon, and `aria-pressed="true"`. Tapping it again clears it (unchanged logic).
7. Keyboard: Tab reaches every control, each with a visible 2px `--focus` ring, also on the light primary.
8. Captions on Fokus are ≥ 13px. Text contrast ≥ 4.5:1 and control borders ≥ 3:1, computed by `ui` at render and listed in the PR.
9. Under `prefers-reduced-motion` no view fade or pressed-state animation runs.
10. At 1280 Fokus is one centred column ≤ 480px, with no tab bar.
