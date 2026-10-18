# Spec: video-record (slice `video-record`, L; user 2026-10-17)

"● Optag" / "■ Stop = sæt udført". The one new surface is the **record control in Fokus**. Builds on `fokus-flow.md` (set = pause layout), `fokus-sheet.md` (bar, sheet), `button-type.md`, DESIGN.md Part B. Data: `public.video_clips` (migration `20261017120000`); the video stays on the phone (OPFS + IndexedDB index).

**Readings (user decides):**
- R1 Stop **is** the done: while recording, the dock's one light button reads **■ Stop · Sæt 2 udført**. Option: a separate dark Stop next to the done (two taps, and the done is no longer the only primary).
- R2 Decided (user 2026-10-18, slice `rec-indicator`): the recording disc is the new `--rec` red (DESIGN.md Part B), with the word `OPTAGER` and a running time; `--rec` is used for nothing else.
- R3 Rear camera (`facingMode: environment`), no switch in phase 1. Option: front camera, or a switch before recording.
- R4 An "afbrudt" clip is **kept** on the phone (no row, no done), listed in Optagelser with Del and Slet, no ★. Option: discard it.

## Where and when
1. **Placement:** inside the next-set hero card, on its bottom row: **● Optag** (dark, 44px, compact, left) and **Spring over** (dark, right). Both act on this set. The dot is a 8px CSS disc in `--text` (not the ● glyph, not an icon), `aria-hidden`.
2. **Shown only when all hold:** the view is a working set (`kind` `set`/`pause`; never the warm-up, the warm-up clock or the finished view); the host is production or `next dev` (server flag, never preview URLs); `navigator.mediaDevices.getUserMedia`, `MediaRecorder` with `video/mp4;codecs=avc1` or else `video/webm`, and OPFS exist. Otherwise the button is absent and nothing explains it in Fokus (Træning's card says it, `video-library.md` §9).
3. **Low space:** when `storage.estimate()` leaves less than `MIN_FREE_MB` (constant, start 300) the button is replaced by a muted Geist 13 line: `Ikke plads til video: under 300 MB ledigt. Slet optagelser under Træning.`

## Recording state
4. **One tap starts.** The button shows `Venter på kamera …` (with the permission prompt on first use) until `MediaRecorder` fires `start`; then the state below appears at once. 720p, 30 fps, no audio; chunks are written to OPFS every second.
5. **Recording strip** takes the rest strip's slot (Card 22, padding 16, `min-height: var(--h-fokus-strip)`, the same token as the rest card, DESIGN.md Part B › Space; the rest timer stops being shown, nothing is written). Left: label row `OPTAGER` (MonoCaption 13 `--text`) ↔ `SÆT 2 · UDEN LYD` (MonoCaption 13 muted); under it, at the column's bottom, the **counter** `● 0:12`: a 20px `--rec` disc (`aria-hidden`, 8px gap) and the running time in Geist Mono 600 64px, line-height 1, `--text`, tabular, from `0:00` to `15:00`, readable at 3 m (DESIGN.md Part B › Recording counter). The left column is 12px from the preview. Right: the **live preview**, a box 88 × 128 (radius 10, 1px `--border`, `--bg` letterbox, `object-fit: contain`, never cropped, not mirrored), `aria-hidden`. The hero card (name, reps, `I DAG` kg) does not move or shrink.
6. **Bigger preview:** the preview is a button (`aria-label="Vis kameraet stort"`); a tap lays it over the hero card at full card width (9:16, at most the hero card's height), a second tap or Escape shrinks it (`Vis kameraet lille`). The dock stays visible.
7. **Controls while recording:** the dock reads **■ Stop · Sæt 2 udført** (light; an 10px `--inverse-text` CSS square instead of the check). Optag becomes **Annullér optagelse** (dark, `X` icon): stops, keeps the clip as afbrudt (R4), no done. Spring over is hidden. Fortryd's row reads `Stop optagelsen for at fortryde` (muted). The bar is not a button (no chevron) so no jump can move the set under the clip. Afslut stops the clip as afbrudt, then leaves as today.
8. **Stop = done.** The tap fires the existing done unchanged at the tap's time and stops the recorder in the same tap. The done never waits for the video: the view moves to the next set at once (< 100ms), the file is finalised, then the row is inserted (`id` = the phone's uuid, so a retry is the same row). A failed insert is retried at Træning's next open; the clip shows `ikke synkroniseret` there.
9. **Limit:** at 15:00 (`duration_s ≤ 900`) the recorder stops by itself; the strip shows `Optagelsen stoppede ved 15:00. Den gemmes med sættet.` and the dock returns to **✓ Sæt 2 udført**.
10. **Haptics:** `navigator.vibrate?.(30)` once on `start` (confirms it really records). None on stop. The rest-minimum vibration (`fokus-flow.md` §3) is suppressed while recording, so it never shakes the frame; its announcement still fires.
11. **Motion:** the `--rec` disc pulses opacity 1 → 0.7 → 1 over `--dur-rec-pulse` (1.2 s, `ease-in-out`, infinite; 0.7 keeps it ≥ 3:1), only while recording; the preview grows in 240ms `--ease`. Under `prefers-reduced-motion` the disc stays, steady at opacity 1, and the preview snaps. Nothing else animates.

## Permission, errors
12. **First use:** the tap goes straight to Chrome's prompt (no pre-screen; the button label says it is waiting).
13. **Denied** (prompt refused, or `permissions.query({name:'camera'})` is `denied` on load): under the hero card's bottom row, a WarningLine: `Kameraet er blokeret for Famprove.` + Geist 13: `Tillad det i Chrome: ⋮ › Indstillinger › Webstedsindstillinger › Kamera. Sættet kan stadig markeres udført.` Optag stays (a tap retries).
14. **Errors** replace the strip with a WarningLine (what, why, next) and the dock returns to **✓ Sæt 2 udført**; the set is never marked done by an error:
    - no space while recording: `Optagelsen stoppede: telefonen løb tør for plads. 0:42 er gemt som afbrudt. Sættet er ikke markeret udført.`
    - recorder or camera fails: `Optagelsen stoppede: kameraet svarede ikke. 0:12 er gemt som afbrudt. Sættet er ikke markeret udført.`
    - backgrounded (`visibilitychange` → hidden): stop at once; on return `Optagelsen blev afbrudt, da appen gik i baggrunden. 0:31 er gemt som afbrudt under Optagelser. Sættet er ikke markeret udført.`
    - nothing usable written (< 1 s): `… Intet blev gemt.` instead of the duration part.
    The line stays until the next done or Optag.

## Accessibility and copy
15. Optag: name `Optag sæt 2, Squat`. While recording a polite status: `Optager sæt 2.` (the time is never announced). Stop: name `Stop, sæt 2 udført, 2 af 4, Squat` (starts with the visible words). After it the existing done status gets a prefix: `Video gemt, 48 sekunder. Squat, sæt 2 udført. …`. Errors are announced once, assertive. Focus after Optag: the dock's Stop; after Stop: the next primary (as every done).
16. Under DEV fixtures nothing is written and no camera opens: `Testvisning: sæt gemmes ikke.` stays.

## Fixtures
- `recording`: `pause` with the recording state, the time frozen at `0:48`, the preview a `--track` box with `Testvisning` (Mono 11 muted).
- `camera-denied`: `pause` with §13's line.

## Acceptance (390 × 844, tester)
1. `pause`: `● OPTAG` sits in the next-set card's bottom row beside `SPRING OVER`; the warm-up and finished views have no Optag; on a Vercel preview URL there is none.
2. `recording`: the strip shows `OPTAGER`, the time and an 88 × 128 preview; reps, the `I DAG` kg and the dock are visible without scrolling, and the hero card's box is the same as in `pause` (±0px).
3. `recording`: the one light button reads `■ STOP · SÆT 2 UDFØRT`; Spring over is gone; the bar has no chevron and opens nothing.
4. With a stubbed recorder: Optag writes no set-log row; Stop writes exactly the done the plain done writes (same row, `ended_at` = tap time), then one `video_clips` row.
5. Hiding the page while recording: no done, no row, the afbrudt line on return, the clip in Træning's list as afbrudt.
6. `camera-denied`: §13's line and Optag visible; the done still works.
7. `vibrate` stubbed: 30 once on start; not at the rest minimum while recording; also under reduced motion.
8. Reduced motion: the disc does not animate (computed `animation-name: none`).
9. Status texts and accessible names match §15; every new button ≥ 44 × 44 with a visible focus ring; the font check finds no fallback.
