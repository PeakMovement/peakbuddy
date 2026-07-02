UPDATE auth.users
SET email = 'justin@peakmovement.com',
    encrypted_password = extensions.crypt('Retireby30*', extensions.gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now(),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
WHERE id = '623754db-590e-4a74-907f-b573b31b0780';

UPDATE auth.identities
SET identity_data = jsonb_set(
      jsonb_set(identity_data, '{email}', to_jsonb('justin@peakmovement.com'::text)),
      '{email_verified}', 'true'::jsonb
    ),
    provider_id = 'justin@peakmovement.com',
    updated_at = now()
WHERE user_id = '623754db-590e-4a74-907f-b573b31b0780' AND provider = 'email';