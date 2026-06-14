# Add chart type switcher on the practitioner's client detail page

On `/practitioner/app/client-detail/:clientId`, the "Pain — last 30 days" panel currently renders a single line chart. I'll add a small segmented control above it so the practitioner can switch between three views, and extend it to more than just pain.

## What changes

**Chart type toggle (3 options)**
- **Line** — current look (smooth line, dots).
- **Bar** — daily bars over the same 30-day window.
- **Rings** — the "current setup" feel: a row of compact CircularRings (one per metric) showing the latest day's values, matching the rings already used at the top of the page.

**Metric toggle**
Today only pain is charted. Practitioners also collect sleep, stress, energy. I'll add a second small toggle (Pain / Sleep / Stress / Energy) so the chosen chart type applies to whichever metric they pick. Defaults to Pain so nothing changes on first load.

**Persistence**
Selected chart type + metric are stored in URL search params (`?chart=line|bar|rings&metric=pain|sleep|stress|energy`) using TanStack Router `validateSearch`, so a refresh or shared link keeps the view.

## Scope

- Frontend-only change to `src/routes/practitioner.app.client-detail.$clientId.tsx`.
- Reuses existing recharts (`BarChart`, `Bar`) and the existing `CircularRing` component — no new dependencies.
- No backend, schema, or data-fetching changes. `last30` already contains all four metrics per day.
- Admin and client views are untouched.

## Out of scope

- Date range picker (still last 30 days).
- Exporting / printing charts.
- Adding the toggle to the admin client detail page or the client's own progress page — say the word and I'll mirror it there too.
