BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(30);

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cevesp_notificacoes'::regclass), 'CEVESP cache has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cevesp_sync_log'::regclass), 'sync log has RLS');
SELECT ok(NOT has_table_privilege('anon', 'public.cevesp_notificacoes', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no cache grants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cevesp_notificacoes', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no cache grants');
SELECT ok(NOT has_table_privilege('anon', 'public.cevesp_sync_log', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no sync log grants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cevesp_sync_log', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated has no sync log grants');
SELECT ok(NOT has_sequence_privilege('anon', 'public.cevesp_notificacoes_id_seq', 'USAGE,SELECT,UPDATE'), 'anon cannot use cache sequence');
SELECT ok(NOT has_sequence_privilege('authenticated', 'public.cevesp_notificacoes_id_seq', 'USAGE,SELECT,UPDATE'), 'authenticated cannot use cache sequence');
SELECT ok(NOT has_sequence_privilege('anon', 'public.cevesp_sync_log_id_seq', 'USAGE,SELECT,UPDATE'), 'anon cannot use log sequence');
SELECT ok(NOT has_sequence_privilege('authenticated', 'public.cevesp_sync_log_id_seq', 'USAGE,SELECT,UPDATE'), 'authenticated cannot use log sequence');
SELECT ok(has_table_privilege('service_role', 'public.cevesp_notificacoes', 'SELECT,INSERT,UPDATE,DELETE'), 'server retains cache grants');
SELECT ok(has_table_privilege('service_role', 'public.cevesp_sync_log', 'SELECT,INSERT,UPDATE,DELETE'), 'server retains log grants');
SELECT ok((SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND left(p.proname, 7) = 'cevesp_'), 'anon cannot call CEVESP RPCs');
SELECT ok((SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND left(p.proname, 7) = 'cevesp_'), 'authenticated cannot call CEVESP RPCs');
SELECT ok((SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND left(p.proname, 7) = 'cevesp_'), 'server retains all CEVESP RPCs');
SELECT is((SELECT count(DISTINCT p.proname)::int FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND left(p.proname, 7) = 'cevesp_'), 13, 'all 13 current cache RPC names are covered');
SELECT ok((SELECT bool_and('search_path=public, pg_temp' = ANY(p.proconfig)) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND left(p.proname, 7) = 'cevesp_'), 'cache RPCs have a fixed search path');

SET LOCAL ROLE anon;
SELECT throws_ok('SELECT * FROM public.cevesp_notificacoes', '42501', NULL, 'anon cannot read cache');
SELECT throws_ok($$INSERT INTO public.cevesp_notificacoes(row_key) VALUES ('access-test-anon')$$, '42501', NULL, 'anon cannot inject a notification');
SELECT throws_ok('SELECT * FROM public.cevesp_anos_disponiveis()', '42501', NULL, 'anon RPC call is denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM public.cevesp_notificacoes', '42501', NULL, 'authenticated cannot read cache directly');
SELECT throws_ok('UPDATE public.cevesp_notificacoes SET "ANO" = 2020', '42501', NULL, 'authenticated cannot update notifications');
SELECT throws_ok('DELETE FROM public.cevesp_notificacoes', '42501', NULL, 'authenticated cannot delete notifications');
SELECT throws_ok('SELECT public.cevesp_relatorio()', '42501', NULL, 'authenticated report RPC is denied');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok($$INSERT INTO public.cevesp_notificacoes (row_key, "ANO", "TotalCaso") VALUES ('access-test-service', 2020, 2)$$, 'server can import with generated id');
SELECT results_eq($$SELECT "TotalCaso" FROM public.cevesp_notificacoes WHERE row_key = 'access-test-service'$$, ARRAY[2]::numeric[], 'server can read imported notification');
SELECT lives_ok($$UPDATE public.cevesp_notificacoes SET "ANO" = 2021 WHERE row_key = 'access-test-service'$$, 'server can update notification');
SELECT lives_ok($$INSERT INTO public.cevesp_sync_log (ano, rows_upserted, mode) VALUES (2021, 1, 'test')$$, 'server can record sync with generated id');
SELECT lives_ok('SELECT public.cevesp_relatorio(2021)', 'server can generate report');
SELECT lives_ok($$DELETE FROM public.cevesp_notificacoes WHERE row_key = 'access-test-service'$$, 'server can remove its test notification');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
