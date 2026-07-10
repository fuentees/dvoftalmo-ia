-- cevesp_kpis_cache retornava outbreaksCurrentYear/collectionsCurrentYear
-- sempre como 0 no path de cache (services/cevesp-kpis.ts), pois a RPC nunca
-- calculava surtos/coletas. Adiciona year_outbreaks e year_collections,
-- usando a mesma regra de "surto" já usada em cevesp_aggregate (p_metric='surtos').
-- Postgres nao permite CREATE OR REPLACE mudar o RETURNS TABLE (novas colunas),
-- entao a funcao precisa ser dropada primeiro.
DROP FUNCTION IF EXISTS cevesp_kpis_cache(int, int);

CREATE FUNCTION cevesp_kpis_cache(
  p_ano int DEFAULT NULL,
  p_se  int DEFAULT NULL
) RETURNS TABLE(
  current_cases    bigint,
  current_se       int,
  current_ano      int,
  prev_cases       bigint,
  prev_se          int,
  year_cases       bigint,
  prev_year_cases  bigint,
  year_outbreaks   bigint,
  year_collections bigint
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
      WHERE "ANO" = v_prev_ano)                              AS prev_year_cases,
    (SELECT COALESCE(SUM(CASE
              WHEN LOWER(COALESCE("Surto", '')) IN ('1','s','sim','true','x')
                OR COALESCE("NuSurto"::numeric, 0) > 0 THEN 1 ELSE 0 END), 0)::bigint
       FROM cevesp_notificacoes
      WHERE "ANO" = v_ano)                                   AS year_outbreaks,
    (SELECT COALESCE(SUM(COALESCE("NuColetaMaterialBio"::numeric, 0)), 0)::bigint
       FROM cevesp_notificacoes
      WHERE "ANO" = v_ano)                                   AS year_collections;
END;
$$;

GRANT EXECUTE ON FUNCTION cevesp_kpis_cache TO service_role;
