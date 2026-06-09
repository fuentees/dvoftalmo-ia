-- Audit log for every CEVESP correction that gets applied.
CREATE TABLE IF NOT EXISTS correction_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id UUID NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('applied', 'rolled_back')),
  applied_by    UUID NOT NULL REFERENCES auth.users(id),
  table_name    TEXT NOT NULL,
  record_id     TEXT NOT NULL,
  field_name    TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE correction_audit_log ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read the audit log (transparency)
CREATE POLICY "Authenticated users can read audit log"
  ON correction_audit_log FOR SELECT TO authenticated USING (true);

-- Only service_role can insert (done server-side)
CREATE POLICY "Service role inserts only"
  ON correction_audit_log FOR INSERT TO service_role WITH CHECK (true);
