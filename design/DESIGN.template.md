# Design system – <PROJECT>

Contract between `design-lead` (owns this file) and `ui` (builds).

- **Part A: Guardrails.** Fixed. They apply to every project.
- **Part B: Direction.** Chosen per project by design-lead in Mode 0. This is where the product gets its own identity.

---

## Product profile
- **Product type:** <!-- data dashboard / booking flow / form-heavy tool / marketing site / ... -->
- **Primary users & context:** <!-- who, which device, where, how often -->
- **Platform:** <!-- mobile web / desktop internal tool / PWA / ... -->
- **Locale:** <!-- da-DK / en-GB; date, number and currency formats follow this -->
- **References the user likes:** <!-- 2–3 apps/sites + what specifically -->
- **Pattern packs:** <!-- design/patterns/data-dashboard.md -->

---

# Part A – Guardrails (fixed)

## UX
- One primary purpose and at most one primary action per screen, and that action is visually dominant.
- Mobile first: design at 390px, then let it grow.
- Every data view has a designed loading, empty, error and (if relevant) stale state. Never a blank area.
- Error messages say what happened and what to do. Undo is preferred over confirmation.

## Accessibility
- [ ] WCAG 2.2 AA contrast in every theme: text ≥ 4.5:1; large text, icons and control borders ≥ 3:1.
- [ ] Colour never carries meaning alone.
- [ ] Semantic HTML (`main`, `nav`, headings in order, `button` vs `a`).
- [ ] Everything works by keyboard, with a visible focus state.
- [ ] Icon-only buttons have `aria-label`. Images have `alt`.
- [ ] Text zoom to 200% doesn't break the layout.
- [ ] `prefers-reduced-motion` respected. All motion has a reduced alternative.

## Interaction
- Touch targets ≥ 44×44px. Nothing essential on hover only.
- Feedback < 100ms. Progress shown for anything > 1s. Skeletons for content areas.
- Forms: visible labels, validate on blur, the error goes next to the field, correct `type`/`inputmode`/`autocomplete`, and input is kept on error.

## Technical
- Tokens only: no magic values in components.
- Fonts are self-hosted (e.g. `next/font`), max 2 families.
- UI library: <!-- shadcn/ui + Tailwind for Next.js -->, **always themed by Part B. Never the default look.**

---

# Part B – Direction (per project)

## Personality
<!-- Three words, plus one sentence on how it should feel to use. -->

## Signature element(s)
<!-- The 1–2 things that make this product recognisable. -->

## Type
- Display: <!-- family, weights -->   Text: <!-- family, weights -->
- Scale: <!-- e.g. 12 / 14 / 16 / 20 / 28 / 40 / 56 -->
- Numerals: <!-- tabular / proportional; where -->

## Colour
- `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--positive`, `--warning`, `--negative`, `--focus`
- Values for light and dark: <!-- -->
- Accent usage: <!-- what the accent is for, and what it is never for -->

## Shape & depth
- Radius: <!-- per role -->
- Borders vs. shadows: <!-- -->
- Elevation levels: <!-- -->

## Space & density
- Spacing scale: <!-- default 4-pt: 4, 8, 12, 16, 24, 32, 48, 64 -->
- Density: <!-- airy / balanced / compact -->
- Max content width: <!-- -->

## Motion
- Character: <!-- e.g. quick and precise, 150–200ms, ease-out -->
- Where it's used: <!-- state changes, number transitions, ... -->

## Iconography & imagery
<!-- Icon set, stroke weight, illustration/photo style if any -->

---

## Project rules
<!-- Product-specific rules and overrides. -->
