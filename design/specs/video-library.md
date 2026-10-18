# Spec-lite: video-library (slice `video-library`, M; user 2026-10-17)

"Hvilke sæt har jeg på video, og hvor meget plads tager de?" The one new surface is the **Optagelser card** on Træning, directly under the InverseCard (desktop: left column, under it). Recording: `video-record.md`. Look: Card, ListRow, Buttons in DESIGN.md Part B.

**Readings (user decides):**
- R1 Play opens a **full-screen player** (Del, ★, Slet live there; rows stay one tap). Option: play inline in the card.
- R2 "fil mangler" + Slet only in a browser that has a clip index (has recorded). A browser without one (the desktop) lists rows read-only with `på telefonen`, so a desktop Slet can never orphan a phone's file.
- R3 The card shows the 3 newest rows, then `Vis alle 23` (keeps the Form card high). Option: 5.

## Card
1. Card 22, padding 18. Header: SectionTitle `Optagelser` ↔ MonoCaption 12 `23 klip`.
2. **Space line** under it, Geist Mono 12 muted: `412 MB af 18 GB · ældre end 8 uger slettes automatisk (` + 12px `Star` icon + ` beholdes)`; sr text `stjernemarkerede beholdes`. Used = the sum of this phone's clips (index); "af" = `storage.estimate().quota`; under 1 GB in whole MB, else GB with one decimal (`ui` formats at render, never literal).
3. **Not persisted** (`storage.persisted()` false): a WarningLine under the space line: `Chrome har ikke lovet at beholde optagelserne. Mangler telefonen plads, kan de blive slettet.` + Geist 13: `Læg Famprove på startskærmen for at beskytte dem.`
4. **Cleanup** (once a day on Træning's open, from `recorded_at`, never a starred clip, never by the server's ★ alone: the local ★ wins): when it deleted something, one muted Geist 13 line that day: `3 optagelser ældre end 8 uger blev slettet i dag.`

## Rows (newest first, ListRow, min 56px)
5. The row is one `<button>` (opens the player) except its ★: leading 18px `Play` (muted) | name stack (variant Geist 15/500, exercise name Geist 13 muted under it when a variant is set; never truncated) with MonoCaption 12 muted under it: `lør. 17. okt · sæt 2 · 0:48` | ★ icon button 44 × 44 (`Star`, filled `currentColor` when on, `aria-pressed`, name `Behold altid`). Row sr: `Afspil Squat, sæt 2, 17. oktober, 48 sekunder.`
6. **★** saves locally at once (< 100ms), then syncs; a failed sync adds `ikke synkroniseret` (MonoCaption 11 muted) to the meta line and retries on the next open.
7. **Afbrudt** clips (no row): meta `sæt 2 · afbrudt · 0:31`; no ★; Del and Slet in the player.
8. **fil mangler** (a row with no file, R2): no Play, not a button; meta `fil mangler`; a dark compact **Slet** (44) on the right, no confirm (no video is lost), name `Slet oplysningen om Squat, sæt 2, 17. oktober`. Status after: `Oplysningen er slettet.` A failed delete keeps the row and its Slet (the retry) and shows, as a WarningLine next to it: `Klippet blev ikke slettet. Prøv igen.` (user 2026-10-18; replaces `Oplysningen blev ikke slettet. Prøv igen.`)
9. **Can't record here** (unsupported or a preview host) and no rows: the card is absent. Unsupported with rows: the list shows, plus muted Geist 13 `Denne browser kan ikke optage video.`

## Player (R1)
10. Full-screen `role="dialog"`, `aria-modal`, `#000` fill, background `inert`. Top: `X` icon button `Luk` (44) + the name stack and `sæt 2 · lør. 17. okt` (MonoCaption 12). Middle: `<video controls playsinline>` from an object URL (revoked on close), contained, no autoplay sound (none recorded). Bottom bar, gap 8: **★ Behold altid** / **★ Beholdes** (dark, `aria-pressed`), **Del** (`Share2`), **Slet** (`Trash2`). Closes by Luk, Escape, the back gesture; focus returns to the row.
11. **Del:** Web Share with the file (`canShare({files})`); absent when unsupported, with muted `Deling af video virker ikke i denne browser.` While the file is read the label is `Forbereder …`. Cancelled: nothing. Failed: `Kunne ikke dele videoen. Prøv igen.`
12. **Slet** (the user's confirm): the bottom bar becomes Geist 14 `Slet videoen fra telefonen? Den kan ikke hentes igen.` (a starred clip adds ` Den er markeret til at blive beholdt.`) + **Slet video** and **Behold** (both dark; focus on Behold). Slet video deletes the file, then the row; the player closes and the card announces `Videoen er slettet.` A failed row delete leaves a §8 row, which is its retry.

## States
- **Loading:** 2 skeleton rows at 56px (only after 300ms; the index is local).
- **Empty** (recording possible, nothing yet): the card with header and one Geist 14 muted sentence: `Ingen optagelser endnu. Tryk Optag på et arbejdssæt i Fokus. Videoen bliver på telefonen.`
- **Error, local:** ErrorState in the card: `Kunne ikke læse optagelserne på telefonen.` · `Browserens lager svarede ikke.` · **Prøv igen**.
- **Error, rows:** the local clips show; WarningLine `Kunne ikke hente oplysningerne om optagelserne. Stjerner gemmes, når forbindelsen er tilbage.`
- **Stale:** none (the list is local and live).
- `DEV_FIXTURE=clips`: 5 clips (2 today, 1 starred), 1 afbrudt, 1 fil mangler, a persisted warning; the player shows a `--track` box `Testvisning: ingen video`; nothing is written, deleted or shared.

## Acceptance (390 × 844 and 1280, tester)
1. `clips`: the card sits directly under the InverseCard, header `23 klip`-style count, the space line with numbers from `estimate()`, 3 rows and `Vis alle`.
2. ★ toggles `aria-pressed` and the icon fill at once; the cleanup never deletes a locally starred clip (unit test on the cleanup rule with an 8-week-old starred and unstarred clip).
3. Slet → confirm sentence → Slet video removes the file and the row; Behold changes nothing.
4. A fil mangler row has no Play and a Slet without confirm; on a browser with no index it reads `på telefonen` and has no Slet.
5. `empty` / no clips: the empty sentence; on a preview host with no rows the card is absent.
6. Every control ≥ 44 × 44, keyboard-reachable, visible focus; the player traps focus and returns it to its row.
