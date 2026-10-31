# Spec-lite: clip-approve-all (Godkend auto-klip)

**Question:** "Can I keep only the lift from today's clips without opening each one?" It is one quiet action on the Optagelser line (`clip-line.md`). It is destructive, so it gets Fortryd for 10 s and never a confirm. Voice and tokens: DESIGN.md (Ember). No orange, no red: the words carry it.

## 1. The button
- **Place:** row 2 of the line, **first**, before `Gem alle fra i dag · n` and `Slet gemte · n`. It is the same quiet text button (Geist 13 `--text`, Lucide `scissors` 16 in `--text-muted`, min-h-11, `whitespace-nowrap`, 2px `--focus` ring). Row 2 already wraps (`flex-wrap gap-x-4`), so no label wraps inside itself.
- **Words:** `Godkend auto-klip · 3`. It is hidden when N = 0, and row 2 goes when all three buttons are hidden.
- **N counts a clip only when all of these hold:** its date is today; `auto_status` = `clipped`; reps found **= exactly** the expected reps (`expectedReps`); it is the original file (not already cut, no own range); and no cut or delete is pending on it.
- **Data:** the found count (`reps` in auto-clip's `clipped` result) must be on the clip's index entry. A clip without a stored count is **not** counted (missing never means exact). tech-lead decides where the count is stored.

## 2. While cutting
- **Within 100 ms of the tap**, the button reads `Klipper 1 af 3 …`, then `Klipper 2 af 3 …`, and so on. It is disabled and keeps its width (min-w set to the widest label). `Gem alle` and `Slet gemte` are disabled until the batch is done.
- Clips are cut one at a time, each to its automatic in/out (margin 1.0 s), by the same cut as `Gem klip` (clip-trim §2).
- **Screen reader:** one polite announcement at the start, `Klipper 3 klip.`, and none per clip.

## 3. Done (status row 3, clip-line §3)
| State | Line |
|---|---|
| All cut | `3 klip klippet · ` + dark **Fortryd 9** (≥ 44 px; counts 10→1 in text, not live) |
| Some failed | `2 klip klippet, 1 kunne ikke klippes · ` + **Fortryd 9**. The failed clip stays whole and untouched. |
| All failed | `Kunne ikke klippe de 3 klip. Videoerne er urørte. ` + `Prøv igen` |
| At 0 | `3 klip klippet · 42 MB frigjort.` (MB measured at render). The space figure updates within 1 s. |
- **Screen reader:** `3 klip klippet. Fortryd muligt i 10 sekunder.` once.
- **Focus:** the button is gone (N = 0), so focus goes to `Alle klip`. It never lands on Fortryd.
- **Order with other windows:** a delete window comes first, then this one (clip-line §3).
- **Server:** one write per cut clip, at 0, as clip-trim §3. None during the window, none on Fortryd, none under DEV_TODAY or DEV_FIXTURE. A reload inside the window follows clip-trim's rule for a single cut.

## 4. Fortryd
It restores every clip of the batch to its original (same bytes and duration) and deletes the cut files. Local only. Line: `Fortrudt · 3 klip er hele igen.` The button comes back with the same N. Focus goes to it.

## 5. Skipped clips
The line adds no note. `Klip selv` clips (low_confidence, failed) keep their `· klip selv` meta in Alle klip. **R1 (user decides):** a `clipped` clip with a count off by one shows no new meta, so the user can't tell why it was skipped. The option is the meta `· 4 af 5 løft fundet`, which is the words only.

## 6. Shots (`--dev-fixture clips --dev-today 2026-10-19`, 390 px)
The fixture must hold at least 2 clips with an exact count, 1 that is off by one and 1 `Klip selv`. Extend it if it doesn't.
- **S1:** the line with `Godkend auto-klip · 2` first in row 2.
- **S2:** mid-batch, `Klipper 2 af 2 …`.
- **S3:** done, `2 klip klippet · Fortryd` with ≥ 8 left, and the button absent.
- **S4:** after Fortryd: `Fortrudt · 2 klip er hele igen.` and the button back.

## Acceptance criteria
1. The button shows `Godkend auto-klip · N` first in row 2 only when N > 0. N counts today ∧ `clipped` ∧ found = expected ∧ original file ∧ not pending.
2. A clip with a count off by one, a `Klip selv` clip, a cut clip, a clip with an own range, a pending clip, a clip from another day and a clip with no stored count are never counted or cut.
3. `Klipper 1 af N …` appears within 100 ms of the tap, and the counter steps per clip. The button keeps its width, and Gem alle and Slet gemte are disabled while it runs.
4. Each clip is cut to its automatic in/out (margin 1.0 s), by the same cut as `Gem klip`.
5. Done shows `N klip klippet · Fortryd` with a 10 s text countdown. A partial failure names both counts and leaves the failed clip whole.
6. Fortryd within 10 s restores every clip of the batch (same bytes and duration), deletes the cut files and makes no server write. At 0, exactly one server write per cut clip. None under dev switches.
7. One announcement at the start, one at done, one at Fortryd and one at failure. Focus never lands on Fortryd. Every control is ≥ 44 × 44 px, reachable by Tab, with a visible focus ring. No state is shown by colour alone.
