# Spec-lite: clip-handles (slice `clip-handles`, M; user 2026-10-20)

"Kan jeg selv sætte start og slut på klippet?" One primary action: `Gem klip`. Builds on `clip-cut.md` (number format, cut line, `cutRange`); voice and tokens from DESIGN.md (Ember). No orange: the accent stays the today marker.

## 1. Entry
- Player button row (kind `clip`, MP4 only; WebM can't be cut, so no button): `Klip` with the scissors line icon, after `Del`/`Gem`, before `Slet`. With the user's own range: `Ret klip`.
- `clip-auto` adds `Klip selv` on low confidence. It opens **the same editor** (`openClipEditor(row)`), so there is one editor and one start rule.
- Start rule: user's `clip_in_s`/`clip_out_s` → else `auto_*` with status `clipped` → else 0 and `duration_s`.

## 2. Editor (390 px)
The editor replaces the button row, as Slet's confirm does. The title, cut line and video stay. While the editor is open, the video has no native controls, so the drag can't clash with them.
- **Readout** (Geist Mono 15, `text`), one row above the strip: `Start 12,3 s` on the left, `35,7 s` length in muted in the centre, `Slut 48,0 s` on the right. Format: clip-cut's helper.
- **Strip:** 48 px tall, `rounded-card`, `bg-track`, the full clip width.
  - The range is a 2 px `text` frame (top and bottom).
  - Outside the range is `track` at 50 %.
  - During `Afspil klip`, a 2 px muted playhead.
- **Handles:** 4 × 48 px `text` bars, each with a 44 × 48 px hit area centred on the bar. Each is `role="slider"`, `aria-label` `Start` / `Slut`, and `aria-valuetext` `12,3 s`.
  - Range: `aria-valuemin`/`max` are 0 … out − 1 for Start and in + 1 … duration for Slut. The handles can't cross, and the range is at least 1,0 s; a drag past that stops at the limit.
  - Keys: ←/→ ±0,1 s, PageUp/PageDown and Shift+←/→ ±1 s, Home/End to the limit.
  - Focus is DESIGN.md's focus ring around the bar.
  - Pointer capture on the hit area.
- **Preview:** while a handle moves (drag or key), the video seeks to its time, at most once per frame (`fastSeek` where it exists). The readout updates in the same frame.
- **`Afspil klip`:** plays in → out once, then stops at in. It reads `Stop` while playing.
- **Motion:** only the handle follows the finger, with no easing. Nothing animates under `prefers-reduced-motion` (there is nothing to animate).

## 3. Actions and copy
Buttons: `Gem klip` (Ember's primary, the one filled button), then `Afspil klip`, `Fortryd`, and `Fjern klip` (only when the user's own range exists). Each is ≥ 44 px.
- `Fortryd` closes the editor without writing.
- `Gem klip` writes in/out rounded to 0,1 s.
  - While saving: `Gemmer …`, disabled, the width unchanged.
  - Saved: the editor closes; the status line says `Klip gemt.`
- `Fjern klip` uses undo, not a confirm. It writes both values as null and closes, and the cut line goes back to auto or to none. The status line says `Dit klip er fjernet.` with a `Fortryd` button that writes the old values back, until the player closes.
- **Failed save** (network, 5xx): the editor stays open with the handles where they were. The line under the buttons: `Klippet blev ikke gemt. Tjek forbindelsen og prøv igen.` It has a `Prøv igen` button that resends the same values.
- **Refused, clip not on the server:** `Klippet kan ikke gemmes, fordi videoen ikke findes på serveren. Gem og Del giver hele videoen.` The handles stay.
- **Refused for other reasons** (a bad range: can't happen through the UI): `Klippet kan ikke gemmes. Prøv at flytte håndtagene.`
- All lines are `role="status"`, Geist 13 muted. An error line also starts with ◆ in `--warning` ink, so meaning is never colour alone.

## 4. After saving
- The cut line shows the new range without `· automatisk`, e.g. `Klippet 12,3–48,0 s · 35,7 s`.
- The row's `clipInS`/`clipOutS` are updated in memory from the server's reply, so `cutRange` uses them at once for Gem, Del and Gem alle.

## 5. Server action
`setClipRange(id, inS, outS)` sits next to `starClip` in `actions.ts` → `lib/db/video-clips.ts`. It is one PATCH of `clip_in_s`/`clip_out_s` and returns the stored values. Both values are numbers, or both are null.
- **Server-side checks:**
  - it rounds to 0,1;
  - it refuses 0 > in, in ≥ out, out − in < 1,0, out > `duration_s` (read on the server), or 0 rows matched (`not_found`);
  - it refuses a preview host, the same as `saveClip`.
- **Dev switches:** writes nothing and returns the values as if saved. Exception: the `clips` fixture's third clip (no range) returns a network failure, so the failed line can be shot.

## 6. States to shoot (`run-web`, port 3100, `--dev-fixture clips`, 390 and 1280)
1. Clip 1 (user range 12,3/48,0): the cut line, then `Ret klip`. The editor opens with the handles at 12,3 / 48,0.
2. The same, with Tab to `Start`: the focus ring is visible, then →×3 gives `Start 12,6 s`.
3. Clip 2 (auto 4,2/39,6): `Klip` opens the editor at 4,2 / 39,6.
4. Clip 3 (no range): the editor opens at 0 / the duration. `Gem klip` → the failed line with `Prøv igen`.

## 7. Acceptance criteria
1. `Klip` shows on an MP4 clip with no user range, and `Ret klip` with one. There is no button on WebM, afbrudt or missing rows.
2. The editor starts at the user range, else the clipped auto range, else 0 / `duration_s` (shots 1, 3, 4).
3. Each handle is a `role="slider"` with the label, min, max, now and valuetext above. The arrows move it 0,1 s, PageUp/PageDown 1 s, Home/End to the limit, and the handle can't cross the other one or make the range shorter than 1,0 s.
4. Each handle's hit area measures ≥ 44 × 44 px at 390 px, and the focus ring is visible (shot 2).
5. Moving a handle seeks the video to its time. The readout uses clip-cut's format (unit test: 62,3 → `1:02,3`), and no dot decimal appears.
6. `Afspil klip` plays in → out once and stops at in.
7. `Gem klip` sends the values rounded to 0,1. Afterwards, the cut line shows the range without `automatisk`, and the next Gem gives a ` klippet` file at that range without a reload.
8. `Fortryd` writes nothing (no request). `Fjern klip` writes null/null, and its `Fortryd` restores the old range.
9. Server tests:
   - it refuses in ≥ out, out − in < 1, out > `duration_s`, in < 0, and one value null;
   - an unknown id gives `not_found`, and the UI shows the refused line;
   - a preview host is refused.
10. Idempotence: the same (id, in, out) sent twice gives one row state and two OK replies.
11. Under `DEV_TODAY`/`DEV_FIXTURE`, no request reaches Supabase (asserted in a test).
12. A failed save keeps the editor and the handles. `Prøv igen` sends the same values (shot 4).
