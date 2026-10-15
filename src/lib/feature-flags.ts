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

// Capability review. Risky sends stay off until an env var is set (see
// capabilities.ts). These constants are the ones that must not go live by
// flipping a deploy setting in a hurry.

/** Do not send session notes to a model. The case brief is assembled in code. */
export const CASE_BRIEF_MODEL = false;

/** Photos and short videos are stored for the treating physio. No vision model. */
export const EXERCISE_MEDIA = true;
export const EXERCISE_MEDIA_VISION = false;

/** Spoken replies wait until the text check-in is solid. */
export const VOICE_NOTE_REPLIES = false;

/** A WhatsApp Flow needs a Meta review. The button and list check-in stays. */
export const WHATSAPP_FLOW_CHECKIN = false;

/** Red-flag word lists for Afrikaans, isiXhosa, and isiZulu are a review scaffold. */
export const RED_FLAG_LEXICON_LIVE = false;
