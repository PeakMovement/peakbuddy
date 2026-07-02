UPDATE auth.users
SET email = 'justin@peakmovement.co.za',
    updated_at = now()
WHERE id = '623754db-590e-4a74-907f-b573b31b0780';

UPDATE auth.identities
SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb('justin@peakmovement.co.za'::text)),
    provider_id = 'justin@peakmovement.co.za',
    updated_at = now()
WHERE user_id = '623754db-590e-4a74-907f-b573b31b0780' AND provider = 'email';