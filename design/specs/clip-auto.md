# Spec: clip-auto (slice `clip-auto`, L, copy and placement; user 2026-10-20)

"Får jeg kun løftet uden at klippe selv?" No new control in Fokus: one status line. Builds on `video-record.md`, `video-library.md`, `clip-cut.md` (number format, cut line), `clip-handles.md` (`openClipEditor(row)`). Voice and tokens: DESIGN.md Part B (Ember; no orange, `--rec` only for recording).

**Readings (user decides):**
- R1: the outcome uses clip-cut's format, `Klippet automatisk 12,3–48,0 s`, not `0:12–0:48`. That gives one number format in the app. Option: `0:12–0:48`.
- R2: Fokus shows no `Klip selv` link. The editor lives in Træning's player, and mid-session Fokus keeps one primary action (the done). Option: a link that leaves Fokus.

## 1. Fokus, after Stop
- **Slot:** the last row inside the rest card of the pause view after a recorded set. It holds 2 lines (2 × 18 px), top-aligned, inside the existing `--h-fokus-strip` min-height.
  - The slot is reserved from the moment of Stop, so the card's box never changes (±0 px).
  - Geist 13 muted for the words. Numbers and % in Geist Mono tabular, so the width doesn't jitter.
- **Live region:** `role="status"` (polite). It announces the start line once and the outcome once. The % is `aria-hidden` and never announced.
- **Order of lines** (each one replaces the previous):
  1. Saving: no line until `saveClip` succeeds. If the save fails, there is no analysis, and video-record §8's retry rule applies.
  2. **First run only** (model not cached): `Henter klippemodel … 40 %`. The % comes from bytes received; without Content-Length there is no %.
  3. **Running:** `Klipper video … 40 %`. The % is frames done ÷ frames, in steps of 10.
  4. **clipped:** `Klippet automatisk 12,3–48,0 s`
  5. **low_confidence:** `Kunne ikke finde løftet sikkert. Klip selv i Optagelser under Træning.`
  6. **failed:** `Automatisk klip mislykkedes. Hele videoen er gemt.`
  7. **Cancelled by a new Optag:** the recording strip replaces the rest card, so there is no line. Nothing is written (`auto_status` stays null). The next pause view shows only the new clip's line.
- **Lifetime:** the line stays until the next done or Optag. The analysis carries on after the line is gone, and its outcome shows in Optagelser.
- **Leaving Fokus mid-run** (Minimér, Afslut, back, a reload): the run is aborted with Fokus, nothing is written, and the clip stays `auto_status` null. **Pickup:** when Træning's Optagelser card mounts, it analyses such clips one at a time, newest first: MP4, a local file, recorded in the last 7 days, and not the user's own range. Its row reads `· klipper …` meanwhile. Fokus and the card use one analysis function, so the outcome is the same either way.
- **WebM:** no analysis and no line (it can't be cut, clip-cut §3).
- The rest timer, its minimum signal and every tap keep working while the analysis runs. Feedback stays < 100 ms (DESIGN.md Part A).

## 2. Optagelser (Træning) and the player
- **Row meta** (video-library §5's MonoCaption line) gets one word after the duration:
  - `· klippet`: the user's own range;
  - `· auto-klippet`: `clipped` and no own range;
  - `· klip selv`: `low_confidence` or `failed`;
  - `· klipper …`: running on this phone right now;
  - `· venter på klip`: an MP4 clip with `auto_status` null (not analysed yet; clip-auto-2, user 2026-10-20: never `klip selv`);
  - none: WebM.
  - The status is carried by the word, never by colour alone.
- **Player, cut-line slot** (clip-cut §1, under the title, Geist 13 muted):
  - clipped: clip-cut's line unchanged (`… · automatisk`);
  - low_confidence: `Løftet blev ikke fundet sikkert, så videoen er ikke klippet.`;
  - failed: `Automatisk klip mislykkedes. Gem og Del giver hele videoen.`;
  - running: `Klipper video … 40 %`. Gem and Del give the whole video meanwhile, with no wait;
  - null (MP4, not analysed yet): `Venter på klip`, and the button reads `Klip` (manual clipping still works).
- **Button:** on low_confidence and failed, `Klip` (clip-handles §1) reads **`Klip selv`**, in the same place with the scissors icon, and opens `openClipEditor(row)` at 0 / `duration_s`. An own range still reads `Ret klip` and wins over every auto value.

## 3. States to shoot (`run-web`, port 3100, 390 and 1280)
- **Fokus:** `clip-model`, `clip-running`, `clip-clipped`, `clip-low`, `clip-failed`.
  - Each is `midsession`'s real-tap log (with `--dev-today` on an open session) plus an **injected clip status**.
  - The clip line is the only hand-made part. No taps are faked, and nothing is written.
- **Library:** `clips`, extended with clip 4 `low_confidence` and clip 5 `failed`. Clip 2 (auto 4,2/39,6) is the clipped case.

## 4. Acceptance criteria
1. In `clip-running`, the slot reads `Klipper video … NN %`. The rest card's bounding box equals that of `midsession`'s pause view (±0 px) in every `clip-*` fixture.
2. `clip-model` reads `Henter klippemodel …`. A second run with the model cached never shows it.
3. `clip-clipped` reads `Klippet automatisk 12,3–48,0 s`, with no dot decimal (clip-cut's format helper).
4. `clip-low` and `clip-failed` show §1's lines 5 and 6 verbatim, with no link or button in Fokus.
5. Screen-reader log: exactly one announcement for the start and one for the outcome. No % is announced.
6. Stub the analysis for 30 s. During it, done, Spring over and Fortryd respond in < 100 ms, and the rest timer ticks every second.
7. A new Optag during a run: no `auto_*` write, and no line for the old clip.
8. `clips`: the rows' meta reads `· klippet` (clip 1), `· auto-klippet` (2), `· klip selv` (4, 5).
9. The players for clips 4 and 5 show §2's lines and `Klip selv`. Tapping it opens the editor at 0 / the duration.
10. A WebM clip gets no analysis, no Fokus line, and no meta word.
11. Every new line fits 390 px without truncation. The font check finds no fallback.
