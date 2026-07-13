-- Security hardening: Google Calendar OAuth tokens should be service-role only.
-- All app access (status/connect/callback/disconnect/refresh) already goes
-- through the service role, so the client-facing policy only widened the
-- surface (a client could read their own access/refresh tokens). Drop it;
-- RLS stays enabled with no policies => service-role only (like wearable_tokens).
DROP POLICY IF EXISTS "Users manage own google calendar token" ON public.google_calendar_tokens;
