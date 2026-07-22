# Buddy Overview Document (.docx)

Deliverable: a single downloadable Word document at `/mnt/documents/buddy-overview.docx` covering Buddy end-to-end for internal, clinical, and investor audiences — with a deep dive on the admin portal.

## Structure

1. **Executive summary** — what Buddy is (practitioner-first health monitoring platform), who it serves, differentiators.
2. **Product pillars** — passive monitoring, daily check-ins, Yves AI triage, alerts, programs, rewards, calendar, wearables.
3. **User roles & apps**
   - Client PWA (check-in, timeline, progress, Yves, profile, rewards, wearable connect, push, calendar)
   - Practitioner portal (dashboard, clients, alerts, insights, add-client, program queue, settings, drafts)
   - Admin / super-admin portal (full deep dive — see §5)
4. **Clinical workflows** — check-in → risk analysis → alert routing (in-app + email + practitioner digest) → practitioner action → outcome logging → nightly pattern detection → weekly digest.
5. **Admin portal deep dive** (every route under `/admin/app/*`)
   - Dashboard: counts (practitioners, clients, check-ins, open alerts today)
   - Practitioners: list, approve, invite, delete
   - Clients: cross-practice list, detail drill-down
   - **Data Hub**: client picker; collapsible sections — Overview, Symptoms, Vitals, Yves history, Alerts, Activity history, Detected patterns, Baselines, Rewards, Generate Insight (Gemini 3.1 Pro clinical summary). Show/hide chip bar with localStorage persistence. Wearable-aware empty states.
   - Programs: admin program authoring / queue
   - Alerts: system-wide alert queue with outcome logging
   - Grading: review AI outputs (Yves triage, risk analyses)
   - Settings: super-admin config
6. **AI stack** — Lovable AI Gateway; Gemini 3 Flash for high-volume, Gemini 3.1 Pro for clinical insight, two-pass Yves (Haiku extraction → Sonnet assessment), nightly risk + pattern jobs.
7. **Wearables** — Garmin (with full attribution + device model), Oura, Polar; per-provider capability matrix; graceful "not supported by this wearable" UI.
8. **Notifications** — OneSignal push (PWA), transactional email from `noreply@buddy-health.co.za`, practitioner alert emails, weekly digest, calendar reminders.
9. **Auth, security, privacy** — Supabase auth, RLS on every table, `has_role` + `is_super_admin` gates, 24h idle sign-out, service-role only on server, privacy policy incl. Garmin section, no data sale.
10. **Tech stack (internal)** — TanStack Start on Cloudflare Workers, Supabase (Lovable Cloud), TanStack Query, server functions with `requireSupabaseAuth`, public API routes under `/api/public/*` for webhooks/cron.
11. **Integrations** — Google Calendar OAuth, Garmin/Oura/Polar OAuth + webhooks, OneSignal, Lovable AI Gateway.
12. **Roadmap hooks** — Garmin stress / Body Battery / VO2 max persistence, WhatsApp webhook alerts, richer program authoring.

## Method

- Read source of truth for admin routes to make feature list exact:
  `src/routes/admin.app.tsx`, `admin.app.dashboard.tsx`, `admin.app.practitioners.tsx`, `admin.app.clients.tsx`, `admin.app.data-hub.tsx`, `admin.app.programs.tsx`, `admin.app.alerts.tsx`, `admin.app.grading.tsx`, `admin.app.settings.tsx`, and the two detail routes.
- Read `src/lib/admin-data-hub.functions.ts`, `data-hub-insight.functions.ts`, `admin-invite-practitioner.functions.ts`, `admin-delete.functions.ts`, `admin-programs.functions.ts` to describe backend behavior accurately.
- Skim client + practitioner route files to summarise those apps without over-claiming.

## Generation

- Use the docx skill (`docx-js`) — US Letter, Arial, black headings, brand navy accent `#0B1B3B` on H1 divider borders and cover, blue accent `#3E7BFA` for links, single logo mark on cover using the existing `B` icon.
- Sections: cover page, TOC, then §1–§12. Tables for role capability matrix and wearable capability matrix. Bulleted feature lists (via `LevelFormat.BULLET`, no unicode bullets).
- Validate the generated file, convert to PDF+images, inspect every page for overflow/clipping, fix and regenerate before delivery.
- Output: `/mnt/documents/buddy-overview.docx`, surfaced via `<presentation-artifact>`.

## Out of scope

- No code changes to the app.
- No new AI calls or DB writes.
- Not a legal/clinical compliance document — descriptive overview only.
