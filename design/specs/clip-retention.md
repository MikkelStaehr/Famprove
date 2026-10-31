# clip-retention (M, spec-lite, 2026-10-31)

**Question:** "Hvor længe bliver klippene på telefonen, og hvad forsvinder af sig selv?" **Action:** none dominant on Træning (Begynd træning stays the one primary action); in the sheet, the keep-time choice. Voice and tokens: DESIGN.md (Ember). No orange, no red: the words carry it. Builds on `clip-line.md` and `clip-delete.md`.

## 1. Rules (what the copy describes)
- An unstarred clip is deleted when it is older than the keep time (from `recorded_at`), or 24 h after it first got `gemt ✓` (download or resolved share; a later save doesn't extend it). ★ is never deleted. Pending clips are never deleted.
- Keep time: 1 / 2 / 4 / 8 uger, default 2. Stored on the phone with the clip index; no new server write path. The deletes use clip-delete's flow (server row, files, entry).
- A clip marked `gemt ✓` before this slice has no save time: its 24 h start at the first open after deploy, never at once.
- The cleanup runs on Træning's open whenever a clip is due (not only once a day), so "slettes om" is true.

## 2. Keep time in "Alle klip"
- Place: directly under the space line (sheet item 1), above item 2.
- A radio group, label `Behold klip i`, options `1 · 2 · 4 · 8 uger` as a segmented row: native radios in 44px labels, Geist 13. Selected = `--surface-2` fill + `--text` and the radio's checked state; unselected `--text-muted`. Never colour alone: the space line repeats the choice in words. 2px `--focus` outline.
- Space line follows the choice: `544 MB af 10,7 GB · ældre end 2 uger slettes, gemte efter et døgn (★ beholdes)`. Singular `1 uge`.
- A change applies at the next open. If the new time would delete clips, a muted line under the row: `Næste oprydning sletter 3 klip.`
- Before the first answer (or after `Ikke nu`): no option is selected, the space line keeps today's sentence (`ældre end 8 uger slettes automatisk (★ beholdes)`), and a muted line says `Vælg en tid for at slå den nye oprydning til.`

## 3. The 24 h rule on a clip
- Row meta and player meta, unstarred: `0:36 · klippet · gemt ✓ · slettes om 18 t` (hours rounded down; under 1 h `slettes om under 1 t`; once due `slettes ved næste åbning`). Not a live countdown; computed at render. ★ clips: `gemt ✓` only. Screen reader: `gemt eller delt fra appen, slettes om 18 timer`.

## 4. The one-time confirm
- **Where:** inline on the Optagelser line, as row 3 under the actions (no sheet on open: it must not block the gym). While "Alle klip" is open it shows at the top of the sheet instead, never both.
- **When:** the first cleanup under the new rules (default 2 uger) that would delete ≥ 1 clip. It stays until answered. With N = 0 the rules switch on silently.
- **Words:** `Oprydning sletter 7 klip: 5 ældre end 2 uger, 2 gemt for over et døgn siden. ★ beholdes.` A part with 0 is left out. Geist 13 `--text`.
- **Answers:** `Slet 7` (secondary dark button, `trash` 16, not filled like Begynd træning) and `Ikke nu` (quiet text button). Both ≥ 44px.
- **Ikke nu:** the prompt goes and isn't shown again on open. Today's 8-week rule keeps running silently. Choosing a keep time in the sheet shows the same confirm there (with that time's N); `Slet N` there switches the rules on.
- After `Slet N`, later cleanups are silent; the sheet's cleanup line (item 4) says `Oprydning i dag: 3 klip slettet.`

## 5. Fortryd
- **Yes** for the confirmed batch: it is the user's tap, so it gets the Slet-gemte batch Fortryd (`deleteWindowText` + countdown, same window, restores all, no server write). Focus goes to `Alle klip` (or the sheet's first row) after.
- **No** for the silent daily cleanup, as today.

## 6. States
- **Loading:** no prompt until the index has landed (no N flashing). **Empty:** no prompt; the radio group still shows in the sheet. **Error** (server read failed): the prompt still shows; a failed delete follows clip-delete's error line, and the clip stays.

## 7. Acceptance criteria
1. With no stored choice and ≥ 1 clip due, the line shows row 3 with the sentence, `Slet N` and `Ikke nu`; N equals the sum of its parts, and parts at 0 are left out.
2. `Slet N` deletes exactly those clips via clip-delete's flow, shows the batch Fortryd; Fortryd within the window restores all with no server write.
3. `Ikke nu` hides the prompt; reopening Træning doesn't show it; nothing is deleted by the new rules; the 8-week rule still runs.
4. In the sheet, picking a keep time while unanswered shows the confirm there; with N = 0 it switches on silently.
5. The radio group has label `Behold klip i`, 4 options, default `2 uger` once on; each option ≥ 44 px, keyboard-operable (arrows), visible focus.
6. The space line names the chosen time and the 24 h rule; `1 uge` singular.
7. An unstarred `gemt ✓` clip reads `slettes om N t`; a ★ clip never does and is never deleted; a pending clip is never deleted.
8. A pre-slice `gemt ✓` clip is not deleted on the first open after deploy.
9. After the first answer, later cleanups show no prompt and no Fortryd; the cleanup line counts them.
10. Begynd træning stays the only filled button on Træning; no orange, no red.

**Shots** (`--dev-fixture clips --dev-today 2026-10-19`; the fixture gives one unstarred `gemt ✓` clip saved > 24 h ago, one 6 h ago, one ★, and ≥ 1 clip older than 2 weeks; dev switches write nothing): S1 390 px the line with the prompt; S2 390 px "Alle klip" with the radio group, space line and a `slettes om 18 t` meta; S3 390 px after `Slet N` with Fortryd; S4 390 px after `Ikke nu` (line without prompt, sheet unselected); S5 1280 px the sheet.
