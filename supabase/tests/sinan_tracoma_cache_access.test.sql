BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(31);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sinan_tracoma_rows'::regclass), 'individual cache has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sinan_tracoma_import_log'::regclass), 'import log has RLS');
SELECT ok(NOT has_table_privilege('anon', 'public.sinan_tracoma_rows', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no individual cache grants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sinan_tracoma_rows', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no individual cache grants');
SELECT ok(NOT has_table_privilege('anon', 'public.sinan_tracoma_import_log', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no import log grants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sinan_tracoma_import_log', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no import log grants');
SELECT ok(NOT has_sequence_privilege('anon', 'public.sinan_tracoma_rows_id_seq', 'USAGE,SELECT,UPDATE'), 'anon cannot use the case sequence');
SELECT ok(NOT has_sequence_privilege('authenticated', 'public.sinan_tracoma_rows_id_seq', 'USAGE,SELECT,UPDATE'), 'authenticated cannot use the case sequence');
SELECT ok(NOT has_sequence_privilege('anon', 'public.sinan_tracoma_import_log_id_seq', 'USAGE,SELECT,UPDATE'), 'anon cannot use the import sequence');
SELECT ok(NOT has_sequence_privilege('authenticated', 'public.sinan_tracoma_import_log_id_seq', 'USAGE,SELECT,UPDATE'), 'authenticated cannot use the import sequence');
SELECT ok(has_table_privilege('service_role', 'public.sinan_tracoma_rows', 'SELECT'), 'server can read the individual cache');
SELECT ok(has_table_privilege('service_role', 'public.sinan_tracoma_import_log', 'SELECT'), 'server can read the import log');
SELECT ok(NOT has_function_privilege('anon', 'public.nottraconet_history_by_year()', 'EXECUTE'), 'anon cannot invoke consolidated history directly');
SELECT ok(NOT has_function_privilege('authenticated', 'public.nottraconet_history_by_year()', 'EXECUTE'), 'authenticated cannot invoke consolidated history directly');
SELECT ok(NOT has_function_privilege('anon', 'public.traconet_history_by_year()', 'EXECUTE'), 'anon cannot invoke individual history directly');
SELECT ok(NOT has_function_privilege('authenticated', 'public.traconet_history_by_year()', 'EXECUTE'), 'authenticated cannot invoke individual history directly');

SET LOCAL ROLE anon;
SELECT throws_ok('SELECT raw FROM public.sinan_tracoma_rows', '42501', NULL, 'anon cannot read raw health data');
SELECT throws_ok($$INSERT INTO public.sinan_tracoma_rows (row_key, source_bank) VALUES ('access-test-anon', 'traconet')$$, '42501', NULL, 'anon cannot inject cases');
SELECT throws_ok('SELECT * FROM public.nottraconet_history_by_year()', '42501', NULL, 'anon history call is denied');
SELECT throws_ok('SELECT * FROM public.traconet_history_by_year()', '42501', NULL, 'anon individual history call is denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT raw FROM public.sinan_tracoma_rows', '42501', NULL, 'authenticated cannot read raw health data directly');
SELECT throws_ok('UPDATE public.sinan_tracoma_rows SET ano = 2020', '42501', NULL, 'authenticated cannot change cases directly');
SELECT throws_ok('DELETE FROM public.sinan_tracoma_rows', '42501', NULL, 'authenticated cannot delete cases directly');
SELECT throws_ok('SELECT * FROM public.nottraconet_history_by_year()', '42501', NULL, 'authenticated history call is denied');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok($$INSERT INTO public.sinan_tracoma_rows (row_key, source_bank, ano, municipio, raw) VALUES ('access-test-service', 'traconet', 2020, '355030', '{"FORMA_TF":"1"}')$$, 'server can import a case with its generated id');
SELECT results_eq($$SELECT row_key FROM public.sinan_tracoma_rows WHERE row_key = 'access-test-service'$$, ARRAY['access-test-service']::text[], 'server can read the imported case');
SELECT lives_ok($$UPDATE public.sinan_tracoma_rows SET ano = 2021 WHERE row_key = 'access-test-service'$$, 'server can update an imported case');
SELECT lives_ok($$INSERT INTO public.sinan_tracoma_import_log (source_bank, rows_upserted) VALUES ('traconet', 1)$$, 'server can record an import with its generated id');
SELECT lives_ok('SELECT * FROM public.nottraconet_history_by_year()', 'server can aggregate consolidated history');
SELECT lives_ok('SELECT * FROM public.traconet_history_by_year()', 'server can aggregate individual history');
SELECT lives_ok($$DELETE FROM public.sinan_tracoma_rows WHERE row_key = 'access-test-service'$$, 'server can remove its test case');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
