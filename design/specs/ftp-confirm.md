# Spec: FTP-advarsel der kan bekræftes (slice `ftp-confirm`, L) + §A FTP på Analyse (slice `ftp-analyse`, M)

**Question:** "Is my FTP wrong, and can I say it isn't?" No new primary action on Belastning: the warning stays a header line, and its choices are secondary. Python picks the state (`warning | quiet | plain | none`); the web only renders it. Orange never appears (it is the today marker only).

## 1. The four states (in `ScreenHeader` children, where `notices` render today, `load/page.tsx` ~l.126)
| State | Shows | Style |
|---|---|---|
| `warning` | the existing WarningLine text, as a disclosure button (§2) | WarningLine: 16px warning icon `--warning` + Geist `text-13` `--text` |
| `quiet` | `FTP 230 W · ikke testet siden 17. maj` · null date: `FTP 230 W · ikke testet de sidste 52 uger` | MonoCaption `text-12` `--text-muted`, no icon, not interactive |
| `plain`, suppressed | `FTP 230 W · bekræftet · tjekkes igen 14. dec.` | as `quiet` |
| `plain`, not suppressed / `none` | nothing | |
- The quiet line sits first in the header children, 8px under the "opdateret … ↻" line and its status region; it is plain text, so refresh R2 (no target within 14px) holds. Dates: `17. maj`, `14. dec.`; the year only when it is not this year (`17. maj 2025`).
- The suppressed line needs Python to give `suppressed_until` (null when not suppressed): **data need**, goes in the slice's one migration/view.

## 2. The warning as a disclosure
- The whole WarningLine is one `<button type="button" aria-expanded aria-controls>`: icon, sentence, then an inline 16px `chevron-down` in `--text` after the last word (wraps with it, never alone). No fill, no border, text left-aligned. Hit area ≥ 44px tall via vertical padding; its box starts ≥ 14px under the updated line's status region (refresh R2), so the header grows by about 6px only in this state.
- Name: the sentence + sr-only ", vælg svar". Hover: the sentence underlined. `:active` opacity 0.85. Focus: 2px `--focus` ring, 2px offset, radius `--radius-control` around the line.
- Open: the chevron rotates 180° (150ms; 0 under reduced motion). The panel appears with no height animation, ever.
- **Panel** (under the sentence, indented 24px to align with its text, 10px above): two secondary buttons in a `flex-wrap` row, gap 8px, 44px tall, `--radius-button`, 1px `--text-muted` border, Geist 15/500 `--text`, padding 0 14px: **`230 W er rigtigt`** and **`Jeg har rettet FTP`** (W from the data). Neither is filled: this is not the screen's primary action. Escape or a second tap on the line closes it and keeps focus on the line.

## 3. After a choice (one write; the warning hides at once, optimistic)
Within 100ms the button and panel are replaced in place by one result line in a `role="status"` region that is always in the DOM: 16px `check` icon `--text` + Geist `text-13` `--text-muted` sentence + a `Fortryd` text link (`--text`, underlined, 44px hit area). Focus moves to `Fortryd`. The line stays until reload or navigation (no timer; the undo must not run away).
- `230 W er rigtigt` → "Skjult i 60 dage, eller til FTP ændres, eller et hårdt tag flytter eFTP mere end 5 %." (No date here: Python owns date arithmetic; after the next run the quiet line names `suppressed_until`.)
- `Jeg har rettet FTP` → "Tjekkes igen ved næste kørsel – eller tryk ↻ øverst for at hente nu." (No slot time: the web computes nothing.)
- **Fortryd** (guardrail: undo over confirm; a wrong tap would hide a true warning for 60 days): removes that choice only while it is still the latest one (the server returns the choice's id; same pattern as the set-log undo), and the warning and open panel return, focus on the tapped choice. **Data need:** the action takes `choose` and `undo`.
- **Failed save:** the warning returns with the panel open, focus on the tapped choice, and under the panel one WarningLine: "Valget blev ikke gemt, fordi serveren ikke svarede. Advarslen står; prøv igen." It stays until the next tap. A failed undo: "Fortryd blev ikke gemt. Valget står." under the result line.
- Under `DEV_TODAY` / `DEV_FIXTURE` nothing is written; the action answers ok, so the result line can be shot, and a reload shows the warning again.
- All texts (states, result, failures, dates) come from one pure function, so `node --test` checks them.

## 4. States and fixtures
`DEV_FIXTURE=ftp-warning` (credible, FTP 230 W vs eFTP 183 W, not suppressed) and `DEV_FIXTURE=ftp-quiet` (not credible, last tested 17 May). Loading: the header renders with the page (server data), no skeleton. Error: if the FTP state can't be read, nothing shows (the load page's own error state covers a failed read); never a guessed "FTP 0 W". Stale: the FTP state follows `daily_load`'s stale line; nothing extra.

