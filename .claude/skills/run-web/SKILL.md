---
name: run-web
description: Run the Next.js app in web/ on port 3100 with real data and take exact-width screenshots (390 px, 1280 px, dark mode, 200 % text), optionally as another day via DEV_TODAY. Use for any "run it", "show me", screenshot or visual check of the web app. The only screenshot method in this repo.
---

# run-web

Start the web app on **port 3100** (agents' port; 3000 is the user's — never touch it), run a
command against it, and always stop it again. Screenshots come from Edge through the DevTools
protocol, in real time and at an exact viewport width.

## Why not a plain headless screenshot
Two Windows traps cost a full debugging session once:
- `--virtual-time-budget` never fires the animation frame React waits for before hydrating, so
  client components (the chart, the tick rows) stay as skeletons.
- `--window-size=390,…` is clamped to about 516 px on Windows; the page is laid out wider and
  then cropped, which looks like overflow. `shoot.mjs` sets the width by device emulation instead.

## Use
From the repo root (PowerShell or `powershell -NoProfile -File …` from Git Bash). Screenshots
contain personal training data: write them to the session scratchpad or `%TEMP%`, never into the repo.

```powershell
# Today as it is now (dev mode, no build needed)
.claude/skills/run-web/serve.ps1 -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\today-390.png"

# Another day: DEV_TODAY only works in dev mode (next dev); it is ignored in production
.claude/skills/run-web/serve.ps1 -DevToday 2026-09-29 -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\rest-390.png"

# Several shots against one server
.claude/skills/run-web/serve.ps1 -Cmd "node .claude/skills/run-web/shoot.mjs --out $env:TEMP\load-390.png --path /load; node .claude/skills/run-web/shoot.mjs --out $env:TEMP\load-1280.png --path /load --width 1280"
```

`shoot.mjs` options: `--out <png>` (required) · `--path /load?week=2026-W33` (default `/`) ·
`--width 390` · `--open` (open every `<details>`) · `--dark` · `--zoom200` (root font 200 %) ·
`--base http://localhost:3100`. It prints one JSON line (height, horizontal overflow, console
errors) and exits 1 on overflow, console errors or a page that never got ready. Then **Read the
PNG** — a screenshot you haven't looked at proves nothing.

`serve.ps1 -Mode prod` serves the last `pnpm build` with `next start`. Building rewrites `web/.next`,
which a `next start` on port 3000 may be serving — so prefer dev mode, or ask before building.

## Rules
- Port 3100 only. The script refuses to start if 3100 is taken and always stops its server.
- `web/.env.local` (real Supabase keys) is read by Next itself; never open or print it.
- Edge lives at the default Windows path; set `EDGE_PATH` if not.
