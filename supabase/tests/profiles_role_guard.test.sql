-- Synthetic identities only. Run on the local isolated fixture, never production.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(24);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000101', 'user@example.test', '{"role":"admin","full_name":"Teste de acesso"}'),
  ('00000000-0000-0000-0000-000000000102', 'invalid@example.test', '{"role":"invalid-enum"}'),
  ('00000000-0000-0000-0000-000000000103', 'admin@example.test', '{}'),
  ('00000000-0000-0000-0000-000000000104', 'coordinator@example.test', '{}');
UPDATE public.profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000103';
UPDATE public.profiles SET role = 'coordenador' WHERE id = '00000000-0000-0000-0000-000000000104';

SELECT results_eq($$SELECT role::text FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000101'$$, ARRAY['usuario'], 'signup metadata cannot assign admin');
SELECT results_eq($$SELECT role::text FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000102'$$, ARRAY['usuario'], 'invalid role metadata does not break signup');
SELECT results_eq($$SELECT full_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000101'$$, ARRAY['Teste de acesso'], 'normal signup metadata is preserved');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.current_role()'::regprocedure), 'current_role bypasses recursive profile RLS');
SELECT ok((SELECT 'search_path=""' = ANY(proconfig) FROM pg_proc WHERE oid = 'public.current_role()'::regprocedure), 'current_role has an empty fixed search path');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_profile_role()'::regprocedure), 'role guard checks caller privileges');
SELECT ok(NOT has_function_privilege('anon', 'public.current_role()', 'EXECUTE'), 'anon cannot inspect current role');

SET LOCAL ROLE anon;
SELECT throws_ok('SELECT public.current_role()', '42501', NULL, 'anonymous role lookup is denied');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
SET LOCAL ROLE authenticated;
SELECT results_eq('SELECT public.current_role()::text', ARRAY['usuario'], 'role lookup works without RLS recursion');
SELECT results_eq($$SELECT full_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000101'$$, ARRAY['Teste de acesso'], 'user can read own profile');
SELECT is((SELECT count(*)::int FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000103'), 0, 'user cannot read another profile');
SELECT lives_ok($$UPDATE public.profiles SET full_name = 'Nome editado' WHERE id = '00000000-0000-0000-0000-000000000101'$$, 'user can edit ordinary profile fields');
SELECT lives_ok($$UPDATE public.profiles SET selected_model = NULL WHERE id = '00000000-0000-0000-0000-000000000101'$$, 'existing model preference route remains usable');
SELECT throws_ok($$UPDATE public.profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000101'$$, '42501', NULL, 'user cannot become admin');
SELECT throws_ok($$UPDATE public.profiles SET role = 'coordenador' WHERE id = '00000000-0000-0000-0000-000000000101'$$, '42501', NULL, 'user cannot become coordinator');
SELECT lives_ok($$UPDATE public.profiles SET role = 'usuario' WHERE id = '00000000-0000-0000-0000-000000000101'$$, 'unchanged role is accepted');
SELECT throws_ok($$INSERT INTO public.profiles(id, full_name, email, role) VALUES ('00000000-0000-0000-0000-000000000105', 'Injected', 'injected@example.test', 'admin')$$, '42501', NULL, 'client cannot insert staff profile');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', true);
SET LOCAL ROLE authenticated;
SELECT results_eq('SELECT public.current_role()::text', ARRAY['coordenador'], 'existing coordinator role is preserved');
SELECT throws_ok($$UPDATE public.profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000104'$$, '42501', NULL, 'coordinator cannot become admin');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
SET LOCAL ROLE authenticated;
SELECT results_eq('SELECT public.current_role()::text', ARRAY['admin'], 'existing admin remains authorized');
SELECT lives_ok($$UPDATE public.profiles SET role = 'supervisor' WHERE id = '00000000-0000-0000-0000-000000000101'$$, 'admin can assign staff role');
SELECT results_eq($$SELECT role::text FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000101'$$, ARRAY['supervisor'], 'admin role assignment is persisted');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok($$UPDATE public.profiles SET role = 'usuario' WHERE id = '00000000-0000-0000-0000-000000000101'$$, 'trusted server can assign roles');
RESET ROLE;
SELECT results_eq($$SELECT role::text FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000101'$$, ARRAY['usuario'], 'server role assignment is persisted');

SELECT * FROM finish();
ROLLBACK;
