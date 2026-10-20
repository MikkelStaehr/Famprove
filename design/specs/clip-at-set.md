# clip-at-set (M, spec-lite, 2026-10-20)

**Question:** "Har jeg en optagelse af det sæt, og hvordan så det ud?" **Action:** a tap on a set's ▶ plays its clip. Not here: the Optagelser card as one line (`clip-line`).

## 1. One pattern, two places: the Klip row
A ▶ never sits inside another target. Træning's set line is a `<label>` (the whole row ticks) and the collapsed exercise row is the toggle `<button>`, so a ▶ there would be a nested target and a mis-tap between tick and play. The ▶s therefore live in **one row per exercise**, the same in both places:

- **Træning** (`SetChecklist.tsx`): in the expanded exercise, after the last set line of the run (after the last group in a multi-row run), with a 1px `--border` top like a set line. The collapsed row is unchanged (no ▶, no dot change).
- **Week card** (`WeekCard.tsx`, Træning and Belastning, every session of the week incl. earlier ones): in the exercise's `<li>`, as a third line under "3 × 8 × 42,5 kg · … score/sæt".

Row: `Klip` (Geist Mono 12, uppercase, `--text-muted`), then one button per clip: `sæt 2` (Geist Mono 13, tabular, `--text`) + Lucide `play` 16 (the `Icon name="play"`, never a glyph), 4px gap. Buttons sit 8px apart with a muted `·` between (aria-hidden), wrapping to a second line when needed. Each button's target is ≥ 44 × 44 (padding around the 16px icon and label; min-h-11), focus outline `--focus` 2px offset 2px. No accent: orange stays the today marker.

**Set numbers:** the run's set number from `runSetNumbers` (`library-view.ts`), the same as the library: the fixture's rows 25, 26, 27 (2 sets) read sæt 1, 2, 3, 4. On the week card a row is one sheet row, but the numbers are still the run's (a run split over rows 25–27 shows sæt 3 and 4 under row 27's line, not 1 and 2).

**Accessible name:** `Afspil klip af <shown name>, sæt <n>` (`shownName`: variant's name when there is one), e.g. "Afspil klip af Squat, sæt 2". The row is a `<ul aria-label="Klip">`.

## 2. Edge cases
- **Several clips of one set:** one button per clip, oldest first; the second on reads `sæt 2 (2)` ▶, name "Afspil klip 2 af Squat, sæt 2". Every clip is reachable; nothing is merged.
- **Trimmed clip:** plays the cut (`clipFile(entry)`), no mark. **Starred:** no mark here.
- **Pending delete:** hidden (the library's filter). If that leaves no clip, the row goes. Fortryd brings it back.
- Data comes from `libraryRows`' rows (same filters as the library), so the two never disagree.

## 3. Tap
Opens the library's full-screen player (Start/Slut, Gem klip, Slet) over the current tab, with its history entry: back, Luk and Escape close it, and focus returns to the ▶ that opened it. Slet from here: the player closes, the clip's button goes, focus moves to the next button in the row, else the exercise's toggle (Træning) or the session heading (week card). Feedback < 100 ms: the player's frame opens on the tap, the video loads inside it.

## 4. Earlier sessions
A ▶ shows only when the file is in this phone's index (inside the 8-week keep, or starred). A server row without a local file shows nothing; no "mangler" here (the library says it).

## 5. Loading: no layout shift
The index is read client-side after hydration (IndexedDB, starts on mount). The row is only ever **added to a closed region**: Træning's exercises start collapsed, and a region already open when the read lands gets its row the next time it opens. So nothing visible moves. Read failure: no row, no message (the library owns that error).

## 6. States to shoot (`--dev-fixture clips --dev-today 2026-10-19`, 390px)
S1 Træning, Pause Squat expanded: `Klip sæt 1 ▶ · sæt 2 ▶ · sæt 3 ▶ · sæt 4 ▶` under the last set line. S2 week card, 19 Oct session 1 expanded: rows 25 and 26 one button each (sæt 1, sæt 2), row 27 two (sæt 3, sæt 4). S3 week card 17 Oct (starred clip, sæt 3). S4 the player open from S1. S5 Belastning, same session as S2.

## Acceptance criteria
1. Træning: an expanded exercise with local clips has one Klip row after its last set line; without clips, none; the collapsed row is pixel-identical to before.
2. Week card: each exercise with local clips has the Klip row as its third line, on Træning and Belastning, for every session of the shown week.
3. Set numbers equal the library's for the same clip (fixture: sæt 1–4 over rows 25–27).
4. Every ▶ is the `play` icon (an svg), its target ≥ 44 × 44 px, its name "Afspil klip af <name>, sæt <n>"; reachable by Tab with a visible focus ring.
5. A tap opens the full-screen player on that clip within 100 ms; back, Luk and Escape close it and focus is on the same ▶.
6. Two clips of one set give two buttons, `sæt n` and `sæt n (2)`.
7. A clip marked for delete has no button; after Fortryd it is back.
8. A server clip whose file isn't on the phone shows no ▶ and no text.
9. Loading with an exercise or session already open: no element above or below moves when the index lands (CLS 0 in the shot run).
10. No ▶ is inside a `<label>` or another `<button>` (DOM check).
