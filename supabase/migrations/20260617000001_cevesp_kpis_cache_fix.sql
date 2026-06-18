-- Remove Excluido filter from cevesp_kpis_cache to match cevesp_aggregate behavior.
-- cevesp_aggregate was already fixed in _006; aligning kpis_cache here so all
-- cache-path reads use the same counting logic as the MySQL-direct queries.
CREATE OR REPLACE FUNCTION cevesp_kpis_cache(
  p_ano int DEFAULT NULL,
  p_se  int DEFAULT NULL
) RETURNS TABLE(
  current_cases   bigint,
  current_se      int,
  current_ano     int,
  prev_cases      bigint,
  prev_se         int,
  year_cases      bigint,
  prev_year_cases bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ano      int := COALESCE(p_ano, EXTRACT(YEAR FROM NOW())::int);
  v_se       int := COALESCE(p_se, (SELECT MAX("SemEpidemio") FROM cevesp_notificacoes WHERE "ANO" = v_ano));
  v_prev_se  int := v_se - 1;
  v_prev_ano int := v_ano - 1;
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COALESCE(SUM("TotalCaso"::numeric), 0)::bigint
       FROM cevesp_notificacoes
      WHERE "ANO" = v_ano AND "SemEpidemio" = v_se)         AS current_cases,
    v_se                                                      AS current_se,
    v_ano                                                     AS current_ano,
    (SELECT COALESCE(SUM("TotalCaso"::numeric), 0)::bigint
       FROM cevesp_notificacoes
      WHERE "ANO" = v_ano AND "SemEpidemio" = v_prev_se)    AS prev_cases,
    v_prev_se                                                 AS prev_se,
    (SELECT COALESCE(SUM("TotalCaso"::numeric), 0)::bigint
       FROM cevesp_notificacoes
      WHERE "ANO" = v_ano)                                   AS year_cases,
    (SELECT COALESCE(SUM("TotalCaso"::numeric), 0)::bigint
       FROM cevesp_notificacoes
      WHERE "ANO" = v_prev_ano)                              AS prev_year_cases;
END;
$$;

GRANT EXECUTE ON FUNCTION cevesp_kpis_cache TO service_role;
