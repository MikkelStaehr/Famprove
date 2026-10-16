# Spec-lite: button-type (user 2026-10-15; scope Fokus + Træning only, the user's answer; Belastning's FTP choices keep their look)

"Al knaptekst er Geist Mono, 15px, medium, versaler, letter-spacing .04em. Kun den primære 'Udført' er lys. Alle andre er mørke med kant, som Afslut og Fortryd." Rule and tokens: DESIGN.md Part B › Type (`text-button`) and Components › Buttons. Supersedes the button parts of `reset-fokus.md` §4 and `reset-traening.md` §3.

- **Label:** `font-mono` 15px 500, `text-transform: uppercase`, `letter-spacing: 0.04em`, line-height 1.2. Source text stays sentence case ("Sæt 2 udført"), so screen readers do not spell it.
- **Light (one):** `--inverse-bg` fill, `--inverse-text` label, no border, 56px, `--radius-button`. Only Fokus's done (`✓ Sæt n udført`, `✓ Opvarmning udført`); the check is the `check` icon, 18px.
- **Dark (all others):** `--card` fill (`--inverse-text` inside the `InverseCard`), 1px `--text-muted` border, `--text` label, `--radius-button`, ≥ 44px (48 in a card, 56 stepper and feel choices). Begynd/Fortsæt træning, Afslut, Fortryd, Spring over, Tilbage til Træning, Lettere/Som ventet/Hårdere, stepper − / +, Gem igen, Prøv igen.
- Pressed: opacity 0.85, no scale (Motion). Focus: 2px `--focus` ring at 2px offset (on the `InverseCard`: `--inverse-text`).
- Nothing else changes: positions, sizes of the dock, copy and logic stay.

## Acceptance (390 and 1280, `DEV_FIXTURE=midsession`, `pause`, `exercise-end`; Prøv igen on `/load`)
- **B1** Every `<button>` and button-styled link on `/train` and `/fokus` renders its label in Geist Mono 500, 15px, uppercase, letter-spacing 0.6px (computed style); the font check finds no fallback. Not buttons in this sense: the exercise rows on Træning that open and close (their label is the exercise name, Geist 16; tester 2026-10-15 asked, kept as rows) and icon-only buttons (↻, stepper − / +).
- **B2** `/fokus` has at most one element with `--inverse-bg` fill per view, and it is the done; the finished view and `/` have none.
- **B3** Every other button has a 1px border whose colour is `--text-muted` and a dark fill; border contrast ≥ 3:1 against its surround, computed by `ui` at render.
- **B4** Spring over is a bordered button ≥ 44px, no longer an underlined link.
- **B5** Feel choices: selected shows `--raised` fill + check icon + `aria-pressed="true"`; labels that wrap stay inside 56px.
- **B6** Accessible names contain the visible words (WCAG 2.5.3); screen readers read "Sæt 2 udført", not letters.
- **B7** Every button ≥ 44 × 44 and keyboard-focusable with a visible ring.
