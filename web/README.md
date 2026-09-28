# web — training-load dashboard (M2)

One read-only screen over Supabase `daily_load`, `blocks` and `weekly_load`: form (TSB) today, the CTL/ATL/TSB trend with strength blocks, and this ISO week. Python owns every calculation; this app only reads and formats.

- Install: `pnpm install` · dev: `pnpm dev` (http://localhost:3000)
- Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (build needs no secrets; the route renders at request time)
- Env (`web/.env.local` locally, Vercel server env in prod): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Read server-side only; never prefix them with `NEXT_PUBLIC_`.
- Data access lives in `src/lib/db/*` (server-only); view shaping in `src/lib/dashboard-view.ts`; UI contract in `../DESIGN.md`.
