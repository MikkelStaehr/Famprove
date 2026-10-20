# Spec-lite: clip-mark (slice `clip-mark`, M; user 2026-10-20)

> **Amended by `clip-trim.md` (2026-10-20):** Slut her only sets the out point and saves nothing; the cut is `Gem klip` (destructive, Fortryd 10 s). §2.2's saving/saved/Fortryd lines, criteria 4, 6, 7 and shots 3–4 are replaced by clip-trim §2–3 and §7. Start her, Ryd, the refused line and §3 focus stay.

"Can I cut the clip while I watch it?" One primary action: **Slut her ]**, which saves. It builds on `clip-handles.md` (save path `setClipRange`, status lines, Fortryd pattern) and `clip-cut.md` (number format, cut line). The handles editor (`Klip` / `Ret klip`) stays as it is and becomes the fine-tuning. There is no orange.

## 1. Entry and placement (390 px)
- **Mark row:** one row directly under the video, above the existing button row (`Behold altid · Del · Gem · Klip/Ret klip · Slet`), gap 8px.
- **Buttons:** two dark buttons, `flex-1` each, so each is half the width. Each is `min-h-14` (56px, Ember's stepper/feel height), `text-button`.
- **Labels:** `[ Start her` and `Slut her ]`. The brackets are Geist Mono ASCII in `aria-hidden` spans (they are in the latin subset, so no system font). The accessible names are `Start her` and `Slut her`.
- **When the row shows:** only on an MP4 `clip` with a server row, which is the same rule as `Klip`. There is no row on WebM, afbrudt or missing rows.
- **When the row hides:** while the handles editor or Slet's confirm is open. Opening the editor clears a pending Start.
- **Video:** the row sits outside the video, so it never clashes with the native controls. The video keeps playing through every tap. A tap reads `video.currentTime` at click time, rounded to 0,1 s and capped at `duration_s`.

## 2. Flow and copy
1. **Start her:** sets a pending in point and writes nothing.
   - The button turns `--raised` fill and reads `[ Start 12,3 s`, so the change shows by the words as well as the fill.
   - The cut line (under the title) is replaced by `Start 12,3 s · tryk Slut her`, with a `Ryd` text link (≥ 44px hit area) at its end. Ryd drops the pending Start, and the old cut line comes back.
   - Tapping Start again moves the pending in to the current position.
2. **Slut her:** sets out = now. In = the pending Start, else the user's `clip_in_s`, else the clipped `auto_in_s` (`cutRange`), else 0.
   - **Refused** when out ≤ in or out − in < 1,0. Nothing is written, and the pending Start stays. Line: `◆ Slut skal ligge mindst 1,0 s efter start (12,3 s). Lad videoen spille videre, og tryk igen.`
   - **Saving:** Slut reads `Gemmer …` and is disabled, with its width unchanged. Start is disabled too.
   - **Saved:** the pending Start clears. The cut line shows the new range (`Klippet 12,3–48,0 s · 35,7 s`, no `automatisk`). The status line reads `Klip gemt · 12,3–48,0 s.` with a dark **Fortryd** button (≥ 44px) on the same line.
     - It is the status row clip-handles uses for `Dit klip er fjernet.`, directly under the button row.
     - The row's `clipInS`/`clipOutS` update from the reply, as in clip-handles §4.
   - **Failed** (network/5xx): `◆ Klippet blev ikke gemt. Tjek forbindelsen og prøv igen.` with **Prøv igen**, which resends the same in/out. The cut line keeps the old range. A not-on-server refusal uses clip-handles' line.
3. **Fortryd:** one `setClipRange` back to the range stored before this mark: the old values, or null/null.
   - With an old range: `Fortrudt · klippet er igen 4,2–39,6 s.`
   - With none: `Fortrudt · dit klip er fjernet.` The cut line goes back to auto or to no line.
   - Fortryd shows until the player closes or a new mark is saved, which replaces it with that mark's own previous range.
   - If Fortryd fails: `◆ Fortryd blev ikke gemt. Tjek forbindelsen og prøv igen.` + **Prøv igen**.

## 3. Accessibility
- **Status region:** one polite `role="status"`, the existing range line. It announces `Start sat ved 12,3 s.`, `Gemmer …`, the saved, refused and failed lines, and the Fortryd result. The pending cut line is not live, so nothing is announced twice.
- **Focus:** stays on the tapped button after Start and Slut. Ryd → Start her. Fortryd → Slut her, because Fortryd is gone. Prøv igen keeps focus. Focus never moves onto Fortryd, so a second Enter can't undo by accident.
- **Keyboard and contrast:** both marks are real buttons, in tab order after the video and before the button row, and usable while the video plays. Error lines start with ◆ in `--warning` ink, never colour alone.

## 4. States to shoot (`run-web`, 3100, `--dev-fixture clips`, 390 + 1280)
The fixture has no video, so the marks read a **fixture playhead**: clips 1 and 3 read 12,3 s before a pending Start and 48,0 s after it; clip 2 reads 4,8 s. Dev switches write nothing, and clip 3's save fails, as in clip-handles §5.
1. Clip 1 at rest: the mark row above the button row.
2. Clip 1 after Start: `[ Start 12,3 s`, the preview cut line with Ryd.
3. Clip 1 after Slut: the cut line `Klippet 12,3–48,0 s · 35,7 s`, `Klip gemt · …` + Fortryd.
4. Clip 1 after Fortryd: the result line.
5. Clip 2, Slut with no Start (auto in 4,2, out 4,8): the refused line.
6. Clip 3, Start then Slut: the failed line + Prøv igen.

## 5. Acceptance criteria
1. The mark row shows only on MP4 clips with a server row, directly under the video and above the button row. It is hidden while the editor or Slet's confirm is open.
2. Each mark measures ≥ 56px tall and is half the row's width (±4px) at 390px. No glyph renders in a system font (font check).
3. Start writes nothing (no request) and doesn't pause a playing video (`paused` stays false). It shows `[ Start x s` and the preview line. Ryd restores the old cut line.
4. Slut sends one `setClipRange` with in by the §2.2 rule and out = currentTime, both rounded to 0,1 and out ≤ `duration_s`. With no Start, in = the user's in, else the clipped auto in, else 0 (unit test over all three).
5. out ≤ in or out − in < 1,0 → no request, the refused line, and the pending Start is kept (shot 5).
6. Saved: the cut line and the next Gem use the new range without a reload. `Gemmer …` appears within 100ms of the tap, and the width is unchanged.
7. Fortryd sends exactly one write with the previous stored range (null/null when none) and shows §2.3's line. It stays until the player closes or the next mark saves.
8. A failed save keeps the old cut line. Prøv igen resends identical values (shot 6).
9. The polite region announces each line in §3 once. Focus follows §3, and no tap moves focus onto Fortryd.
10. Under `DEV_TODAY`/`DEV_FIXTURE`, no request reaches Supabase.
