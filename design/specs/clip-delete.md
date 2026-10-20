# clip-delete (spec-lite, M)

"Can I get rid of clips I've already kept somewhere else, safely?" One primary action per surface stays as it is (the player: Gem klip when pending, else none dominant). Slet is a secondary dark button with Fortryd, never a confirm, except on ★. Voice and tokens: DESIGN.md (Ember). No orange, no red: the words carry it. The user's words: `Slet`, `Fortryd`, `gemt ✓`, `Slet gemte`.

## 1. Flow
- **Where Slet is:** the player only, last in its button row (as today). List rows stay play · name · meta · ★. A row Slet beside the ★ at 390px invites mis-taps, and `Slet gemte` covers bulk. A `missing` row keeps its own Slet.
- **Clip without ★:** Slet → the player closes at once, the row leaves the list (150 ms collapse; none under `prefers-reduced-motion`), and the delete line (§3) shows. No confirm; the old `Slet videoen fra telefonen? …` confirm goes.
- **Clip with ★:** Slet opens the inline confirm in the player's place: `Denne video er markeret Behold altid. Slet den alligevel?` with `Slet alligevel` (dark) and `Behold` (text button, focused first). `Slet alligevel` then works like the unstarred case, with Fortryd.
- **Slet gemte:** sits in the same group as `Gem alle fra i dag`, directly under it, sharing its status line, so `clip-line` moves the group as one. It counts clips marked `gemt ✓`, without ★ and not pending: `Slet gemte · 3`. Absent at 0. One tap, no confirm: all of them leave the list at once as one batch.
- **At the deadline (10 s):** tech-lead's order (server DELETE → files → index entry last). A reload inside the window hides the rows and finishes after the deadline, with no Fortryd.
- **Overlap:** a new delete while one is pending lets the older batch run to its own deadline. The line shows the newest one, and Fortryd undoes only that one.
- **The 8-week cleanup** is unchanged and never deletes a ★. If it meets a pending entry, the delete path finishes it (idempotent, never twice).

## 2. The `gemt ✓` mark
- Set after Gem, Gem alle fra i dag, or a share that resolves (not AbortError or cancel). Local only. It survives a cut (same clip), and it is never cleared by Fortryd.
- **Row meta:** `0:36 · klippet · gemt ✓`, after clip-auto's word and before `· ikke synkroniseret`. The dot wraps with the word. Screen reader: `gemt eller delt fra appen`.
- **Player:** the same ` · gemt ✓` on its meta line under the title. It appears within 100 ms of Gem or Del resolving.

## 3. Copy and lines (one polite status line, under the Gem alle / Slet gemte group)
| When | Line |
|---|---|
| Single, in the window | `Slettet · Squat · sæt 2 · ` + dark **Fortryd 9** button (≥ 44 px; counts 10→1 in text) |
| Batch, in the window | `3 klip slettet · ` + **Fortryd 9** |
| Fortryd (single / batch) | `Fortrudt · Squat · sæt 2 er tilbage.` / `Fortrudt · 3 klip er tilbage.` |
| At 0 | `Slettet · 14 MB frigjort.` / `3 klip slettet · 42 MB frigjort.` (MB measured at render). The space line updates within 1 s. |
| Server DELETE failed | `Videoen er skjult, men ikke slettet endnu: serveren svarede ikke. Appen prøver igen, når du åbner Optagelser.` (batch: `3 klip er skjult …`) |
- Screen reader: one announcement per delete: `Slettet. Fortryd muligt i 10 sekunder.`, not every tick. Then one for Fortryd, one for 0 and one for a failure.
- **Focus:** after a delete it goes to the next row's play button (else the previous row's, else the Optagelser heading), never to Fortryd. After Fortryd it goes to the restored row's play button (batch: the first restored row).

## 4. States to shoot (`DEV_FIXTURE=clips`, 390 px; dev switches write nothing, no server DELETE)
The fixture marks 3 clips `gemt ✓` through the same flag setter Gem uses, 1 of them with ★.
1. The list: `gemt ✓` in 3 metas, and `Slet gemte · 2` under `Gem alle fra i dag`.
2. The player of an unstarred `gemt ✓` clip: `gemt ✓` in its meta, Slet last.
3. The player of a ★ clip after Slet: the confirm.
4. Right after a single Slet: the list without the row, `Slettet · … · Fortryd` with ≥ 8 left.
5. Right after Slet gemte: `2 klip slettet · Fortryd` with ≥ 8 left, and the button absent (count 0).
6. After Fortryd (single): the row is back with `gemt ✓`, and the Fortrudt line shows.
7. At 0: the `frigjort` line.

## 5. Acceptance criteria
1. The player has Slet for every clip. List rows have no Slet except `missing` rows.
2. An unstarred clip deletes without a confirm. A ★ clip shows §1's confirm text, and `Behold` leaves it untouched.
3. A deleted clip leaves the list within 100 ms, and the line shows `Fortryd` with a 10 s text countdown.
4. Fortryd within 10 s restores the row(s), the same file and `gemt ✓`, and makes no server write.
5. At 0, exactly one server DELETE goes out per clip (none under DEV_TODAY/DEV_FIXTURE), then the file goes, then the index entry. The space line drops within 1 s.
6. A reload inside the window keeps the rows hidden and finishes the delete after the deadline. A failed DELETE leaves file and index in place, shows §3's failure line, and retries on the next library load.
7. `gemt ✓` appears after Gem, Gem alle fra i dag and a resolved share, and never after a cancelled share. It is always the word, never colour or an icon alone.
8. `Slet gemte · N` counts `gemt ✓` ∧ ¬★ ∧ ¬pending, is absent at 0, never deletes a ★ clip, and its Fortryd restores the whole batch.
9. The 8-week cleanup still runs, never deletes a ★, and never deletes a clip twice.
10. One announcement per delete, Fortryd, 0 and failure. Focus never lands on Fortryd. Every button is ≥ 44 px and keyboard-reachable with a visible focus state.
