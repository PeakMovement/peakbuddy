CREATE TABLE public.quick_login_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  code_salt text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_at timestamp with time zone,
  last_failed_at timestamp with time zone,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.quick_login_codes TO service_role;

ALTER TABLE public.quick_login_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to quick login codes"
  ON public.quick_login_codes
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE TRIGGER quick_login_codes_updated_at
  BEFORE UPDATE ON public.quick_login_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();