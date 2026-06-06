
-- =========================================
-- profiles
-- =========================================
CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('practitioner','super_admin','client')),
  full_name text,
  profession text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read all" ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "profiles self write" ON public.profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- =========================================
-- practices
-- =========================================
CREATE TABLE public.practices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  practitioner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  practice_name text,
  profession text,
  popia_agreed boolean NOT NULL DEFAULT false,
  popia_agreed_at timestamptz,
  data_processing_agreed boolean NOT NULL DEFAULT false,
  data_processing_agreed_at timestamptz,
  onboarding_complete boolean NOT NULL DEFAULT false,
  is_approved boolean NOT NULL DEFAULT false,
  webhook_url text,
  webhook_enabled boolean NOT NULL DEFAULT false,
  contact_webhook_url text,
  contact_webhook_enabled boolean NOT NULL DEFAULT false,
  yves_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.practices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practices TO authenticated;
GRANT ALL ON public.practices TO service_role;
ALTER TABLE public.practices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "practices read all" ON public.practices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "practices owner write" ON public.practices FOR ALL TO authenticated
  USING (auth.uid() = practitioner_id) WITH CHECK (auth.uid() = practitioner_id);

-- =========================================
-- clients
-- =========================================
CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  phone text,
  primary_complaint text,
  notes text,
  check_in_frequency text NOT NULL DEFAULT 'daily',
  login_code text NOT NULL UNIQUE,
  popia_accepted boolean NOT NULL DEFAULT false,
  yves_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients all access" ON public.clients FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- =========================================
-- check_ins
-- =========================================
CREATE TABLE public.check_ins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pain_level integer,
  sleep_quality integer,
  stress_level integer,
  energy_level integer,
  mood text,
  notes text,
  medication_taken boolean,
  flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.check_ins TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.check_ins TO authenticated;
GRANT ALL ON public.check_ins TO service_role;
ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "check_ins all access" ON public.check_ins FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- =========================================
-- alerts
-- =========================================
CREATE TABLE public.alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('emergency','urgent','soon','monitor','routine')),
  message text,
  is_read boolean NOT NULL DEFAULT false,
  webhook_fired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts all access" ON public.alerts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- =========================================
-- symptom_queries
-- =========================================
CREATE TABLE public.symptom_queries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  query_text text NOT NULL,
  urgency text CHECK (urgency IN ('emergency','urgent','soon','monitor','routine')),
  red_flag_detected boolean DEFAULT false,
  suggested_next_step text DEFAULT '',
  ai_rationale text DEFAULT '',
  severity integer DEFAULT 0,
  source text DEFAULT 'keyword_only',
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.symptom_queries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.symptom_queries TO authenticated;
GRANT ALL ON public.symptom_queries TO service_role;
ALTER TABLE public.symptom_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "symptom_queries all access" ON public.symptom_queries FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- =========================================
-- platform_settings (super_admin only)
-- =========================================
CREATE TABLE public.platform_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  new_practitioner_webhook_url text DEFAULT '',
  new_practitioner_webhook_enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_settings super admin"
  ON public.platform_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin'));

INSERT INTO public.platform_settings (new_practitioner_webhook_url, new_practitioner_webhook_enabled)
VALUES ('', false);

-- =========================================
-- Auto-create profile on new auth user
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    'client',
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
