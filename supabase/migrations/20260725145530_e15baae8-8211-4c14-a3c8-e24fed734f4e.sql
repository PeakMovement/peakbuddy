-- Delete Peter Parker (client e908934f-a8a7-4e41-9836-0f523475ec17,
-- auth user d3d3fd7e-e2a8-4869-bc41-bc2d60a72e6c) and every trace.
DO $$
DECLARE
  v_client uuid := 'e908934f-a8a7-4e41-9836-0f523475ec17';
  v_user   uuid := 'd3d3fd7e-e2a8-4869-bc41-bc2d60a72e6c';
BEGIN
  -- Client-scoped data
  DELETE FROM public.alert_action_tokens WHERE alert_id IN (SELECT id FROM public.alerts WHERE client_id = v_client);
  DELETE FROM public.alerts               WHERE client_id = v_client;
  DELETE FROM public.check_ins            WHERE client_id = v_client;
  DELETE FROM public.checkin_reminders    WHERE client_id = v_client;
  DELETE FROM public.client_baselines     WHERE client_id = v_client;
  DELETE FROM public.client_insight_logs  WHERE client_id = v_client;
  DELETE FROM public.client_patterns      WHERE client_id = v_client;
  DELETE FROM public.client_rewards       WHERE client_id = v_client;
  DELETE FROM public.practitioner_drafts  WHERE client_id = v_client;
  DELETE FROM public.predictive_nudges    WHERE client_id = v_client;
  DELETE FROM public.risk_scores          WHERE client_id = v_client;
  DELETE FROM public.symptom_queries      WHERE client_id = v_client;
  DELETE FROM public.yves_triage_logs     WHERE client_id = v_client;
  DELETE FROM public.wearable_sessions    WHERE client_id = v_client;
  DELETE FROM public.wearable_tokens      WHERE client_id = v_client;
  DELETE FROM public.wearable_oauth_state WHERE client_id = v_client;
  DELETE FROM public.garmin_oauth_state   WHERE client_id = v_client;

  -- Auth-user-scoped data
  DELETE FROM public.push_tokens                 WHERE user_id = v_user;
  DELETE FROM public.push_send_log               WHERE recipient_user_id = v_user OR sent_by = v_user;
  DELETE FROM public.google_calendar_tokens      WHERE user_id = v_user;
  DELETE FROM public.google_calendar_oauth_state WHERE user_id = v_user;

  -- Client row + profile
  DELETE FROM public.clients  WHERE id = v_client;
  DELETE FROM public.profiles WHERE id = v_user;

  -- Auth account
  DELETE FROM auth.users WHERE id = v_user;
END $$;