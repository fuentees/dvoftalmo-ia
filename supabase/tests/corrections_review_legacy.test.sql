-- Synthetic local fixture. The runner substitutes the actual migration below.
-- Never execute this fixture against production.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(12);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000301', 'legacy-proposer@example.test', '{}'),
  ('00000000-0000-0000-0000-000000000302', 'legacy-reviewer@example.test', '{}');
UPDATE public.profiles SET role = 'coordenador' WHERE id = '00000000-0000-0000-0000-000000000302';

-- Reproduce the old policy that allowed a proposer to forge approval metadata.
DROP POLICY corrections_insert ON public.correction_queue;
CREATE POLICY corrections_insert ON public.correction_queue
  FOR INSERT TO authenticated WITH CHECK (proposed_by = auth.uid());
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.correction_queue (id, proposed_by, table_name, record_id, field_name, new_value, status, reviewed_by, reviewed_at) VALUES
  ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000301', 'notifications_fixture', '11', 'ANO', '2026', 'approved', '00000000-0000-0000-0000-000000000302', '2026-10-01T12:00:00Z');
INSERT INTO public.correction_queue (id, proposed_by, table_name, record_id, field_name, new_value, status, reviewed_by, reviewed_at, applied_at) VALUES
  ('00000000-0000-0000-0000-000000000315', '00000000-0000-0000-0000-000000000301', 'notifications_fixture', '15', 'ANO', '2026', 'approved', '00000000-0000-0000-0000-000000000302', '2026-10-01T12:00:00Z', '2026-10-02T12:00:00Z');
RESET ROLE;
INSERT INTO public.correction_queue (id, proposed_by, table_name, record_id, field_name, new_value, status, reviewed_by, reviewed_at, applied_at) VALUES
  ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000301', 'notifications_fixture', '12', 'ANO', '2026', 'applied', '00000000-0000-0000-0000-000000000302', '2026-10-01T12:00:00Z', '2026-10-02T12:00:00Z'),
  ('00000000-0000-0000-0000-000000000313', '00000000-0000-0000-0000-000000000301', 'notifications_fixture', '13', 'ANO', '2026', 'pending', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000314', '00000000-0000-0000-0000-000000000301', 'notifications_fixture', '14', 'ANO', '2026', 'rejected', '00000000-0000-0000-0000-000000000302', '2026-10-01T12:00:00Z', NULL);

/* APPLY_CORRECTIONS_REVIEW_MIGRATION */
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000311'$$, ARRAY['pending'], 'legacy un-applied approval requires fresh review');
SELECT ok((SELECT reviewed_by IS NULL AND reviewed_at IS NULL FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000311'), 'legacy untrusted reviewer and timestamp are cleared');
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000315'$$, ARRAY['pending'], 'a forged application timestamp cannot preserve a legacy approval');
SELECT ok((SELECT reviewed_by IS NULL AND reviewed_at IS NULL AND applied_at IS NULL FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000315'), 'forged approval and application metadata are cleared');
SELECT results_eq($$SELECT new_value FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000311'$$, ARRAY['2026'], 'legacy proposal payload is preserved for review');
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000312'$$, ARRAY['applied'], 'already applied correction remains applied');
SELECT ok((SELECT reviewed_by = '00000000-0000-0000-0000-000000000302'::uuid AND reviewed_at = '2026-10-01T12:00:00Z'::timestamptz AND applied_at = '2026-10-02T12:00:00Z'::timestamptz FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000312'), 'applied correction retains review and application timestamps');
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000313'$$, ARRAY['pending'], 'pending proposal is preserved');
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000314'$$, ARRAY['rejected'], 'rejected proposal is preserved');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$UPDATE public.correction_queue SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-000000000302', reviewed_at = '2026-11-16T12:00:00Z' WHERE id = '00000000-0000-0000-0000-000000000311'$$, 'coordinator can freshly review the legacy proposal');
RESET ROLE;

/* APPLY_CORRECTIONS_REVIEW_MIGRATION */
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000311'$$, ARRAY['approved'], 'reapplying migration preserves a fresh trusted approval');
SELECT ok((SELECT reviewed_by = '00000000-0000-0000-0000-000000000302'::uuid AND reviewed_at = '2026-11-16T12:00:00Z'::timestamptz FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000311'), 'reapplying migration preserves fresh review metadata');

SELECT * FROM finish();
ROLLBACK;
