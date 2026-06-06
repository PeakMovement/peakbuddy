Fix the Yves access pill display in the practitioner client detail page so it reflects the effective state (practice-level Yves AND client-level toggle), not just the client-level toggle.

Scope: single file edit — `src/routes/practitioner.app.client-detail.$clientId.tsx`.

1. Read the current pill rendering logic around lines 323–356.
2. Compute `effectiveOn = practiceYves && client.yves_enabled !== false`.
3. Drive the pill’s background, text color, label, and border off `effectiveOn` instead of `client.yves_enabled !== false`.
4. Verify the build passes and the pill now shows "Off" (outlined) when practice-level access is disabled.