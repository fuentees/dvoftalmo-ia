-- Cache local das notificações CEVESP (sync via script da rede SES-SP)
CREATE TABLE IF NOT EXISTS cevesp_notificacoes (
  id           BIGSERIAL PRIMARY KEY,
  row_key      TEXT UNIQUE NOT NULL,          -- hash determinístico para upsert

  -- Identificação / localização
  "ANO"                   INT,
  "Mes"                   INT,
  "SemEpidemio"           INT,
  "DtNotificacao"         DATE,
  "MunicipioNotificacao"  TEXT,
  "IbgeNotificacao"       TEXT,
  "GVE_NOME"              TEXT,
  "gve_numero"            INT,
  "CodMacroGVE"           TEXT,
  "DRS_NOME"              TEXT,
  "drs_numero"            INT,
  "SUBGRUPOS_VE"          TEXT,
  "Unid_notificacao"      TEXT,
  "nCNES"                 TEXT,
  "UVIS"                  TEXT,
  "Nome_notificante"      TEXT,
  "CargoFuncao"           TEXT,

  -- Contagens principais
  "TotalCaso"             NUMERIC,
  "SexMasc"               NUMERIC,
  "SexFem"                NUMERIC,

  -- Faixas etárias
  "FxMenorUmAno"          NUMERIC,
  "FxUmQuatro"            NUMERIC,
  "FxCincoNove"           NUMERIC,
  "FxDezQuatorze"         NUMERIC,
  "FxQuizeOuMais"         NUMERIC,

  -- Surtos / investigação
  "Surto"                 TEXT,
  "NuSurto"               NUMERIC,

  -- Ações
  "NuColetaMaterialBio"   NUMERIC,
  "ColetaMaterialBio"     TEXT,
  "NuAcaoEducativa"       NUMERIC,
  "NuTreinamento"         NUMERIC,
  "AfastamentoProfSintomatico" TEXT,
  "NuEncamimento"         NUMERIC,
  "MedidaAdotada"         TEXT,

  -- Controle
  "Excluido"              INT DEFAULT 0,
  "editable"              INT DEFAULT 0,

  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cevesp_ano_se   ON cevesp_notificacoes ("ANO", "SemEpidemio");
CREATE INDEX IF NOT EXISTS idx_cevesp_gve      ON cevesp_notificacoes ("GVE_NOME");
CREATE INDEX IF NOT EXISTS idx_cevesp_munic    ON cevesp_notificacoes ("MunicipioNotificacao");
CREATE INDEX IF NOT EXISTS idx_cevesp_dtnotif  ON cevesp_notificacoes ("DtNotificacao");

-- Desabilitar RLS (acesso somente via service role, nunca exposto ao browser)
ALTER TABLE cevesp_notificacoes DISABLE ROW LEVEL SECURITY;

-- Log de sincronizações
CREATE TABLE IF NOT EXISTS cevesp_sync_log (
  id         BIGSERIAL PRIMARY KEY,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ano        INT,
  rows_upserted INT,
  duration_ms   INT,
  mode       TEXT  -- 'full' | 'year' | 'recent'
);

ALTER TABLE cevesp_sync_log DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: agregação genérica (fallback quando MySQL estiver inacessível)
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_where       text := 'WHERE COALESCE("Excluido", 0) = 0';
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

  -- Filtros (todos com %L = safe literal quoting)
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

-- RPC: KPIs agregados para o dashboard (fallback)
CREATE OR REPLACE FUNCTION cevesp_kpis_cache(
  p_ano int DEFAULT NULL,
  p_se  int DEFAULT NULL
) RETURNS TABLE(
  current_cases bigint,
  current_se    int,
  current_ano   int,
  prev_cases    bigint,
  prev_se       int,
  year_cases    bigint,
  prev_year_cases bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ano int := COALESCE(p_ano, EXTRACT(YEAR FROM NOW())::int);
  v_se  int := COALESCE(p_se, (SELECT MAX("SemEpidemio") FROM cevesp_notificacoes WHERE "ANO" = v_ano));
  v_prev_se  int := v_se - 1;
  v_prev_ano int := v_ano - 1;
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COALESCE(SUM("TotalCaso"::numeric),0)::bigint FROM cevesp_notificacoes
     WHERE "ANO" = v_ano AND "SemEpidemio" = v_se AND COALESCE("Excluido",0) = 0) AS current_cases,
    v_se       AS current_se,
    v_ano      AS current_ano,
    (SELECT COALESCE(SUM("TotalCaso"::numeric),0)::bigint FROM cevesp_notificacoes
     WHERE "ANO" = v_ano AND "SemEpidemio" = v_prev_se AND COALESCE("Excluido",0) = 0) AS prev_cases,
    v_prev_se  AS prev_se,
    (SELECT COALESCE(SUM("TotalCaso"::numeric),0)::bigint FROM cevesp_notificacoes
     WHERE "ANO" = v_ano AND COALESCE("Excluido",0) = 0) AS year_cases,
    (SELECT COALESCE(SUM("TotalCaso"::numeric),0)::bigint FROM cevesp_notificacoes
     WHERE "ANO" = v_prev_ano AND COALESCE("Excluido",0) = 0) AS prev_year_cases;
END;
$$;

GRANT EXECUTE ON FUNCTION cevesp_aggregate TO service_role;
GRANT EXECUTE ON FUNCTION cevesp_kpis_cache TO service_role;
