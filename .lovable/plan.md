## Goal
Create 3 high-quality Instagram post images that showcase Buddy's key features in a bright, social-friendly aesthetic — plus a simple on-site gallery page where they can be previewed and downloaded.

## Deliverables

### 1. Three Instagram post images (1080 × 1080)
Each post highlights a different feature cluster with bold, minimal typography on a bright, modern health-tech aesthetic (NOT the app's dark navy theme).

| Post | Theme | Visual Concept |
|------|-------|----------------|
| **01** | Daily Check-In | Split-screen or layered UI-mockup feel showing the 5 sliders (pain, sleep, stress, energy, mood) with a bold "30 seconds" headline. Bright gradient background (soft teal → lavender or warm coral → peach). |
| **02** | AI Insights / Yves | Abstract data-pattern visualization — gentle waveforms, rising trend lines, soft glows. Headline: "Catch it before it flares." Calm, intelligent palette (soft blue → cream). |
| **03** | Practitioner Connected | Two converging paths or a shared dashboard metaphor. Warm, supportive palette (soft green → sand). Headline: "Your clinician sees what you see." |

All images will be generated with the `imagegen` tool at 1080×1080, premium quality for crisp text and UI details. Prompts will specify: bright background, minimal bold sans-serif typography, clean health-tech aesthetic, no dark navy, Instagram-square format.

### 2. Gallery page (`/social`)
A lightweight new route at `src/routes/social.tsx` that:
- Displays the 3 generated images in a responsive grid
- Shows suggested caption copy beneath each image
- Offers a "Download" link for each image (using `<a download>`)
- Uses the existing app fonts (Cormorant Garamond for headings, Rajdhani for UI) but on a light background to match the social aesthetic
- Links back to `/marketing`

### 3. Caption copy
Three ready-to-paste Instagram captions written in Buddy's voice (clinical but warm, confident but not jargon-heavy).

## Technical approach
- `imagegen--generate_image` for the 3 assets → `public/social/post-01.jpg`, `post-02.jpg`, `post-03.jpg`
- New route file `src/routes/social.tsx` with static gallery layout
- Add `<Link to="/social">` from the existing `/marketing` page (optional, can be skipped if you prefer it unlinked)

## Out of scope
- No carousel/Reel animations (static images only for this test)
- No scheduling or social-media API integration
- No dark-theme versions (bright social style only)

---
Approve and I'll generate the images and build the gallery page.