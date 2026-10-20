# Spec-lite: clip-cut (slice `clip-cut`, L, text only; user 2026-10-20)

"Får jeg kun det stykke, jeg vil se?" Gem, Gem alle fra i dag and Del give the **cut** when the clip has an in/out (the user's `clip_in_s`/`clip_out_s`, else `auto_*` with status clipped, else none). The cut is made on the phone on demand, never stored; the original stays. No new screen and no new control: only the lines below. Voice: DESIGN.md (short, Danish, no "keyframe" except on Kameratest).

**Reading (user decides):** R1: the cut file name gets ` klippet` (§2), which supersedes `clip-save.md` §2's "same name": Downloads then tells cut from whole. Option: keep the same name.

## Number format (one helper, all lines)
Seconds with one decimal and a decimal comma: `12,3 s`. From 60 s: `m:ss,d`, e.g. `1:02,3`. A range uses an en dash with no spaces: `12,3–48,0 s`.

## Lines
1. **Player, cut line**: its own line directly **under the title row**, above the video. Geist Mono 13, muted (numbers), never the accent.
   - user's: `Klippet 12,3–48,0 s · 35,7 s`
   - automatic: `Klippet 12,3–48,0 s · 35,7 s · automatisk`
   - no in/out or WebM: no line (WebM: see §3).
   The figures are the in/out as set, not the actual start (that is only known after the cut, §2).
2. **Gem's and Del's done line** (cut): `Sendt til Downloads som 2026-10-19 Squat sæt 2 klippet.mp4 · 11,8–48,0 s.` The range is the cut file's **actual** start and end, so a start up to 1 s early is shown, not explained. Del: `Delt · 11,8–48,0 s.` only if Del already shows a done line; else nothing new.
   - File name: clip-save's name + ` klippet` before the ext: `2026-10-19 Squat sæt 2 klippet.mp4`, `… sæt 2 klip 2 klippet.mp4`. Del uses the same name (clip-save: Del shares Gem's name). A whole file never gets the word.
3. **WebM** (cannot be cut): the cut line (§1) is replaced by `Kan ikke klippes på denne telefon. Gem og Del giver hele videoen.` The done line is clip-save's plain line (no ` klippet`).
4. **Cut failed**: `Klippet lykkedes ikke. Sendt til Downloads som 2026-10-19 Squat sæt 2.mp4 (hele videoen).` Del: `Klippet lykkedes ikke. Delt hele videoen.` The name has no ` klippet`. Never a half-written file.
5. **Gem alle, done**: the count line splits only when not all are cut the same way: `4 klip sendt til Downloads: 3 klippet, 1 hele videoen.` All cut or none cut: clip-save's line unchanged. A failed cut counts as `hele videoen`. Clip-save's Chrome sentence follows as before.
6. **Kameratest**: after the 4 s test clip, one line under the result (Geist Mono 13): `Nøglebilleder hvert 1,0 s (største afstand 1,05 s) · MP4 H.264`. Two decimals on the largest gap; the format is the recorder's mime type in plain words (`MP4 H.264`, `WebM VP9`). Values are measured on the test clip at render time, never literals.
   - Largest gap > 1,5 s, a second line in `--warning` ink with the ◆ mark (never colour alone): `◆ Et klip kan starte op til 2,4 s for tidligt.` (the measured largest gap, one decimal).
   - WebM: `◆ WebM kan ikke klippes. Gem og Del giver hele videoen.`
   - No keyframes read: `Afstanden kunne ikke måles.`
7. **Busy**: from tap until the file is handed over, Gem reads `Klipper …` and Del reads `Klipper …` (replaces `Forbereder …` when there is a cut; whole files keep `Forbereder …`). Disabled while busy, width unchanged. Gem alle: `Gemmer 2 af 4 …` as before (no extra word).

All done/error lines are clip-save's status line (`role="status"`, Geist 13 muted); the cut adds no new element except §1's line and §6's lines.

## Acceptance (tester, 390 and 1280)
1. Format unit test: 12.34 → `12,3 s`; 62.3 → `1:02,3`; range → `12,3–48,0 s`; no dot decimal anywhere in clip-cut's lines.
2. Player under `clips` with a user in/out shows `Klippet …–… s · … s` on the line under the title; an auto in/out adds `· automatisk`; a clip with neither shows no line.
3. Gem on a cut MP4: the downloaded name ends ` klippet.mp4` and the done line's range equals the cut file's measured start/end (start ≤ in, in − start ≤ the clip's largest keyframe gap).
4. A WebM clip shows §3's line instead of the cut line; Gem's name has no ` klippet`. A forced cut failure gives §4's line and a whole, playable file without ` klippet`.
5. Gem alle over 3 cut + 1 whole ends with `4 klip sendt til Downloads: 3 klippet, 1 hele videoen.`; 4 cut ends with the plain clip-save line.
6. Kameratest shows §6's line with measured values; a fixture gap of 2,4 s shows the ◆ warning line in `--warning` ink with the word, not colour alone; the busy text `Klipper …` appears within 100 ms of the tap and is announced.
