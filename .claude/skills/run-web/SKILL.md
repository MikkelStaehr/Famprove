---
name: run-web
description: Run the Next.js app in web/ on port 3100 with real data and take exact-width screenshots (390 px, 1280 px, dark mode, 200 % text), optionally as another day via DEV_TODAY. Use for any "run it", "show me", screenshot or visual check of the web app. The only screenshot method in this repo.
---

# run-web

Start the web app on **port 3100** (agents' port; 3000 is the user's — never touch it), run a
command against it, and always stop it again. Screenshots come from a Chromium browser through the
DevTools protocol (Edge on Windows, Chrome on macOS), in real time and at an exact viewport width.

## Why not a plain headless screenshot
Two Windows traps cost a full debugging session once:
- `--virtual-time-budget` never fires the animation frame React waits for before hydrating, so
  client components (the chart, the tick rows) stay as skeletons.
- `--window-size=390,…` is clamped to about 516 px on Windows; the page is laid out wider and
  then cropped, which looks like overflow. `shoot.mjs` sets the width by device emulation instead.

## Use
**macOS / Linux:** `serve.sh` is the twin of `serve.ps1` (same rules; the fixture list is read from
`web/src/lib/db/dev-fixture.ts`, so it never goes stale). From the repo root:

```bash
.claude/skills/run-web/serve.sh -- "node .claude/skills/run-web/shoot.mjs --out \$TMPDIR/today-390.png"
.claude/skills/run-web/serve.sh --dev-fixture midsession -- "node .claude/skills/run-web/shoot.mjs --out \$TMPDIR/traening-390.png --dark"
.claude/skills/run-web/serve.sh --dev-today 2026-09-29 -- "node .claude/skills/run-web/shoot.mjs --out \$TMPDIR/rest-390.png"
```

**Windows:** from the repo root (PowerShell or `powershell -NoProfile -File …` from Git Bash). Screenshots
contain personal training data: write them to the session scratchpad or `%TEMP%`, never into the repo.

```powershell
# Today as it is now (dev mode, no build needed)
.claude/skills/run-web/serve.ps1 -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\today-390.png"

# Another day: DEV_TODAY only works in dev mode (next dev); it is ignored in production
.claude/skills/run-web/serve.ps1 -DevToday 2026-09-29 -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\rest-390.png"

# A designed state without touching the database (dev mode only; the full list with what each shows is
# FIXTURES in web/src/lib/db/dev-fixture.ts): empty | stale | error | band | ef-few | lsrpe | answers | feel,
# and for Træning/Fokus midsession | warmup | pause | exercise-end | pause-rated | finished (each Fokus view
# without a tap: nothing is written under a fixture);
# band = real rows plus an illustrative prognose band, load.md §10e
.claude/skills/run-web/serve.ps1 -DevFixture error -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\error-390.png --path /load"

# Several shots against one server
.claude/skills/run-web/serve.ps1 -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\load-390.png --path /load; node .claude/skills/run-web/shoot.mjs --out $env:TEMP\load-1280.png --path /load --width 1280"
```

`shoot.mjs` options: `--out <png>` (required) · `--path /load?week=2026-W33` (default `/`) ·
`--width 390` · `--open` (open every `<details>`) · `--dark` · `--reduce-motion` (emulates
`prefers-reduced-motion: reduce`) · `--zoom200` (root font 200 %) ·
`--base http://localhost:3100` · `--ready "<css selector>"` (a page outside the app, e.g. the local design
reference: `--base file://$PWD/design/reference/ --path belastning-mockup.html --width 1400`; a bundle that
renders inside a frame never matches, so the shot waits 30 s, exits 1 and still writes the PNG) · `--timeout 90` (seconds for the whole shot: a hung browser is killed
and the shot exits 1, never waited on; one stalled a run for hours on 2026-10-13). It prints one JSON line (height, horizontal overflow, console
errors) and exits 1 on overflow, console errors or a page that never got ready. Then **Read the
PNG** — a screenshot you haven't looked at proves nothing.

`serve.ps1 -Mode prod` serves the last `pnpm build` with `next start`. Building rewrites `web/.next`,
which a `next start` on port 3000 may be serving — so prefer dev mode, or ask before building.

