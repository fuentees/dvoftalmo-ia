-- Deployment inspection only: metadata and grants, no patient/notification rows.
BEGIN TRANSACTION READ ONLY;

SELECT t.table_name, c.relrowsecurity AS rls_enabled,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', c.oid, 'SELECT') AS service_select
FROM (VALUES ('sinan_tracoma_rows'), ('sinan_tracoma_import_log'),
  ('cevesp_notificacoes'), ('cevesp_sync_log')) AS t(table_name)
JOIN pg_catalog.pg_class c ON c.oid = to_regclass('public.' || t.table_name);

SELECT p.oid::regprocedure::text AS function_signature,
  p.prosecdef AS security_definer, p.proconfig AS fixed_configuration,
  CASE WHEN p.proname = 'cevesp_relatorio' THEN
    obj_description(p.oid, 'pg_proc') = 'CEVESP report with per-row demographic validation v1'
      AND p.prosrc LIKE '%''sex_invalid_rows''%' AND p.prosrc LIKE '%''age_invalid_rows''%'
    ELSE NULL END AS demographic_validation_installed,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND (left(p.proname, 7) = 'cevesp_' OR p.proname IN (
  'nottraconet_history_by_year', 'traconet_history_by_year',
  'current_role', 'handle_new_user', 'guard_profile_role'))
ORDER BY p.proname;

SELECT tgname AS trigger_name, NOT tgisinternal AS application_trigger,
  tgenabled AS enabled FROM pg_catalog.pg_trigger
WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_role_guard';

SELECT attname AS column_name, attgenerated = 's' AS stored_generated
FROM pg_catalog.pg_attribute
WHERE attrelid = 'public.cevesp_notificacoes'::regclass
  AND attname IN ('ano_suspeito', 'created_at_origem', 'ID') AND NOT attisdropped;

ROLLBACK;
