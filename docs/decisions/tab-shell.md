# Decision: the swipeable tab shell (slice `motion-shell`, architect, 2026-10-15)
Checked against `web/node_modules/next/dist/docs` (16.3.6): parallel-routes, default, loading, route-groups,
linking-and-navigating ("Native History API").

## 1. Mounting: parallel routes, one slot per tab, in a route group (option a)
`app/(tabs)/layout.tsx` gets the slots `train`, `load`, `analyse` and hands them to the client `TabShell`. Each
slot has a **page at its own URL and a `default.tsx` rendering the same tab component**. default.md: on a hard
load, a slot that doesn't match the URL renders its default, so a hard load of `/load` renders `@load/load/page`
plus Træning and Analyse from their defaults: all three with real data in the first response, each streaming on
its own (§7). `children` has no page: `(tabs)/default.tsx` returns null (docs: children is an implicit slot).
Swipes and tab taps change the URL with `window.history.pushState` (documented: syncs the router and
`usePathname`; no request, no remount). Back/forward restore the stored router tree; `TabShell` takes the index
from `usePathname()` and animates to it. The URL owns the active tab; a drag only moves p in between. Drag,
thresholds and the card-stack transform follow the mockup (lines 647-745).
- Rejected (b) one catch-all page with all three trees: a week switch (`?week=`) or Styrke re-renders and
  remounts all three tabs, and unknown paths must 404 by hand.
- Rejected (c) the layout importing the tabs directly: layouts get no `searchParams`, so `/load?week=` would need
  a new client fetch path. Slots get `searchParams` and their own loading/error.
- Soft navigation inside a slot (week switch, Cykel/Styrke) re-renders only that slot; the others keep state.
- Known cost: a slot shown from its default switches to its page segment (remount + refetch, once) when a Link,
  `router.refresh()` or a cache-missing back/forward matches its URL. So tab-to-tab moves use the shell's `goTo`
  (pushState), never `<Link>` (ZoneBar's Link to `/` becomes `goTo(0)`).
- Inactive pages: `visibility:hidden` + `inert`, never `display:none` (charts measure their width). Each page
  scrolls in its own container (mockup `.page`), so each tab keeps its scroll position.
## 2. `/`
`redirects()` in `next.config.ts`: `/` → `/train`, `permanent: false` (307); the bookmark keeps working for one
redirect. Rejected 308 (browsers cache it for good) and `/` as a second Træning URL (two URLs per tab muddle the
index and history). Fokus's Links to `/` become `/train`.
## 3. `/analyse/styrke`
Stays a real URL in the Analyse slot (`@analyse/analyse/styrke/page.tsx`); Cykel/Styrke keep their Links (soft
navigation re-renders only that slot); `@analyse/default.tsx` shows Cykel. `analyse/layout.tsx` goes: the h1 and
section tabs move into the shared tab component, since a default doesn't pass through that layout.
## 4. `/fokus` stays `app/fokus/`, outside `(tabs)`: no shell, no tab bar (TabBar's hide-on-/fokus rule goes).
## 5. Refresh and server actions
`router.refresh()` (↻) re-renders the tree for the current URL: all three tabs refetch. That is what ↻ means; 3x
queries are fine for one user. Verify: after ↻ on Belastning, Træning shows the new computed_at. The server
actions don't revalidate (optimistic UI); keep it so, or every set tap re-renders all three tabs.

## 6. Desktop (lg)
Same shell; top-bar clicks run the same card-stack animation (440 ms, ease-out quart; instant under
prefers-reduced-motion). **No drag on lg or for `pointerType === "mouse"`** (it fights text selection and chart
scrubbing). The 1200px frame sits inside each page.

## 7. Loading and error
`loading.tsx` + `error.tsx` per slot root (`@train/`, `@load/`, `@analyse/`): the documented per-slot streaming.
Today's skeletons move there; the tabs keep their inner Suspense parts. Verify that a slot's loading also wraps
its default (hard load `/train` with a slow Load); if not, the tab component wraps itself in `<Suspense>`.

## 8. Files (under `web/src/`) and ARCHITECTURE.md
- New: `app/(tabs)/{layout,default}.tsx`; `@train/{train/page,default,loading,error}.tsx`;
  `@load/{load/page,default,loading,error}.tsx`; `@analyse/{analyse/page,analyse/styrke/page,default,loading,error}.tsx`;
  `components/TabShell.tsx` (client: p, drag, pushState, TabBar); `components/tabs/{TrainTab,LoadTab,AnalyseTab}.tsx`
  (server, today's page bodies moved as-is; LoadTab takes `week`, AnalyseTab `section`); `lib/tab-shell.ts` (pure:
  path ↔ index, p → transform, release rule; `node --test`).
- Change: `app/layout.tsx` (html/body/fonts only), `TabBar.tsx` (index + goTo from the shell, hrefs kept),
  `next.config.ts`, Fokus and ZoneBar links. Delete: `app/page.tsx`, `app/loading.tsx`, `app/load/`, `app/analyse/`.
- ARCHITECTURE.md: the Next.js lines become `/train`, `/load`, `/analyse`, `/analyse/styrke` in one `(tabs)` shell
  (`/` → 307 `/train`); the `web/src/app/` row lists the slots; add TabShell, `tabs/*`, `lib/tab-shell.ts`.
