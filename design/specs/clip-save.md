# Spec-lite: clip-save (slice `clip-save`, M; user 2026-10-20)

"Hvordan får jeg klippene af telefonen?" **Gem** downloads one clip, **Gem alle fra i dag** downloads all of today's. The file goes to Chrome's Downloads through `<a download>` from a blob URL. Nothing goes to the server. Library and player: `video-library.md`. Pure parts live in `web/src/lib/video/save.ts`: the name builder, plus the sequence with download, read and sleep injected.

**Readings (user decides):**
- R1: per-clip Gem sits **in the player only**, so a row keeps two targets (Play, ★). Option: a third 44px icon on the row.
- R2: Del keeps its slug name (`squat-2026-10-19-saet-2.mp4`). Option: Del uses Gem's name too.

## Where
1. **Player** bottom bar, in this order: ★, Del, **Gem** (thin `Download` icon, DARK_BTN), Slet. Shown for `clip` and `afbrudt` rows. It is shown even where Del is not, because a download works in every browser. While the file is being read it says `Forbereder …` (it uses the same read as Del). After the tap, a status line (Geist 13 muted, `role="status"`): `Sendt til Downloads som 2026-10-19 Squat sæt 2.mp4.`
2. **Card**: a compact DARK_BTN `Gem alle fra i dag · 4` (Download icon, self-start), placed under the space line and warnings and above the rows. Its status line sits directly under it. The count is the number of rows with `date` = the app's today (DEV_TODAY respected) and kind `clip` | `afbrudt`. `missing` and `remote` rows never count. **When the count is 0 the button is absent**, and it is also absent on a browser with no clip index. It stays secondary, because Træning's primary is still Begynd træning. The word is Gem, never "original": after `clip-cut`, Gem saves the cut version under the same name.

## File name (`clipFileNames(rows) → id → name`)
3. `<date> <shown name> sæt <n>[ afbrudt][ klip k].<ext>`, for example `2026-10-19 Squat sæt 2.mp4` or `2026-10-19 Tempo squat sæt 1 afbrudt.webm`.
   - Shown name: the variant's display name, else the exercise (as the row shows it).
   - n: the row's `set`, the run's set number.
   - ext: the row's `ext`.
   - æøå are kept. `/ \ : * ? " < > |` and control characters become `-`. Spaces are collapsed and trimmed. The name part is cut at 60 characters. No uuid.
4. **Several clips of one set**: when 2+ rows share date, shown name, set and ext, every one of them gets ` klip 1`, ` klip 2` … in `recordedAt` order (ties: id). The builder always runs over **all** local rows, so a clip gets the same name from Gem and from Gem alle.

## Gem alle: the sequence
5. Tap → the button is disabled and reads `Gemmer 2 af 4 …`; the status line says the same. Clips go out oldest first by `recordedAt`. For each clip: read the file from OPFS → `URL.createObjectURL` → click a detached `<a download=name>` → wait `DOWNLOAD_GAP_MS` = 400 (one constant) → next clip.
6. **Blob URLs**: never revoked on click (Android's download manager reads the URL after the click). Each URL is revoked `REVOKE_AFTER_MS` = 60 000 after its click, and every one still open is revoked on unmount and `pagehide`. Each URL is revoked exactly once.
7. **Chrome's multiple-download prompt** (count ≥ 2): while running, the status line says `Chrome spørger måske, om siden må hente flere filer. Vælg Tillad.` The page can't see a block, so the done line says what to check.
8. **Done**: the button returns. The line reads `4 klip sendt til Downloads. Mangler nogle, har Chrome blokeret flere filer: Chrome › Indstillinger › Websiteindstillinger › Automatiske downloads › Tillad. Ellers tryk Gem på det enkelte klip.` A single clip skips the second sentence. A per-clip Gem is a tap of its own, so the prompt never blocks it.
9. **Page hidden mid-run**: the sequence stops after the current clip. The line reads `Stoppet ved 2 af 4.` and the button reads `Gem resten · 2` until reload, so nothing is downloaded twice.

## Errors
10. **The index has the clip but OPFS has no file**:
    - In Gem alle the clip is skipped and the rest continue. The done line adds `1 fil mangler på telefonen: Squat sæt 2.` (a list, max 3 names, then `og 2 til`), and the library reloads, so the row becomes a §8 `fil mangler` row.
    - In the player, Gem says `Videoen findes ikke længere på telefonen.` and the row turns `fil mangler` on close.
11. **A read fails** (the storage doesn't answer): the clip is treated as in §10, but the line says `kunne ikke læses` instead of `mangler`, and nothing is deleted.
12. A download that Chrome itself marks failed is invisible to the page; §8's "Tjek …" sentence covers it.
13. `DEV_FIXTURE=clips`: `Gem alle fra i dag · 2` runs with a fake download (no file, no URL) and the lines prefixed `Testvisning:`. Nothing is written.

## Acceptance (390 × 844 and 1280, tester)
1. Name builder unit tests:
   - `2026-10-19 Squat sæt 2.mp4`
   - a variant's display name wins
   - `.webm` from ext
   - `afbrudt`
   - two clips of one set → `klip 1` / `klip 2` by recordedAt, the same whether given one row's context or all rows
   - `Squat / pause` → `Squat - pause`
   - æøå kept
   - no uuid
   - the name part ≤ 60 characters
2. Sequence unit test with a fake download, read and clock:
   - 4 clips → 4 downloads oldest first, ≥ 400 ms apart
   - progress 1..4
   - each URL revoked exactly once, at 60 s or at abort
   - a missing file is skipped and named in the result, and the others still download
   - abort after clip 2 → result has 2 remaining
3. `clips`: the card shows `Gem alle fra i dag · 2` above the rows. With no clips today the button is absent, and it is absent on a browser with no index.
4. The player shows Gem for a clip and an afbrudt clip. The tap gives the `Sendt til Downloads som …` line.
5. Every new control is ≥ 44 × 44, keyboard-reachable, with visible focus. Progress and done lines are announced (`role="status"`).
6. The save path makes no network request and calls no server action. Check it in the browser's network panel during Gem alle; reviewer checks `save.ts` imports nothing from `actions`.
