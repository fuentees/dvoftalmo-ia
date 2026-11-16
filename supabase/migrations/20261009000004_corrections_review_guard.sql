-- Browser sessions may propose pending corrections and staff may review them.
-- Marking a correction applied and changing its audited payload are server-only.
-- Approvals created under the old INSERT policy cannot attest who reviewed them.
-- Require a fresh review only on the first transition from that policy. A rerun
-- must not undo legitimate reviews made after this migration was installed.
DO $migration$
DECLARE
  insert_check text;
BEGIN
  SELECT lower(pg_get_expr(polwithcheck, polrelid)) INTO insert_check
    FROM pg_policy
    WHERE polrelid = 'public.correction_queue'::regclass
      AND polname = 'corrections_insert';
  IF insert_check IS NULL
    OR position('status = ''pending''' IN insert_check) = 0
    OR position('reviewed_by is null' IN insert_check) = 0
    OR position('reviewed_at is null' IN insert_check) = 0
    OR position('applied_at is null' IN insert_check) = 0 THEN
    UPDATE public.correction_queue
      SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, applied_at = NULL
      WHERE status = 'approved';
  END IF;
END;
$migration$;

ALTER TABLE public.correction_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.correction_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.correction_queue TO authenticated;
GRANT UPDATE (status, reviewed_by, reviewed_at) ON TABLE public.correction_queue TO authenticated;
GRANT ALL ON TABLE public.correction_queue TO service_role;

DROP POLICY IF EXISTS corrections_insert ON public.correction_queue;
CREATE POLICY corrections_insert ON public.correction_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    proposed_by = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND applied_at IS NULL
  );

DROP POLICY IF EXISTS corrections_update ON public.correction_queue;
CREATE POLICY corrections_update ON public.correction_queue
  FOR UPDATE TO authenticated
  USING (public.current_role() IN ('admin', 'coordenador') AND status = 'pending')
  WITH CHECK (
    public.current_role() IN ('admin', 'coordenador')
    AND status IN ('approved', 'rejected')
    AND reviewed_by = auth.uid()
    AND reviewed_at IS NOT NULL
    AND applied_at IS NULL
  );
