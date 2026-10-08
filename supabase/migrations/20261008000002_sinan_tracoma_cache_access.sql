-- SINAN can contain individual health and identity fields in raw JSON.
-- All application readers and importers use the server-side service_role client.
-- Client roles must not read or modify this cache directly through PostgREST.
ALTER TABLE public.sinan_tracoma_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sinan_tracoma_import_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sinan_tracoma_rows, public.sinan_tracoma_import_log
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sinan_tracoma_rows, public.sinan_tracoma_import_log
  TO service_role;

REVOKE ALL ON SEQUENCE public.sinan_tracoma_rows_id_seq, public.sinan_tracoma_import_log_id_seq
  FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.sinan_tracoma_rows_id_seq, public.sinan_tracoma_import_log_id_seq
  TO service_role;

-- SECURITY DEFINER bypasses table RLS. Keep its entry points server-only as well.
REVOKE ALL ON FUNCTION public.nottraconet_history_by_year(), public.traconet_history_by_year()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nottraconet_history_by_year(), public.traconet_history_by_year()
  TO service_role;

-- Existing bodies reference the public cache; put pg_temp last so a temporary
-- relation cannot shadow it during a legitimate server-side call.
ALTER FUNCTION public.nottraconet_history_by_year() SET search_path = public, pg_temp;
ALTER FUNCTION public.traconet_history_by_year() SET search_path = public, pg_temp;
