// Simple front-end / server feature switches.
//
// LIBRARY_COMING_SOON — when true, the client Exercise Library tab shows a
// "coming soon" placeholder instead of the real library. Flip this to `false`
// to restore full functionality; no other code needs to change.
export const LIBRARY_COMING_SOON = true;

// TRAINING_SCHEDULE_CROSSCHECK — practitioner (and client read-only) overlay of
// check-in symptom scores vs a logged training schedule. Also gated by
// platform_settings.training_schedule_enabled (default true) so Justin can
// hide it from Admin → Settings without a deploy.
export const TRAINING_SCHEDULE_CROSSCHECK = true;

// RESTAURANT_REWARD_PARTNERS — restaurant partner CRUD + discount fields on
// the existing rewards engine. Issuance is still gated by
// platform_settings.rewards_enabled (off until admin activates Rewards).
export const RESTAURANT_REWARD_PARTNERS = true;
