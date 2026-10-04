# Project rules

- Before every publish, regenerate `src/routeTree.gen.ts` with `bunx @tanstack/router-cli generate` and confirm every file in `src/routes/` is registered — the tree is committed and routes added via direct git commits otherwise 404 in production.
- Schema changes go through `drizzle/migrations/` only — `supabase/migrations/` is never applied to the live database.
