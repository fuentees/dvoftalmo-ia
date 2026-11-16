-- Isolated synthetic fixture only. Never execute this insertion test in production.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(29);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000201', 'proposer@example.test', '{}'),
  ('00000000-0000-0000-0000-000000000202', 'reviewer@example.test', '{}'),
  ('00000000-0000-0000-0000-000000000203', 'administrator@example.test', '{}');
UPDATE public.profiles SET role = 'coordenador' WHERE id = '00000000-0000-0000-0000-000000000202';
UPDATE public.profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000203';

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.correction_queue'::regclass), 'correction queue has RLS');
SELECT ok(NOT has_table_privilege('anon', 'public.correction_queue', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no queue grants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.correction_queue', 'UPDATE'), 'client has no unrestricted table UPDATE');
SELECT ok(has_column_privilege('authenticated', 'public.correction_queue', 'status', 'UPDATE'), 'staff review columns remain writable under RLS');
SELECT ok(NOT has_column_privilege('authenticated', 'public.correction_queue', 'new_value', 'UPDATE'), 'audited payload is not client-writable');
SELECT ok(has_table_privilege('service_role', 'public.correction_queue', 'SELECT,INSERT,UPDATE'), 'server keeps proposal/apply grants');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO public.correction_queue (id, proposed_by, table_name, record_id, field_name, new_value) VALUES ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000201', 'notifications_fixture', '1', 'ANO', '2026')$$, 'user can propose pending correction');
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000211'$$, ARRAY['pending'], 'proposal starts pending');
SELECT throws_ok($$INSERT INTO public.correction_queue (proposed_by, table_name, record_id, field_name, new_value, status) VALUES ('00000000-0000-0000-0000-000000000201', 'notifications_fixture', '2', 'ANO', '2026', 'approved')$$, '42501', NULL, 'user cannot insert preapproved correction');
SELECT throws_ok($$INSERT INTO public.correction_queue (proposed_by, table_name, record_id, field_name, new_value, reviewed_by) VALUES ('00000000-0000-0000-0000-000000000201', 'notifications_fixture', '2', 'ANO', '2026', '00000000-0000-0000-0000-000000000202')$$, '42501', NULL, 'proposal cannot forge reviewer');
SELECT throws_ok($$INSERT INTO public.correction_queue (proposed_by, table_name, record_id, field_name, new_value, reviewed_at) VALUES ('00000000-0000-0000-0000-000000000201', 'notifications_fixture', '2', 'ANO', '2026', now())$$, '42501', NULL, 'proposal cannot forge review time');
SELECT throws_ok($$INSERT INTO public.correction_queue (proposed_by, table_name, record_id, field_name, new_value, applied_at) VALUES ('00000000-0000-0000-0000-000000000201', 'notifications_fixture', '2', 'ANO', '2026', now())$$, '42501', NULL, 'proposal cannot forge application time');
UPDATE public.correction_queue SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-000000000201', reviewed_at = now() WHERE id = '00000000-0000-0000-0000-000000000211';
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000211'$$, ARRAY['pending'], 'ordinary user cannot approve');
SELECT throws_ok($$UPDATE public.correction_queue SET new_value = '9999' WHERE id = '00000000-0000-0000-0000-000000000211'$$, '42501', NULL, 'user cannot replace audited value');
RESET ROLE;

INSERT INTO public.correction_queue (id, proposed_by, table_name, record_id, field_name, new_value) VALUES ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-000000000201', 'notifications_fixture', '2', 'ANO', '2026');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', true);
SET LOCAL ROLE authenticated;
SELECT results_eq('SELECT public.current_role()::text', ARRAY['coordenador'], 'coordinator lookup remains usable');
SELECT lives_ok($$UPDATE public.correction_queue SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-000000000202', reviewed_at = now() WHERE id = '00000000-0000-0000-0000-000000000211'$$, 'coordinator can approve pending proposal');
SELECT results_eq($$SELECT status || ':' || reviewed_by::text FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000211'$$, ARRAY['approved:00000000-0000-0000-0000-000000000202'], 'approval records actual coordinator');
UPDATE public.correction_queue SET status = 'rejected', reviewed_by = '00000000-0000-0000-0000-000000000202', reviewed_at = now() WHERE id = '00000000-0000-0000-0000-000000000211';
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000211'$$, ARRAY['approved'], 'completed review is immutable to client');
SELECT throws_ok($$UPDATE public.correction_queue SET status = 'applied', reviewed_by = '00000000-0000-0000-0000-000000000202', reviewed_at = now() WHERE id = '00000000-0000-0000-0000-000000000212'$$, '42501', NULL, 'client cannot mark application without server');
SELECT throws_ok($$UPDATE public.correction_queue SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-000000000203', reviewed_at = now() WHERE id = '00000000-0000-0000-0000-000000000212'$$, '42501', NULL, 'coordinator cannot impersonate another reviewer');
SELECT throws_ok($$UPDATE public.correction_queue SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-000000000202', reviewed_at = NULL WHERE id = '00000000-0000-0000-0000-000000000212'$$, '42501', NULL, 'review timestamp is required');
SELECT throws_ok($$UPDATE public.correction_queue SET new_value = '9999' WHERE id = '00000000-0000-0000-0000-000000000212'$$, '42501', NULL, 'staff cannot alter audited payload through client');
SELECT throws_ok($$UPDATE public.correction_queue SET applied_at = now() WHERE id = '00000000-0000-0000-0000-000000000212'$$, '42501', NULL, 'application timestamp is server-only');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000203', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$UPDATE public.correction_queue SET status = 'rejected', reviewed_by = '00000000-0000-0000-0000-000000000203', reviewed_at = now() WHERE id = '00000000-0000-0000-0000-000000000212'$$, 'admin can reject pending proposal');
SELECT results_eq($$SELECT status FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000212'$$, ARRAY['rejected'], 'rejection is persisted');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok($$UPDATE public.correction_queue SET status = 'applied', applied_at = now() WHERE id = '00000000-0000-0000-0000-000000000211'$$, 'server can record successful source application');
SELECT results_eq($$SELECT status || ':' || reviewed_by::text FROM public.correction_queue WHERE id = '00000000-0000-0000-0000-000000000211'$$, ARRAY['applied:00000000-0000-0000-0000-000000000202'], 'applying preserves original reviewer');
SELECT lives_ok($$INSERT INTO public.correction_queue (proposed_by, table_name, record_id, field_name, new_value) VALUES ('00000000-0000-0000-0000-000000000201', 'notifications_fixture', '3', 'ANO', '2026')$$, 'authenticated proposal API can still insert using server client');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok('SELECT * FROM public.correction_queue', '42501', NULL, 'anonymous queue access is denied');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
