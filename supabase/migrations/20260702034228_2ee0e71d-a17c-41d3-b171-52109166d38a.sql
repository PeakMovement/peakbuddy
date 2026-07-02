
CREATE TABLE public.checkin_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','morning','evening','custom')),
  time_of_day time NOT NULL DEFAULT '08:00',
  days_of_week int[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  timezone text NOT NULL DEFAULT 'UTC',
  last_sent_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkin_reminders TO authenticated;
GRANT ALL ON public.checkin_reminders TO service_role;

ALTER TABLE public.checkin_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client can view own reminder"
  ON public.checkin_reminders FOR SELECT TO authenticated
  USING (client_id = public.current_client_id());

CREATE POLICY "Client can insert own reminder"
  ON public.checkin_reminders FOR INSERT TO authenticated
  WITH CHECK (client_id = public.current_client_id());

CREATE POLICY "Client can update own reminder"
  ON public.checkin_reminders FOR UPDATE TO authenticated
  USING (client_id = public.current_client_id())
  WITH CHECK (client_id = public.current_client_id());

CREATE POLICY "Client can delete own reminder"
  ON public.checkin_reminders FOR DELETE TO authenticated
  USING (client_id = public.current_client_id());

CREATE POLICY "Practitioner can view client reminders"
  ON public.checkin_reminders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.practitioner_id = auth.uid()));

CREATE TRIGGER checkin_reminders_updated_at
  BEFORE UPDATE ON public.checkin_reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
