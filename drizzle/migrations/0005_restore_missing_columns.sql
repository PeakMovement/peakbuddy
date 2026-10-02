-- 0005_restore_missing_columns
--
-- Restores every column and index the published code already reads but the
-- live database does not have. Purely additive. Every new column is nullable
-- or defaults to the "off" value, so nothing changes behaviour on apply: the
-- features that are currently dead come back only when switched on.
--
-- NOT APPLIED. Listed for Justin's approval first.

-- ── Alert escalation ────────────────────────────────────────────────────────
-- detection.functions.ts filters on alerts.escalation_fired. The column does
-- not exist, so PostgREST errors, the code ignores the error, the list comes
-- back empty and the job reports success having escalated nothing. Result: an
-- unacknowledged red flag alert is never chased. Default false so that every
-- existing alert becomes eligible for escalation once this lands.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS escalation_fired boolean NOT NULL DEFAULT false;

-- ── Central webhook ─────────────────────────────────────────────────────────
-- webhooks.functions.ts selects these two. Missing columns make the select
-- fail, so enabled resolves to false and fireAlertWebhook silently no-ops.
-- Default stays disabled: this restores the switch, it does not flip it.
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS central_webhook_url text;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS central_webhook_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS detection_thresholds jsonb;

-- ── Practice settings ───────────────────────────────────────────────────────
-- whatsapp_number is read by the webhook router and the settings page.
-- The digest pair is why the weekly practitioner digest sends nothing.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS whatsapp_number text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS last_digest_sent_on date;

-- ── Client tracking ─────────────────────────────────────────────────────────
-- Frontend null-coalesces to 8 today, so this only makes the default explicit.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tracking_duration_weeks integer NOT NULL DEFAULT 8;

-- ── Rewards ─────────────────────────────────────────────────────────────────
ALTER TABLE client_rewards ADD COLUMN IF NOT EXISTS milestone integer;
ALTER TABLE client_rewards ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE client_rewards ADD COLUMN IF NOT EXISTS redeemed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS client_rewards_client_milestone_uniq
  ON client_rewards (client_id, milestone) WHERE milestone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_rewards_auto_reward_id_uniq
  ON client_rewards (client_id, reward_id) WHERE source = 'auto';

-- ── Calendar ────────────────────────────────────────────────────────────────
ALTER TABLE google_calendar_tokens ADD COLUMN IF NOT EXISTS checkin_event_id text;

-- ── Indexes the code's query shapes assume ──────────────────────────────────
-- Sequential scans today. Harmless at current volume, painful later.
CREATE INDEX IF NOT EXISTS check_ins_client_created_idx
  ON check_ins (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_practitioner_unread_idx
  ON alerts (practitioner_id, is_read);
CREATE INDEX IF NOT EXISTS alerts_client_type_unread_idx
  ON alerts (client_id, alert_type, is_read);
CREATE INDEX IF NOT EXISTS session_reports_client_idx
  ON session_reports (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS session_report_analyses_client_idx
  ON session_report_analyses (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS symptom_queries_client_redflag_idx
  ON symptom_queries (client_id, red_flag_detected);
CREATE INDEX IF NOT EXISTS symptom_queries_client_created_idx
  ON symptom_queries (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS practice_members_user_idx ON practice_members (user_id);
CREATE INDEX IF NOT EXISTS practice_members_practice_idx ON practice_members (practice_id);
