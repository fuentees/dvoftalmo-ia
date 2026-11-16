-- Cache and sync logs are consumed by authenticated application routes using
-- createAdminClient(), never directly by a browser Supabase client.
ALTER TABLE public.cevesp_notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cevesp_sync_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cevesp_notificacoes, public.cevesp_sync_log
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cevesp_notificacoes, public.cevesp_sync_log
  TO service_role;

REVOKE ALL ON SEQUENCE public.cevesp_notificacoes_id_seq, public.cevesp_sync_log_id_seq
  FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cevesp_notificacoes_id_seq, public.cevesp_sync_log_id_seq
  TO service_role;

-- Cover every existing overload: the DEFINER RPCs otherwise bypass table RLS.
-- Restrict to the known cache function names, leaving unrelated functions alone.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'cevesp_aggregate', 'cevesp_kpis_cache', 'cevesp_qualidade_dados',
        'cevesp_diagnostico', 'cevesp_anos_disponiveis', 'cevesp_status_resumo',
        'cevesp_relatorio', 'cevesp_media_semanal', 'cevesp_agrupado',
        'cevesp_gves_disponiveis', 'cevesp_completude_campos',
        'cevesp_completude_gve', 'cevesp_completude_ano', 'cevesp_quality_audit'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn.signature);
  END LOOP;
END;
$$;
