# Spec-lite: Hent data nu (slice `refresh-button`, M)

**Question:** "Can I have today's numbers now, without waiting for 05, 12 or 20?" **Action:** one quiet ↻ on the "opdateret" text. A utility, never a primary action: no fill, no orange, no button chrome.

## 1. Control (one shared client component on Træning, Belastning, Analyse)
- **Glyph:** new `refresh` in `web/src/components/icons.tsx` (none exists): `M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4` (open clockwise arc, arrowhead top right), house style (24 viewBox, 1.5 stroke, butt caps). Size 16, `aria-hidden`. DESIGN.md Part B "Icons" gets the line.
- **Placement:** directly after the time, 6px visual gap. Time and ↻ are one `whitespace-nowrap` pair, so the ↻ never wraps alone at 390px (Træning's stale line can wrap before the pair).
- **Hit target:** `<button type="button">` 44 × 44, glyph centred, `-my-3.5 -ml-2 -mr-3.5`, so the 12px mono line keeps its height. Nothing interactive within 14px above or below the line: Analyse's gap from the line to the tabs grows from 12 to 16px; `ui` checks Belastning's header the same way.
- **Name:** `aria-label="Hent data nu"`, `title` the same (hover only repeats it).
- **Colour:** `--text-muted` when fresh; `--text` when stale or unknown (that is when it helps). Hover `--text`; `:active` opacity 0.85.
- **Focus:** 2px `--focus` ring, 2px offset, on a 28px round area inside the target (a 44px ring is too loud on a caption line).
- **Stale / unknown:** Belastning and Analyse show the WarningLine instead of the plain line, so the ↻ goes after its sentence (in `--text`). Træning keeps it on the mono line after "forældet · opdateret 13. okt. 05.00" or "opdatering ukendt". When the refetch turns stale into fresh, focus stays on the ↻: one button in a stable wrapper, never unmounted.

## 2. Flow
Tap → within 100ms the glyph spins and the status line says "henter data …" (before POST answers) → `started` → poll → the time changes, "data hentet" for 5 s. Two taps ≥ 5 min apart; one tap per run.
- **Pending:** the glyph rotates 360° per 1.2s, linear, from tap until polling ends. `aria-disabled="true"` (focus stays; taps do nothing). Reduced motion: no rotation, the static glyph at `--text`; the status text carries it.

## 3. Copy (status line under the updated line)
One `role="status"` (polite) region, always in the DOM, empty when idle. Neutral = Geist Mono `text-12` `--text-muted` in lowercase like "opdateret". Failures = `WarningLine` (warning icon + `text-13` `--text`).

| Outcome | Text | Kind | Stays |
|---|---|---|---|
| tap, before reply | henter data … | neutral | until the reply |
| `started`, polling | henter data … ca. 1 min | neutral | until the run ends |
| done, ok | data hentet | neutral | 5 s |
| `running` | en hentning kører allerede · venter på den | neutral | poll as `started`* |
| `wait` (s) | hentet for nylig · kan hentes igen kl. 05.17 | neutral | until that time |
| `unavailable` | hentning er ikke slået til her · data hentes kl. 05, 12 og 20 | neutral | until reload |
| `error` | Hentningen kunne ikke startes, fordi GitHub ikke svarede. Prøv igen om lidt. | warning | until the next tap |
| run failed | Hentningen fejlede, så tallene er uændrede. Prøv igen, eller vent på kl. 05, 12 eller 20. | warning | until the next tap |
| 5 min, no result | intet svar efter 5 min · genindlæs siden senere | neutral | until the next tap |

`wait`: the time is now + seconds, rounded up to the minute, Copenhagen time, "05.17" style; it never counts down. *If GET status cannot follow a run it did not start, `running` shows "en hentning kører allerede · prøv igen om 1 min" and does not poll. All texts come from one pure function, so `node --test` can check them.

## 4. States
Loading: Pending above. Empty: where a screen shows no "opdateret" line (Belastning and Analyse without data), there is no ↻ (user, 2026-10-15); an "opdatering ukendt" line still has one. Error: rows `error` and run failed (warning); the 5-min row is neutral (user, 2026-10-15). Stale: §1. Under `DEV_TODAY` / `DEV_FIXTURE` the server answers `unavailable`.

## Acceptance criteria
1. R1 Træning, Belastning and both Analyse tabs show the 16px `refresh` glyph right after the updated time, at 390 and 1280px, fresh and `stale`; a screen without an updated line (`empty`) has no ↻; the ↻ never sits alone on a wrapped line.
2. R2 The button is 44 × 44, named "Hent data nu", reachable by Tab, with a visible 2px focus ring; the updated line is no taller than without it, and no other target is within 14px of the line.
3. R3 Within 100ms of a tap the glyph spins and the status region reads "henter data …"; while pending a second tap sends no request.
4. R4 With `prefers-reduced-motion: reduce` nothing rotates and the status text still shows.
5. R5 Each outcome shows exactly the §3 text in the §3 style, inside one `role="status"` region; `error` and run failed render as WarningLine, the rest (the 5-min case included) in muted mono.
6. R6 After a successful run the updated time changes without reload, "data hentet" goes after 5 s, a stale WarningLine disappears, and focus stays on the ↻.
7. R7 Under `DEV_FIXTURE=stale` a tap shows the `unavailable` text and the ↻ is `--text`; nothing orange anywhere in the control.