## Acceptance criteria (ftp-confirm)
1. F1 `ftp-warning` at 390 and 1280px: the existing FTP sentence as a WarningLine with an inline chevron-down; no orange anywhere in the header.
2. F2 The line is one button, ≥ 44px tall, named the sentence + "vælg svar", `aria-expanded` false→true on tap/Enter/Space; Escape closes and keeps focus on it; visible 2px focus ring.
3. F3 Open: two 44px secondary buttons "230 W er rigtigt" and "Jeg har rettet FTP", W from the data, no filled button; nothing interactive within 14px of the updated line.
4. F4 A tap hides the warning within 100ms and shows the §3 sentence for that choice with `Fortryd` focused, inside one `role="status"` region; it stays until reload.
5. F5 Fortryd restores the warning with the panel open and focus on the tapped choice; a stale undo (the choice is no longer the latest) changes nothing.
6. F6 Failure injection (cut the request): the warning stays with the panel open, plus exactly the §3 failure line; no choice is recorded.
7. F7 Under `DEV_FIXTURE` / `DEV_TODAY` a tap writes no row (checked in the db), and a reload shows the warning again.
8. F8 `ftp-quiet` shows `FTP 230 W · ikke testet siden 17. maj` as a muted mono line, not focusable; null date → `… ikke testet de sidste 52 uger` (text-function test); suppressed → `FTP 230 W · bekræftet · tjekkes igen <dato>`; `none` and plain show nothing.
9. F9 `prefers-reduced-motion: reduce`: the chevron does not rotate; nothing animates.

## §A Analyse › Cykel: FTP on "eFTP pr. tur" (slice `ftp-analyse`, M)
- **Level line:** horizontal at FTP, from `x(ftp_since)` (clamped to the plot start) to `x(today)`, 1px solid `--text-muted` (5.02:1 on `--card`; distinct from the dashed `--border` gridlines and the ink eFTP dots), drawn under the dots, not hit-testable. In-plot label `FTP 230`, Geist Mono `text-11` `--text-muted`, start-anchored 4px right of the line's start, 4px above it (y labels sit at the right edge, so they never collide).
- **Y-range:** the domain's min/max include FTP before the existing nice-step rule (today eFTP 183–233 already holds 230; an FTP above every point must still be on the plot).
- **Caption:** the first Legend item (`page.tsx` ~l.117), swatch = a 12px 1px `--text-muted` line, label **`FTP: 230 W · sat senest 21. mar. 2026`** ("senest": intervals.icu keeps no FTP history, so the date is the first 2026 ride with this FTP). The sr sentence adds "FTP er sat til 230 W, senest sat 21. mar. 2026."
- FTP unknown: no line, no label, no legend item. No orange; the today line stays the only `--today` mark.

## Acceptance criteria (ftp-analyse)
1. A1 At 390 and 1280px (real data and `answers`) the eFTP card shows a 1px muted solid line at 230 W from `ftp_since` to the today line, labelled `FTP 230` at its left end.
2. A2 The legend's first item reads exactly `FTP: 230 W · sat senest 21. mar. 2026` with a line swatch; the sr sentence includes the FTP sentence.
3. A3 With a fixture FTP above every eFTP point, the y-axis includes it and the line is inside the plot.
4. A4 FTP null: no line, label or legend item; the chart is otherwise unchanged, and readout, dots and today line behave as before.
