-- 0006_check_ins_append_only
--
-- The check_ins policy currently grants ALL to authenticated clients where
-- client_id = current_client_id(). ALL includes UPDATE and DELETE, so a
-- logged-in patient can edit or delete their own past check-ins straight from
-- the browser with their own token. That is a clinical record. It should be
-- append-only from the patient's side, and it matters doubly here because a
-- patient could delete the very check-in that raised a red flag.
--
-- Verified before writing this: nothing in src/ updates or deletes check_ins.
-- Inserts go through the insert_check_in RPC and everything else is a select,
-- so tightening this breaks no existing code path. Practitioner and admin
-- reads run through server functions on the service role and are unaffected.
--
-- NOT APPLIED. Listed for Justin's approval first. This one changes who can do
-- what, so it is deliberately separate from 0005.

DROP POLICY IF EXISTS "check_ins access" ON check_ins;

CREATE POLICY "check_ins client select own" ON check_ins
  FOR SELECT TO authenticated
  USING (client_id = private.current_client_id());

CREATE POLICY "check_ins client insert own" ON check_ins
  FOR INSERT TO authenticated
  WITH CHECK (client_id = private.current_client_id());

-- No UPDATE or DELETE policy is created. Corrections, if ever needed, go
-- through a server function on the service role so they can be audited.
