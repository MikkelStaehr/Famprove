# Spec-lite: clip-trim (slice `clip-trim`, L; user 2026-10-20)

"Can I cut the clip so the file *is* the clip?" One primary action: **Gem klip** (the user's name, R1). It cuts the file on the phone at keyframes, without re-encoding, from the keyframe at or before the in point, and replaces the original in the app. It amends `clip-mark.md` (Slut her no longer saves) and `clip-handles.md` (its primary cuts the same way). Voice and tokens: DESIGN.md (Ember). No orange.

**R1 (user decides):** `Gem` downloads (user, stays). A second button `Gem klip` beside it reads as "download the clip", which it isn't. The spec uses **`Gem klip`** for the cut (Klipper …, Klippet til …). Option: keep `Gem klip`; only the button word changes, the other lines stay.

## 1. Wording set
| Action | Button | Busy | Done |
|---|---|---|---|
| Download (`clip-save`) | `Gem` | `Forbereder …` | `Sendt til Downloads som …` |
| Destructive cut | `Gem klip` | `Klipper …` | `Klippet til 0:36,2 (fra 0:51,8)` |
| Mark, `clip-delete` | — | — | `gemt ✓` (downloaded or shared; sr `gemt eller delt fra appen`; the user's word, R1). |

The handles editor's close-without-writing `Fortryd` becomes **`Annullér`**. `Fortryd` then always means undo.

## 2. Flow in the player (390 px)
1. **Start her:** as in clip-mark §2.1. It sets a pending in point and writes nothing.
2. **Slut her:** sets a pending out point. It saves nothing.
   - The cut line reads `Start 12,3 s · Slut 48,0 s · 35,7 s` with `Ryd` at its end. Ryd clears both points.
   - With no Start, in = 0.
   - The refused rule stays: out − in < 1,0 gives clip-mark's ◆ line, and nothing is set.
   - A Start moved past out − 1,0 clears out, with `Slut ryddet: den lå før start.`
3. **Gem klip:** Ember's filled primary, full width, `min-h-14`, directly under the mark row. It shows only while both points are pending and valid, so a bad cut can't be started.
   - **Tap:** within 100 ms it reads `Klipper …` (disabled, width unchanged). Both marks are disabled. The video pauses.
   - **Done:** the player loads the new file at 0, and its duration and the list row show the new length. The status row under the button row reads `Klippet til 0:36,2 (fra 0:51,8) ·` + a dark **Fortryd 10** button (≥ 44 px).
     - The length is the file's measured duration, so a start up to 1 s early is shown, not explained.
     - The number counts down once a second, in Geist Mono tabular.
   - **Failed:** `◆ Klippet lykkedes ikke. Hele videoen er urørt.` + **Prøv igen**, which cuts at the same points again. The points stay.
     - Out of space adds ` Telefonen mangler plads.` before `Hele`.
     - The original is replaced only after the new file is fully written and its duration read back, so a half file never exists.

## 3. Fortryd's 10 s
- **Window:** the original stays in OPFS. The index marks it with its deadline. Closing the player doesn't end the window early.
- **Fortryd:** the original is the clip again and the cut file is deleted. Line: `Fortrudt · hele videoen er tilbage (0:51,8).` The points come back as pending, so Gem klip can be tapped again at once. Focus → Gem klip.
- **At 0:** the original is deleted, and Fortryd goes. Line: `Klippet til 0:36,2 · 14 MB frigjort.` (MB measured at render.) The Optagelser space line updates within 1 s.
- **Page closed in the window:** the next library load deletes any original past its deadline. A clip never shows twice.
- **Server:** one write at 0, never during the window, so Fortryd is local only. The stored ranges no longer apply, and the duration is the new one (tech-lead picks the fields). It is idempotent, and a failed write retries on the next library load. Dev switches write nothing.
- **Screen reader:** the polite region announces `Klippet til 0:36,2. Fortryd muligt i 10 sekunder.` once, not every tick.

## 4. Handles editor (`Klip` / `Ret klip`)
- Its primary is **Gem klip**, with the same busy, done, failed and Fortryd lines as §2.3 and §3. The editor closes on done.
- `Annullér` closes without writing.
- `Fjern klip` only shows for an old stored range (§5). It clears that range, as before.

## 5. What disappears, and old marks
- **After a cut:** there is no cut line (`Klippet a–b s` and `· automatisk` don't apply, because the file is the clip), and no "Vis hele".
  - The button reads `Klip`, and it opens the editor at 0 / the new duration over the shorter file. A second cut cuts again.
  - Gem, Del and Gem alle send the file as it is, without ` klippet`.
- **The parked automatic clip** (`auto_*`) never cuts and never pre-fills a point.
- **Old `clip_in_s`/`clip_out_s`** (clip-mark, clip-handles): the clip is never cut automatically.
  - The player opens with the stored range as pending points (`[ Start 12,3 s`, `Slut 48,0 s ]`). The cut line reads `Dit klip 12,3–48,0 s · ikke klippet endnu`, with Gem klip showing.
  - Until it is cut, Gem and Del keep clip-cut's cut-on-demand.

## 6. Shots (`run-web`, 3100, `--dev-fixture clips`, 390 + 1280)
The fixture simulates the cut. On clip 1 (0:51,8), the keyframe is 11,8, so the result is 0:36,2. Clip 3's cut fails.
1. Clip 1, Start then Slut: the pending line and Gem klip.
2. Clip 1 right after Gem klip: `Klippet til … · Fortryd` with ≥ 8 left.
3. Clip 1 after 11 s: the `frigjort` line, the new length in the row, and the space line.
4. Clip 1, Fortryd: the result line, with the points pending again.
5. Clip 3, Gem klip: the failed line + Prøv igen.
6. An old stored-range clip: `ikke klippet endnu` with its points pre-filled.

## 7. Acceptance criteria
1. Start her and Slut her send no request and write no file. Slut her leaves `clip_in_s`/`clip_out_s` unchanged (a test asserts no `setClipRange`).
2. Gem klip shows only with both points pending and out − in ≥ 1,0. It is ≥ 56 px tall, full width, and the only filled button on the screen.
3. `Klipper …` appears within 100 ms of the tap.
4. A cut file starts at or before in (in − start ≤ the clip's largest keyframe gap) and ends at out ±0,1 s. It is not re-encoded (same codec and bitrate), and the done line shows its measured duration.
5. A cut that fails, including on a full disk, leaves the original byte-identical and playable (failure-injection test at write, read-back and swap).
6. Fortryd within 10 s restores the original (same bytes and duration) and deletes the cut file. At 0 the original is deleted and the space line drops within 1 s.
7. An original past its deadline on library load is deleted. No clip is listed twice.
8. Exactly one server write per committed cut, at 0. None on Fortryd, and none under DEV_TODAY/DEV_FIXTURE.
9. After a cut: no cut line, the button reads `Klip`, the editor opens at 0 / the new duration, and Gem's name has no ` klippet`.
10. `auto_*` never triggers a cut. An old stored range opens as pending points and is never cut without a tap (shot 6).
11. The handles editor's Gem klip passes 3–8. `Annullér` writes nothing.
12. One polite announcement per cut, Fortryd and failure (§3). Focus never lands on Fortryd. The user's words ship: `Gem klip`, `gemt ✓` (R1 kept them).
