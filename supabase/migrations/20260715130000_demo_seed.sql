-- ============================================================================
-- Demo data: a linked practitioner + patient with a full 3-week history, so the
-- app's capabilities (check-in trends, red-flag alerts, Yves triage, predictive
-- risk, rewards) can be demonstrated end to end.
--
-- Logins (both password: PeakBuddyDemo2026!):
--   practitioner  demo.practitioner@peakbuddy.co.za
--   patient       demo.patient@peakbuddy.co.za
--
-- Idempotent: the whole block no-ops if the demo client already exists, and is
-- wrapped so any failure rolls back cleanly without breaking the deploy.
-- ============================================================================
SET search_path TO public, extensions;

DO $seed$
DECLARE
  v_prac   uuid := 'de300000-0000-4000-8000-000000000001';
  v_pat    uuid := 'de300000-0000-4000-8000-000000000002';
  v_client uuid := 'de300000-0000-4000-8000-000000000010';
  v_reward uuid := 'de300000-0000-4000-8000-000000000020';
  v_pw     text := 'PeakBuddyDemo2026!';
BEGIN
  IF EXISTS (SELECT 1 FROM public.clients WHERE id = v_client) THEN
    RAISE NOTICE 'Demo already seeded; skipping.';
    RETURN;
  END IF;

  -- 1. Auth users -----------------------------------------------------------
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_prac, 'authenticated', 'authenticated',
     'demo.practitioner@peakbuddy.co.za', crypt(v_pw, gen_salt('bf')),
     now(), now() - interval '30 days', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Dr. Demo Practitioner"}'::jsonb, '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_pat, 'authenticated', 'authenticated',
     'demo.patient@peakbuddy.co.za', crypt(v_pw, gen_salt('bf')),
     now(), now() - interval '25 days', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Alex Mokoena"}'::jsonb, '', '', '', '')
  ON CONFLICT (id) DO NOTHING;

  -- Email identities (modern GoTrue requires provider_id).
  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES
    (gen_random_uuid(), v_prac::text, v_prac,
     jsonb_build_object('sub', v_prac::text, 'email', 'demo.practitioner@peakbuddy.co.za', 'email_verified', true),
     'email', now(), now(), now()),
    (gen_random_uuid(), v_pat::text, v_pat,
     jsonb_build_object('sub', v_pat::text, 'email', 'demo.patient@peakbuddy.co.za', 'email_verified', true),
     'email', now(), now(), now())
  ON CONFLICT DO NOTHING;

  -- 2. Practitioner profile -------------------------------------------------
  -- handle_new_user() already inserted a role='client' row; replace it with an
  -- INSERT (the role-escalation guard only fires on UPDATE, not INSERT).
  DELETE FROM public.profiles WHERE id = v_prac;
  INSERT INTO public.profiles (id, role, full_name, profession, morning_analysis_enabled)
  VALUES (v_prac, 'practitioner', 'Dr. Demo Practitioner', 'Physiotherapist', true);

  -- 3. Practice -------------------------------------------------------------
  INSERT INTO public.practices (
    practitioner_id, practice_name, profession, is_approved, onboarding_complete,
    ai_features_enabled, yves_enabled, gamification_enabled,
    popia_agreed, popia_agreed_at, data_processing_agreed, data_processing_agreed_at
  ) VALUES (
    v_prac, 'Peak Movement Demo Clinic', 'Physiotherapist', true, true,
    true, true, true, true, now(), true, now()
  ) ON CONFLICT (practitioner_id) DO NOTHING;

  -- 4. Patient (client) -----------------------------------------------------
  INSERT INTO public.clients (
    id, practitioner_id, auth_user_id, full_name, email, phone, primary_complaint,
    notes, check_in_frequency, login_code, popia_accepted, yves_enabled,
    yves_ai_consent, yves_ai_consent_at, passive_monitoring_enabled,
    predictive_nudges_enabled, timezone
  ) VALUES (
    v_client, v_prac, v_pat, 'Alex Mokoena', 'demo.patient@peakbuddy.co.za', '+27 82 000 0000',
    'Chronic lower-back pain radiating to the left leg (suspected L5/S1)',
    'Demo patient: 3-week history showing early recovery, a mid-cycle flare with neural signs, then easing.',
    'daily', '480021', true, true, true, now(), true, true, 'Africa/Johannesburg'
  );

  -- 5. Check-ins (18, backdated) -------------------------------------------
  INSERT INTO public.check_ins (
    client_id, practitioner_id, pain_level, sleep_quality, stress_level,
    energy_level, mood, notes, flagged, created_at
  )
  SELECT v_client, v_prac, d.pain, d.slp, d.str, d.eng, d.mood, d.notes, d.flg,
         now() - make_interval(days => d.days_ago) - interval '4 hours'
  FROM (VALUES
    (20, 6, 5, 6, 4, '2', 'Back stiff and sore, hard to bend this morning.', false),
    (19, 6, 5, 6, 4, '3', NULL, false),
    (18, 5, 6, 5, 5, '3', 'A little better after the stretches.', false),
    (17, 5, 6, 5, 5, '3', NULL, false),
    (16, 4, 7, 4, 6, '4', 'Good day, walked 20 minutes pain-free.', false),
    (14, 4, 7, 4, 6, '4', NULL, false),
    (13, 3, 7, 3, 7, '4', 'Feeling the best I have in weeks.', false),
    (12, 4, 6, 4, 6, '4', NULL, false),
    (10, 4, 6, 5, 5, '3', NULL, false),
    (9,  5, 5, 6, 5, '3', 'Tweaked it lifting a box.', false),
    (7,  6, 5, 6, 4, '2', 'Pain creeping back, into the buttock now.', false),
    (6,  6, 4, 7, 4, '2', NULL, false),
    (5,  7, 4, 7, 3, '2', 'Aching down the back of my thigh.', true),
    (4,  8, 3, 8, 2, '1', 'Burning pain shooting down my left leg, foot feels numb.', true),
    (3,  8, 3, 8, 2, '1', 'Still very sore, numbness comes and goes.', true),
    (2,  7, 4, 7, 3, '2', 'Slightly better after resting.', true),
    (1,  6, 5, 6, 4, '2', 'Easing a little, still cautious.', false),
    (0,  6, 5, 6, 4, '3', 'Managing with the exercises.', false)
  ) AS d(days_ago, pain, slp, str, eng, mood, notes, flg);

  -- 6. Alerts ---------------------------------------------------------------
  INSERT INTO public.alerts (
    practitioner_id, client_id, alert_type, urgency, message, red_flag_category, is_read, created_at
  ) VALUES
    (v_prac, v_client, 'red_flag', 'urgent',
     'Burning pain radiating down the left leg with new foot numbness reported in check-in.',
     'neuro', false, now() - interval '4 days'),
    (v_prac, v_client, 'pattern', 'soon',
     'Pain has risen from 4/10 to 8/10 over recent check-ins.',
     NULL, false, now() - interval '3 days');

  -- 7. Yves symptom queries -------------------------------------------------
  INSERT INTO public.symptom_queries (
    client_id, practitioner_id, query_text, urgency, red_flag_detected,
    red_flag_category, severity, source, ai_rationale, suggested_next_step, created_at
  ) VALUES
    (v_client, v_prac, 'A bit of stiffness in my lower back after gardening, feels mild.',
     'routine', false, NULL, 2, 'ai_primary',
     'Mild mechanical stiffness after activity with no red-flag features; self-care is appropriate.',
     'Keep moving gently and continue your exercises; mention it next session if it persists.',
     now() - interval '6 days'),
    (v_client, v_prac, 'Sharp pain shooting down my left leg and my foot has gone numb.',
     'urgent', true, 'neuro', 7, 'ai_primary',
     'Radiating leg pain with new numbness suggests possible nerve-root involvement and warrants prompt review.',
     'Contact your practitioner today; avoid heavy loading until you are assessed.',
     now() - interval '4 days');

  -- 8. Baseline + predictive risk trend ------------------------------------
  INSERT INTO public.client_baselines (
    client_id, computed_at, pain_mean, pain_std, sleep_mean, sleep_std,
    stress_mean, stress_std, energy_mean, energy_std, mood_mean, mood_std, sample_size
  ) VALUES (
    v_client, now() - interval '3 days', 5.0, 1.6, 5.4, 1.2, 5.6, 1.4, 4.7, 1.3, 2.8, 0.9, 14
  );

  INSERT INTO public.risk_scores (client_id, score_date, risk_score, trend, summary, delta_vs_baseline)
  SELECT v_client, (current_date - r.d), r.score, r.trend, r.summary, '{}'::jsonb
  FROM (VALUES
    (10, 30, 'stable',    NULL),
    (9,  32, 'stable',    NULL),
    (8,  34, 'stable',    NULL),
    (7,  40, 'stable',    NULL),
    (6,  46, 'worsening', 'Pain and stress edging above baseline.'),
    (5,  55, 'worsening', 'Pain and stress rising with declining sleep.'),
    (4,  68, 'worsening', 'Sharp rise above baseline with new neural symptoms reported.'),
    (3,  72, 'worsening', 'Risk elevated: pain 8/10, poor sleep, high stress.'),
    (2,  66, 'worsening', 'Still elevated but easing slightly.'),
    (1,  58, 'improving', 'Trending down after rest and load management.'),
    (0,  52, 'improving', 'Continuing to settle toward baseline.')
  ) AS r(d, score, trend, summary);

  -- 9. Reward + issued voucher (visible once rewards are activated in Admin) -
  INSERT INTO public.rewards (id, name, description, voucher_code, maps_url, active)
  VALUES (v_reward, '15% off at FitFuel Nutrition',
          'Fifteen percent off any in-store purchase.', 'BUDDYFIT15',
          'https://maps.google.com/?q=FitFuel+Nutrition', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.client_rewards (client_id, reward_id, practitioner_id, status, earned_at)
  VALUES (v_client, v_reward, v_prac, 'earned', now() - interval '1 day');

  RAISE NOTICE 'Demo seed complete.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Demo seed failed and was rolled back: %', SQLERRM;
END
$seed$;