## Swipes and frame timing (the tab shell)
`swipe.mjs` drives the tab shell with real touch events (pointerType "touch") and measures frames: long
animation frames over 50 ms (PerformanceObserver) and the largest gap between animation frames while the
gestures run, optionally under CPU throttling. Same browser and port rules as `shoot.mjs`. It also works on
a page outside the tab shell (`/fokus`): ready once `<main>` has no skeleton, so `click:` / `wait:` steps,
`--init`, `--report` and `--out` can shoot a state that needs a tap first (e.g. a view after a client-only
step), without writing anything (taps are refused under a dev switch).

```bash
# Pixel-class phone, 4x CPU throttle: swipe to Analyse, back, tap Træning, browser back
.claude/skills/run-web/serve.sh -- "node .claude/skills/run-web/swipe.mjs --path /load --cpu 4 --steps left,right,tap:/train,back --mid \$TMPDIR/mid.png"
```
Steps: `left` / `right` (a swipe of `--share` x width over `--ms`), `flick-*` (15 % in 80 ms), `short-*`
(15 % over 600 ms), `edge-*` (from 10 px off the edge: must not move), `tap:<path>`, `back`,
`scroll-down` / `scroll-up` (a touch drag mostly in y, 300 px with 20 px sideways: the page scrolls, no tab move),
`diag-*` (|dx| = |dy| = 60 px, under the 1.3 lock ratio: must not move), `tabkeys` (Tab pressed 60 times; counts
focus landing in an inactive page), `key:<path>` (focus that tab's visible link, then Enter), `forward`. Each step also reports every page's scrollTop, whether the inactive pages are
`inert` + `aria-hidden` + `visibility: hidden` (`notInert` lists any that aren't), where focus is, the indicator's transform, the visible tab bars
(top, indicator shown) and `settle` (card-stack frames changed after the gesture ended: ~440 ms span = animated,
0-1 changes = a snap). The output starts with `initial` (the hard-loaded state) and `mid` (the state at `--mid`).
`scroll:<css>` (scroll the match's own `main`, active page or not, so it sits 80 px under the top), `click:<css>`
(the first visible, non-inert match), `drag:<css>` (a horizontal touch drag across the match, 15 % -> 85 % in 30 moves of
20 ms; on /load the plot is `[aria-label^=Fitness][data-noswipe]`, since `[aria-label^=Fitness]` alone hits the h2 first),
`wait:<ms>`; no comma inside a selector. Probes: `--init <file.js>` runs in every document before the app (spies such as
`navigator.vibrate`, per-frame samplers), `--report <file.js>` is an expression evaluated after the steps (in the JSON as
`report`, or written to `--report-out <file.json>`). Don't run `pnpm lint/typecheck/test` alongside: load average went to 50.
Frame numbers are only meaningful on an idle machine: check `uptime` and report the load average with them. `--mid` shoots
the card stack half-way through the first swipe. Prints the URL and active page after each step; exits 1 on
a long frame over 50 ms, a console error or a horizontal overflow. The user's phone is Android Chrome (it has
both the long-animation-frame API and vibrate): this Chrome with touch emulation and `--cpu 4` stands in for it, the phone stays the final check.
Each step's `loaf` says where a long frame's time went (LoAF attribution: `script` ms, `render` ms and its
`styleLayout` part, scripts of 5 ms or more as [type, invoker, function@file, ms, forced layout ms]);
`--trace <file.json>` also records a DevTools trace of the steps (open it in DevTools' Performance panel) and
puts its main-thread rendering work of 8 ms or more in `trace` ([event, ms, elementCount for UpdateLayoutTree]).

## Rules
- Port 3100 only. The script refuses to start if 3100 is taken and always stops its server.
- `web/.env.local` (real Supabase keys) is read by Next itself; never open or print it.
- The browser: Edge at its default Windows path, Chrome at `/Applications/Google Chrome.app` on macOS,
  `google-chrome` on Linux; set `BROWSER_PATH` (or the older `EDGE_PATH`) if not.
- Never a scratchpad copy of these scripts: if the skill can't do something, fix the skill.
