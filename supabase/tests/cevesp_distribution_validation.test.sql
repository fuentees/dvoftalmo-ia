-- Real RPC with synthetic rows in isolated PostgreSQL. Never run in production.
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(35);

INSERT INTO public.cevesp_notificacoes
  (row_key, "ANO", "SemEpidemio", "GVE_NOME", "MunicipioNotificacao", "TotalCaso", "SexMasc", "SexFem", "FxMenorUmAno", "FxQuizeOuMais", "Excluido") VALUES
  ('demo-cancel-a', 2026, 10, 'FIXTURE A', 'Alpha', 10, 15, 0, NULL, 15, 0),
  ('demo-cancel-b', 2026, 10, 'FIXTURE A', 'Alpha', 10, 5, 0, NULL, 5, 0),
  ('demo-missing-category', 2026, 11, 'FIXTURE A', 'Alpha', 10, NULL, NULL, NULL, NULL, 0),
  ('demo-missing-total', 2026, 12, 'FIXTURE A', 'Alpha', NULL, NULL, NULL, NULL, NULL, 0),
  ('demo-negative-sex', 2026, 13, 'FIXTURE A', 'Alpha', 10, -1, 11, NULL, 10, 0),
  ('demo-fraction-sex', 2026, 14, 'FIXTURE A', 'Alpha', 10, 1.5, 8.5, NULL, 10, 0),
  ('demo-negative-age', 2026, 15, 'FIXTURE A', 'Alpha', 10, 5, 5, -1, 11, 0),
  ('demo-fraction-age', 2026, 16, 'FIXTURE A', 'Alpha', 10, 5, 5, 1.5, 8.5, 0),
  ('demo-negative-total', 2026, 17, 'FIXTURE A', 'Alpha', -1, NULL, NULL, NULL, NULL, 0),
  ('demo-fraction-total', 2026, 18, 'FIXTURE A', 'Alpha', 1.5, NULL, NULL, NULL, NULL, 0),
  ('demo-excluded', 2026, 10, 'FIXTURE A', 'Alpha', 10, 999, 0, NULL, 999, 1),
  ('demo-other-gve', 2026, 10, 'FIXTURE B', 'Beta', 10, 99, 0, NULL, 99, 0),
  ('demo-other-year', 2025, 10, 'FIXTURE A', 'Alpha', 10, 99, 0, NULL, 99, 0),
  ('demo-nan-sex', 2026, 19, 'FIXTURE A', 'Alpha', 10, 'NaN'::numeric, NULL, NULL, 10, 0),
  ('demo-nan-age', 2026, 20, 'FIXTURE A', 'Alpha', 10, 5, 5, NULL, 'NaN'::numeric, 0),
  ('demo-infinite-sex', 2026, 21, 'FIXTURE A', 'Alpha', 10, 'Infinity'::numeric, NULL, NULL, 10, 0),
  ('demo-infinite-age', 2026, 22, 'FIXTURE A', 'Alpha', 10, 5, 5, NULL, 'Infinity'::numeric, 0),
  ('demo-nan-total', 2030, NULL, NULL, NULL, 'NaN'::numeric, NULL, NULL, NULL, NULL, 0),
  ('demo-infinite-total', 2031, NULL, NULL, NULL, 'Infinity'::numeric, NULL, NULL, NULL, NULL, 0),
  ('demo-unsafe-total', 2032, NULL, NULL, NULL, 9007199254740992, NULL, NULL, NULL, NULL, 0);

-- Compare every legacy output field against the actual previous implementation.
/* APPLY_PREVIOUS_CEVESP_REPORT */
CREATE TEMP TABLE previous_report AS SELECT public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10) AS value;
/* APPLY_CEVESP_DISTRIBUTION_MIGRATION */

SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10) - 'sex_invalid_rows' - 'age_invalid_rows')::text, (SELECT value::text FROM previous_report), 'legacy fields and filters are preserved');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)->>'sex_invalid_rows')::int, 1, 'one invalid sex row survives cancellation');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)->>'age_invalid_rows')::int, 1, 'one invalid age row survives cancellation');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)->>'total_cases')::numeric, 20::numeric, 'aggregate case sum looks plausible');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)->>'total_notifications')::int, 2, 'excluded and out-of-scope rows do not enter report');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)->>'sex_masc')::numeric, 20::numeric, 'aggregate sex count equals cases despite invalid individual row');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)->>'fx_15_mais')::numeric, 20::numeric, 'aggregate age count equals cases despite invalid individual row');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 11, 11)->>'sex_invalid_rows')::int, 0, 'missing sex category is absence, not invalid count');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 11, 11)->>'age_invalid_rows')::int, 0, 'missing age category is absence, not invalid count');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 12, 12)->>'sex_invalid_rows')::int, 1, 'missing total invalidates sex profile');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 12, 12)->>'age_invalid_rows')::int, 1, 'missing total invalidates age profile');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 13, 13)->>'sex_invalid_rows')::int, 1, 'negative sex count is invalid');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 13, 13)->>'age_invalid_rows')::int, 0, 'sex error does not invalidate valid age distribution');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 14, 14)->>'sex_invalid_rows')::int, 1, 'fractional sex counts are invalid even with integral aggregate');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 15, 15)->>'age_invalid_rows')::int, 1, 'negative age count is invalid');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 16, 16)->>'age_invalid_rows')::int, 1, 'fractional age counts are invalid even with integral aggregate');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 17, 17)->>'sex_invalid_rows')::int + (public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 17, 17)->>'age_invalid_rows')::int, 2, 'negative total invalidates both distributions');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 18, 18)->>'sex_invalid_rows')::int + (public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 18, 18)->>'age_invalid_rows')::int, 2, 'fractional total invalidates both distributions');
SELECT is(public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'aLpH', 10, 10)::text, public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)::text, 'municipality case-insensitive substring contract is preserved');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE B', NULL, 10, 10)->>'sex_invalid_rows')::int, 1, 'GVE filter determines validation scope');
SELECT is((public.cevesp_relatorio(2025, 2026, 'FIXTURE A', 'Alpha', 10, 10)->>'sex_invalid_rows')::int, 2, 'year interval applies equally to counters');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 11, 12)->>'sex_invalid_rows')::int, 1, 'week interval applies equally to counters');
SELECT is((public.cevesp_relatorio(2099)->>'sex_invalid_rows')::int + (public.cevesp_relatorio(2099)->>'age_invalid_rows')::int, 0, 'empty scope reports explicit zero invalid rows');
SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)$$, 'server retains aggregate report execution');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT public.cevesp_relatorio(2026)', '42501', NULL, 'anonymous report execution remains denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT public.cevesp_relatorio(2026)', '42501', NULL, 'browser report execution remains denied');
RESET ROLE;
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.cevesp_relatorio(integer,integer,text,text,integer,integer)'::regprocedure), 'definer and fixed search path are retained');
SELECT is(jsonb_typeof(public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 10, 10)->'sex_invalid_rows'), 'number', 'validation counter has numeric JSON contract');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 19, 19)->>'sex_invalid_rows')::int, 1, 'numeric NaN sex count is invalid');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 20, 20)->>'age_invalid_rows')::int, 1, 'numeric NaN age count is invalid');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 21, 21)->>'sex_invalid_rows')::int, 1, 'numeric infinite sex count is invalid');
SELECT is((public.cevesp_relatorio(2026, NULL, 'FIXTURE A', 'Alpha', 22, 22)->>'age_invalid_rows')::int, 1, 'numeric infinite age count is invalid');
SELECT is((public.cevesp_relatorio(2030)->>'sex_invalid_rows')::int + (public.cevesp_relatorio(2030)->>'age_invalid_rows')::int, 2, 'numeric NaN total invalidates both profiles');
SELECT is((public.cevesp_relatorio(2031)->>'sex_invalid_rows')::int + (public.cevesp_relatorio(2031)->>'age_invalid_rows')::int, 2, 'numeric infinite total invalidates both profiles');
SELECT is((public.cevesp_relatorio(2032)->>'sex_invalid_rows')::int + (public.cevesp_relatorio(2032)->>'age_invalid_rows')::int, 2, 'total outside safe integer range invalidates both profiles');

SELECT * FROM finish();
ROLLBACK;
