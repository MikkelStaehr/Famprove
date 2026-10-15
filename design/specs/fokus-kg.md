# Spec-lite: fokus-kg — today's kg is the figure (2026-10-15)

**Question:** what do I lift on this set today? **Primary action:** unchanged (Udført). Supersedes traening.md D3 and the FORSLAG label everywhere.

## 1. Kg block per `today_basis` (Fokus set view; figure 44px Geist Mono, unit text-24)
| basis | caption (mono 12, muted, upper) | figure | style |
|---|---|---|---|
| `sheet` | `I DAG` | `142,5` kg | upright (as written, D6) |
| `derived` | `I DAG · BEREGNET` | `127,5` kg | italic (computed) |
| `e1rm` | `I DAG · SKØN` | `~142,5` kg (+ ` (begrænset)` muted when capped) | italic |
| `last` | `SAMME SOM SIDST` | last week's kg | upright (logged) |
| none | no kg block, no empty caption | — | — |

- Bodyweight: `today_kg` 0 on a bodyweight exercise reads `kropsvægt` (no unit); > 0 reads `kropsvægt + 10` kg, words in text-24 (existing `formatSetLoad`).
- Per dumbbell (`kg_per_dumbbell`): unit becomes `kg pr. håndvægt` (text-16 muted under the figure), the figure is one dumbbell, as in the sheet.
- Danish decimal comma; never `0 kg` for missing.

## 2. "Sidste uge" line
`Sidste uge 140 kg` under the block, text-14 muted, figure mono text-20. Shown only when last week's kg exists and basis ≠ `last` (it would repeat). Shown even when equal to today (row 78). Week 1 and nothing logged: no line, no text (drops "Uge 1 i blokken…" and "Intet logget sidste uge"). New variant: the line becomes variants.md §3's text; the kg block shows as normal.

## 3. Where else
- **NextSetCard (pause) and Træning expanded rows:** the FORSLAG item becomes the same caption + figure (mono 16, same italic/`~` rules); SIDSTE UGE stays the second item under §2's rules.
- **Footnote** (StrengthCard): only when a shown set has basis `derived` or `e1rm`: `Beregnet og ~ kg er appens skøn ud fra dagens sæt og din e1RM, ikke trænerens tal. Hvert sæt gemmes, når du sætter flueben; kg logger du i arket.` Otherwise only the second sentence.
- **The word "Forslag" goes** from Fokus, pause and Træning. The `e1rm` "~" + `SKØN` carries it.

## 4. Screen-reader text (one sentence per set, visual copy aria-hidden)
`sheet` "I dag 142,5 kg." · `derived` "I dag 127,5 kg, beregnet." · `e1rm` "I dag cirka 142,5 kg, et skøn." · `last` "Samme som sidst: 140 kg." Then "Sidste uge 140 kg." when §2 shows it. `~` is never read as "tilde".

## 5. States
Loading/error/stale: unchanged (fokus-pause.md). Stale data: kg is as of the last sync; the existing stale line covers it.

## Acceptance criteria (real rows, no DEV_FIXTURE, 390px)
- **K1** Row 77: Fokus shows `I DAG`, `142,5 kg` upright, then `Sidste uge 140 kg`.
- **K2** Row 78: `I DAG 145 kg` and `Sidste uge 145 kg`, both shown.
- **K3** Row 79: `I DAG 127,5 kg` and `Sidste uge 130 kg`.
- **K4** Rows 77–79 read the same values on the pause NextSetCard and in Træning's expanded rows.
- **K5** No "Forslag"/"FORSLAG" string on `/` or `/fokus` (grep the rendered HTML).
- **K6** An `e1rm` set shows `~` + `I DAG · SKØN`, italic; its sr text says "cirka".
- **K7** A week-1 set shows no Sidste uge line and no "Uge 1" text; a set with no `today_kg` shows no kg block.
- **K8** The footnote's first sentence appears only when a shown set is `derived` or `e1rm`.
