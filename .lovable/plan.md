Two UI-only edits to `src/routes/client.app.checkin.tsx`:

1. **Disclaimer** — Add a small, muted helper line below the page title ("How are you feeling today?") that reads:
   "Pain level is the most important field. Sleep, stress, energy, and mood are optional."

2. **Symptoms input** — At the bottom, replace the "Anything else to add?" `textarea` with a compact `input` field and change the label to:
   "New or changed symptoms?"
   Keep the same styling (dark card background, navy border, white text) so it matches the existing design.

No backend or database changes required.