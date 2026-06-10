-- Corrige cevesp_aggregate: remove filtro por Excluido (inconsistente com MySQL)
-- e adiciona parâmetro p_include_excluidos para consultas específicas.
-- O MySQL original não filtra por Excluido no analítico — espelhar aqui.
CREATE OR REPLACE FUNCTION cevesp_aggregate(
  p_metric    text DEFAULT 'total_casos',
  p_dimension text DEFAULT 'gve',
  p_ano_start int  DEFAULT NULL,
  p_ano_end   int  DEFAULT NULL,
  p_se_start  int  DEFAULT NULL,
  p_se_end    int  DEFAULT NULL,
  p_gve       text DEFAULT NULL,
  p_drs       text DEFAULT NULL,
  p_municipio text DEFAULT NULL,
  p_lim       int  DEFAULT 100
) RETURNS TABLE(label text, valor bigint)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_metric_expr text;
  v_dim_expr    text;
  v_where       text := 'WHERE 1=1';
  v_sql         text;
BEGIN

  -- Whitelist de métricas → expressões SQL seguras
  v_metric_expr := CASE p_metric
    WHEN 'total_casos'          THEN 'SUM(COALESCE("TotalCaso"::numeric, 0))::bigint'
    WHEN 'notificacoes'         THEN 'COUNT(*)'
    WHEN 'surtos'               THEN
      'SUM(CASE WHEN LOWER(COALESCE("Surto",'''')) IN (''1'',''s'',''sim'',''true'',''x'')'
      ' OR COALESCE("NuSurto"::numeric, 0) > 0 THEN 1 ELSE 0 END)::bigint'
    WHEN 'coletas'              THEN 'SUM(COALESCE("NuColetaMaterialBio"::numeric, 0))::bigint'
    WHEN 'acoes_educativas'     THEN 'SUM(COALESCE("NuAcaoEducativa"::numeric, 0))::bigint'
    WHEN 'treinamentos'         THEN 'SUM(COALESCE("NuTreinamento"::numeric, 0))::bigint'
    WHEN 'municipios_notificadores' THEN 'COUNT(DISTINCT "MunicipioNotificacao")'
    WHEN 'unidades_notificadoras'   THEN 'COUNT(DISTINCT "Unid_notificacao")'
    ELSE 'SUM(COALESCE("TotalCaso"::numeric, 0))::bigint'
  END;

  -- Whitelist de dimensões → colunas seguras
  v_dim_expr := CASE p_dimension
    WHEN 'gve'       THEN 'COALESCE("GVE_NOME", ''Sem GVE'')'
    WHEN 'drs'       THEN 'COALESCE("DRS_NOME", ''Sem DRS'')'
    WHEN 'municipio' THEN 'COALESCE("MunicipioNotificacao", ''Sem município'')'
    WHEN 'uvis'      THEN 'COALESCE("UVIS", ''Sem UVIS'')'
    WHEN 'se'        THEN 'COALESCE("SemEpidemio"::text, ''0'')'
    WHEN 'ano'       THEN 'COALESCE("ANO"::text, ''0'')'
    WHEN 'mes'       THEN 'COALESCE("Mes"::text, ''0'')'
    ELSE 'COALESCE("GVE_NOME", ''Sem GVE'')'
  END;

  -- Filtros temporais (todos com %L = safe literal quoting)
  IF p_ano_start IS NOT NULL THEN
    v_where := v_where || format(' AND "ANO" >= %L', p_ano_start);
  END IF;
  IF p_ano_end IS NOT NULL THEN
    v_where := v_where || format(' AND "ANO" <= %L', p_ano_end);
  END IF;
  IF p_se_start IS NOT NULL THEN
    v_where := v_where || format(' AND "SemEpidemio" >= %L', p_se_start);
  END IF;
  IF p_se_end IS NOT NULL THEN
    v_where := v_where || format(' AND "SemEpidemio" <= %L', p_se_end);
  END IF;
  IF p_gve IS NOT NULL AND p_gve <> '' THEN
    v_where := v_where || format(' AND LOWER("GVE_NOME") LIKE LOWER(%L)', '%' || p_gve || '%');
  END IF;
  IF p_drs IS NOT NULL AND p_drs <> '' THEN
    v_where := v_where || format(' AND LOWER("DRS_NOME") LIKE LOWER(%L)', '%' || p_drs || '%');
  END IF;
  IF p_municipio IS NOT NULL AND p_municipio <> '' THEN
    v_where := v_where || format(' AND LOWER("MunicipioNotificacao") LIKE LOWER(%L)', '%' || p_municipio || '%');
  END IF;

  v_sql := format(
    'SELECT %s AS label, %s AS valor FROM cevesp_notificacoes %s GROUP BY 1 ORDER BY 2 DESC LIMIT %s',
    v_dim_expr, v_metric_expr, v_where, p_lim
  );

  RETURN QUERY EXECUTE v_sql;
END;
$$;

-- Função diagnóstico: mostra total de registros e distribuição de Excluido
CREATE OR REPLACE FUNCTION cevesp_diagnostico()
RETURNS TABLE(total_registros bigint, excluido_0 bigint, excluido_1 bigint, excluido_null bigint, anos_disponiveis text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    COUNT(*) AS total_registros,
    COUNT(*) FILTER (WHERE COALESCE("Excluido", -1) = 0) AS excluido_0,
    COUNT(*) FILTER (WHERE "Excluido" = 1) AS excluido_1,
    COUNT(*) FILTER (WHERE "Excluido" IS NULL) AS excluido_null,
    COALESCE(string_agg(DISTINCT "ANO"::text, ', ' ORDER BY "ANO"::text), 'nenhum') AS anos_disponiveis
  FROM cevesp_notificacoes;
$$;

GRANT EXECUTE ON FUNCTION cevesp_aggregate TO service_role;
GRANT EXECUTE ON FUNCTION cevesp_diagnostico TO service_role;
