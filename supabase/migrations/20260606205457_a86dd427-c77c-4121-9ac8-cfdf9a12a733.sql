ALTER TABLE public.profiles DISABLE TRIGGER profiles_prevent_role_escalation;
UPDATE public.profiles SET role='practitioner', profession='Physiotherapist', full_name='Justin Muller' WHERE id='830e2238-3f10-470e-8b5a-ee2a336dd47d';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_prevent_role_escalation;
INSERT INTO public.practices (practitioner_id, practice_name, profession, onboarding_complete, is_approved)
SELECT '830e2238-3f10-470e-8b5a-ee2a336dd47d', '', 'Physiotherapist', false, false
WHERE NOT EXISTS (SELECT 1 FROM public.practices WHERE practitioner_id='830e2238-3f10-470e-8b5a-ee2a336dd47d');