CREATE OR REPLACE FUNCTION cevesp_quality_audit(
  p_limit int DEFAULT NULL,
  p_ano_start int DEFAULT NULL,
  p_ano_end int DEFAULT NULL,
  p_gve text DEFAULT NULL
)
RETURNS TABLE(
  record_id text,
  pk_column text,
  controla_submit text,
  dt_notificacao text,
  sem_epidemio numeric,
  municipio text,
  gve text,
  ano numeric,
  total_caso numeric,
  issue text,
  issue_type text,
  suggested_field text,
  suggested_value text
)
LANGUAGE sql SECURITY DEFINER AS $$
WITH params AS (
  SELECT
    EXTRACT(YEAR FROM CURRENT_DATE)::int AS current_year,
    LEAST(EXTRACT(WEEK FROM CURRENT_DATE)::int, 53) AS current_se
),
base AS (
  SELECT
    COALESCE(n."ID"::text, n.id::text, n.row_key) AS record_id,
    n."ControlaSubmit"::text AS controla_submit,
    n."DtNotificacao" AS dt_notificacao_date,
    COALESCE(n."DtNotificacao"::text, n.dt_notificacao_raw) AS dt_notificacao,
    n."SemEpidemio"::numeric AS sem_epidemio,
    n."MunicipioNotificacao" AS municipio,
    n."GVE_NOME" AS gve,
    n."ANO"::numeric AS ano,
    n."TotalCaso"::numeric AS total_caso,
    n.dt_notificacao_raw,
    COALESCE(n."FxMenorUmAno", 0)::numeric
      + COALESCE(n."FxUmQuatro", 0)::numeric
      + COALESCE(n."FxCincoNove", 0)::numeric
      + COALESCE(n."FxDezQuatorze", 0)::numeric
      + COALESCE(n."FxQuizeOuMais", 0)::numeric AS total_faixa,
    COALESCE(n."SexMasc", 0)::numeric + COALESCE(n."SexFem", 0)::numeric AS total_sexo
  FROM cevesp_notificacoes n
  WHERE (p_ano_start IS NULL OR n."ANO" >= p_ano_start)
    AND (p_ano_end IS NULL OR n."ANO" <= p_ano_end)
    AND (p_gve IS NULL OR n."GVE_NOME" = p_gve)
),
classified AS (
  SELECT
    b.*,
    CASE
      WHEN b.dt_notificacao_raw IS NOT NULL AND b.dt_notificacao_date IS NULL THEN 'dia_impossivel'
      WHEN b.dt_notificacao_date > CURRENT_DATE THEN 'data_futura'
      WHEN b.dt_notificacao_date IS NOT NULL AND EXTRACT(YEAR FROM b.dt_notificacao_date) < 1990 THEN 'ano_impossivel'
      WHEN b.sem_epidemio > 53 THEN 'se_alta'
      WHEN b.sem_epidemio < 1 THEN 'se_baixa'
      WHEN b.dt_notificacao_date IS NOT NULL
        AND EXTRACT(YEAR FROM b.dt_notificacao_date) = (SELECT current_year FROM params)
        AND b.sem_epidemio > (SELECT current_se FROM params) THEN 'se_futura'
      WHEN b.municipio IS NULL OR BTRIM(b.municipio) = '' THEN 'municipio_ausente'
      WHEN b.gve IS NULL OR BTRIM(b.gve) = '' THEN 'gve_ausente'
      WHEN b.total_caso IS NULL THEN 'sem_casos'
      WHEN b.total_caso < 0 THEN 'casos_negativos'
      WHEN b.total_caso = 0 AND b.total_faixa > 0 THEN 'faixa_etaria_divergente'
      WHEN b.total_caso = 0 AND b.total_sexo > 0 THEN 'sexo_divergente'
      WHEN b.total_caso > 0 AND b.total_faixa = 0 THEN 'faixa_etaria_ausente'
      WHEN b.total_caso > 0 AND b.total_sexo <> b.total_caso THEN 'sexo_divergente'
      ELSE NULL
    END AS problema
  FROM base b
)
SELECT
  c.record_id,
  'ID'::text AS pk_column,
  c.controla_submit,
  c.dt_notificacao,
  c.sem_epidemio,
  c.municipio,
  c.gve,
  c.ano,
  c.total_caso,
  CASE
    WHEN c.problema = 'dia_impossivel' THEN 'Data inválida: ' || COALESCE(c.dt_notificacao_raw, c.dt_notificacao)
    WHEN c.problema = 'data_futura' THEN 'Data futura: ' || c.dt_notificacao
    WHEN c.problema = 'ano_impossivel' THEN 'Ano impossível: ' || EXTRACT(YEAR FROM c.dt_notificacao_date)::text
    WHEN c.problema IN ('se_alta', 'se_baixa') THEN 'SE inválida: ' || c.sem_epidemio::text
    WHEN c.problema = 'se_futura' THEN 'SE futura: ' || c.sem_epidemio::text || ' (SE atual: ' || (SELECT current_se FROM params)::text || ')'
    WHEN c.problema = 'municipio_ausente' THEN 'Município ausente'
    WHEN c.problema = 'gve_ausente' THEN 'GVE ausente'
    WHEN c.problema = 'sem_casos' THEN 'TotalCaso não informado'
    WHEN c.problema = 'casos_negativos' THEN 'Total de casos negativo: ' || c.total_caso::text
    WHEN c.problema = 'faixa_etaria_divergente' THEN 'Faixa etaria diverge: soma das faixas=' || c.total_faixa::text || ' com TotalCaso=0'
    WHEN c.problema = 'faixa_etaria_ausente' THEN 'Faixa etária ausente: TotalCaso=' || c.total_caso::text || ' sem distribuição por faixa'
    WHEN c.problema = 'sexo_divergente' THEN 'Sexo diverge: Masc+Fem=' || c.total_sexo::text || ' ≠ TotalCaso=' || c.total_caso::text
    ELSE c.problema
  END AS issue,
  CASE
    WHEN c.problema IN ('dia_impossivel', 'data_futura', 'ano_impossivel', 'se_alta', 'se_baixa', 'se_futura') THEN 'data_tempo'
    ELSE 'conteudo'
  END AS issue_type,
  CASE
    WHEN c.problema IN ('dia_impossivel', 'data_futura', 'ano_impossivel') THEN 'DtNotificacao'
    WHEN c.problema IN ('se_alta', 'se_baixa', 'se_futura') THEN 'SemEpidemio'
    WHEN c.problema = 'casos_negativos' THEN 'TotalCaso'
    ELSE ''
  END AS suggested_field,
  CASE
    WHEN c.problema IN ('se_alta', 'se_baixa', 'se_futura') THEN (SELECT current_se FROM params)::text
    WHEN c.problema = 'casos_negativos' THEN '0'
    ELSE ''
  END AS suggested_value
FROM classified c
WHERE c.problema IS NOT NULL
ORDER BY
  CASE
    WHEN c.problema IN ('dia_impossivel', 'ano_impossivel', 'data_futura', 'se_alta', 'se_baixa', 'se_futura') THEN 0
    WHEN c.problema IN ('municipio_ausente', 'gve_ausente', 'casos_negativos') THEN 1
    ELSE 2
  END,
  c.ano DESC NULLS LAST,
  c.gve NULLS LAST,
  c.municipio NULLS LAST
LIMIT COALESCE(p_limit, 2147483647);
$$;

GRANT EXECUTE ON FUNCTION cevesp_quality_audit(int, int, int, text) TO service_role;
