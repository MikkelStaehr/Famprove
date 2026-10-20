# Fokus › Minimér (spec-lite, slice `fokus-minimise`, M)

User 2026-10-20 (from training 19 Oct). Plan: tech-lead. Look: DESIGN.md Part B (Ember); rest words from `fokus-pause.md` / `reset-fokus.md`.

## 1. Question and action
"How long have I rested, and what's next?" while I look at Belastning or Analyse between sets. Primary action: tap the bar → back to Fokus at the same set.

## 2. Flow
Fokus → **↓ Minimér** → saves land (button reads `Gemmer…`, disabled, < 1 s typical) → `/train` with the bar → any tab, bar stays → tap bar → `/fokus`, same set, same rest clock. Bar gone on Afslut, on a session with every set done or skipped, or when the snapshot's date ≠ today.

**Minimér in Fokus:** top bar, right (Afslut stays left; `justify-between`). Compact dark button (`COMPACT_SECONDARY`, 44px, padding 0 14), `arrow-down` icon 18px + `Minimér` (`text-button`). Not shown while a clip records (`recLive`): the camera can't leave Fokus.

**Bar at 390px:** a flex sibling between TabShell's scroll container and TabBar (below lg; at lg the bar sits at the column's bottom, TabBar stays on top). It is never overlaid, so the scroll container shrinks and its last line stays above the bar. Strip `--bg`, padding 8px 16px (safe-area sides). Inside, one link to `/fokus`: `--card` fill, 1px `--text-muted` border, `--radius-button`, `min-height: var(--h-fokus-bar)` (new token, 3.5rem = 56px; min-height, never height), padding 8px 14px, gap 12px, one row:
- **Timer** left: Geist Mono 500 `text-24` tabular `m:ss`, `--text`, counting up from the rest start. If there is no rest start (warm-up or set 1 not begun), it isn't shown.
- **Middle** (flex-1, min-w-0), two lines: caption `text-11` mono uppercase, then `Næste · <name> · sæt n · <reps> × <kg> kg` in Geist `text-14` `--text`. Only the name truncates (ellipsis); the figures never do. Name = the variant's display name when there is one (as Fokus). Missing kg → `<reps> reps`, never `0 kg`.
- **Caption by band** (the same `restBand` as Fokus): before min `PAUSE · 2–3 MIN` `--text-muted`; ≥ min: 16px `check` + `KLAR · 2–3 MIN` `--text`; > max: 16px `warning` + `OVER 3 MIN` `--warning`. Icon + word every time, never colour alone. No orange, no zone colour.
- **Right:** `chevron-up` 20px, `aria-hidden`.
- Link name: visible text, prefixed by sr-only `Tilbage til Fokus.`; the timer digits are `aria-hidden`, with sr-only `Pause m:ss` updated each minute. Reaching min is said once in a polite status region: `Klar til næste sæt.` Focus ring 2px `--focus`.
- **Signal:** one `vibrate(200)` when min is crossed while visible, via `restSignal` (same gap rule: no late buzz after a freeze; Fokus and the bar share the "already signalled" mark in the snapshot, so it never buzzes twice). The bar holds the wake lock (`useWakeLock`) while it is shown and the page is visible.
- **Motion:** appears with a 160ms opacity fade (`--ease`), no movement; none under reduced motion. The timer never animates.

## 3. Copy
- Button: `Minimér` · while flushing `Gemmer…`.
- Refused (save queue halted by a failed jump or pick), WarningLine under the top bar, next to the existing Gem igen: **`Kan ikke minimere, før ændringen er gemt. Tryk Gem igen.`** Fokus stays; nothing is cleared.
- A set save that fails during the flush: stay on Fokus with the existing fail line (as Afslut).

## 4. States and shots
Fixtures built from real taps through the shared transition; the snapshot is written by the same snapshot writer, never by hand. Shoot on a day with an open session (`--dev-today`).
- `DEV_FIXTURE=minimised`: `midsession`, latest tap a done, rest under min; served on `/train`. Shots 390 and 1280: `/train`, `/load` scrolled to the bottom, `/analyse`.
- `minimised-ready`: the same with the done tap's time min + 10 s ago (the caption `KLAR`).
- `minimise-halted`: `/fokus` after a real jump tap whose save is refused (halted), Minimér tapped.
- Loading: none (snapshot is local). Empty: no snapshot → no bar. Error: unreadable snapshot → no bar, discarded. Stale: snapshot date ≠ today → no bar, cleared.

## 5. Acceptance criteria
1. Fokus's top bar shows `Minimér` right of Afslut, ≥ 44 × 44, keyboard reachable; absent while a clip records.
2. Minimér with queued taps: shows `Gemmer…`, goes to `/train` only after they land.
3. With a halted queue: stays on Fokus and shows the refused sentence; after Gem igen succeeds, Minimér works.
4. Every tap (done, skip, undo, jump, begin) rewrites the snapshot (date, session, next set name/n/reps/kg, rest start, rest min/max); a reload of `/train` still shows the bar.
5. The bar shows on `/train`, `/load` and `/analyse` at 390 and 1280, and switching tabs or swiping keeps it and its timer.
6. The bar never covers the TabBar; on `/load` scrolled to the end, the last line sits fully above the bar.
7. The timer equals Fokus's for the same rest (±1 s) and counts up from the rest start.
8. Captions match the band: `PAUSE` < min, `KLAR` + check ≥ min, `OVER` + warning > max; each with icon and word.
9. Crossing min while visible vibrates once (`vibrate(200)`), never again after a return to Fokus, and not when the page was hidden at the crossing.
10. The wake lock is held while the bar is visible, released on unmount, page hidden and back; re-acquired on visible.
11. Tapping the bar opens `/fokus` at the same set with the same rest clock; back from Fokus returns to the tab.
12. The bar clears on Afslut, when every set is done or skipped, and on a new day (snapshot date ≠ today).
13. Reduced motion: no fade. Every text ≥ 4.5:1, the link border ≥ 3:1 (computed by `tester` at render).
14. No glyph renders in a system font (arrows and check are Lucide icons).
