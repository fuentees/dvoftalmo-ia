-- Preserve the existing report contract and validate demographic counts before aggregation.
-- cevesp_relatorio: SQL estático, sem SQL dinâmico, sem EXECUTE
-- LANGUAGE sql permite ao PostgreSQL usar índices com os parâmetros reais
CREATE OR REPLACE FUNCTION public.cevesp_relatorio(
  p_ano       int  DEFAULT NULL,
  p_ano_fim   int  DEFAULT NULL,
  p_gve       text DEFAULT NULL,
  p_municipio text DEFAULT NULL,
  p_se_inicio int  DEFAULT NULL,
  p_se_fim    int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
SELECT jsonb_build_object(
  -- Escalares: um único scan da tabela
  'total_notifications',          COUNT(*),
  'total_cases',                  COALESCE(SUM("TotalCaso"::numeric), 0),
  'reporting_municipalities',     COUNT(DISTINCT "MunicipioNotificacao"),
  'outbreak_notifications',       COUNT(*) FILTER (WHERE LOWER(COALESCE("Surto",'')) IN ('1','s','sim','true','x')),
  'outbreak_total',               COALESCE(SUM("NuSurto"::numeric), 0),
  'bio_collection_notifications', COUNT(*) FILTER (WHERE LOWER(COALESCE("ColetaMaterialBio",'')) IN ('1','s','sim','true','x')),
  'bio_collection_total',         COALESCE(SUM("NuColetaMaterialBio"::numeric), 0),
  'educational_actions',          COALESCE(SUM("NuAcaoEducativa"::numeric), 0),
  'trainings',                    COALESCE(SUM("NuTreinamento"::numeric), 0),
  'symptomatic_removal',          COUNT(*) FILTER (WHERE LOWER(COALESCE("AfastamentoProfSintomatico",'')) IN ('1','s','sim','true','x')),
  'specialized_referrals',        COALESCE(SUM("NuEncamimento"::numeric), 0),
  'sex_masc',                     COALESCE(SUM("SexMasc"::numeric), 0),
  'sex_fem',                      COALESCE(SUM("SexFem"::numeric), 0),
  'fx_menor_um',                  COALESCE(SUM("FxMenorUmAno"::numeric), 0),
  'fx_1_4',                       COALESCE(SUM("FxUmQuatro"::numeric), 0),
  'fx_5_9',                       COALESCE(SUM("FxCincoNove"::numeric), 0),
  'fx_10_14',                     COALESCE(SUM("FxDezQuatorze"::numeric), 0),
  'fx_15_mais',                   COALESCE(SUM("FxQuizeOuMais"::numeric), 0),
  -- Per-row validation prevents opposite source errors cancelling in aggregate.
  -- Missing categories stay missing; a missing total cannot validate a profile.
  'sex_invalid_rows', COUNT(*) FILTER (WHERE "TotalCaso" IS NULL OR ("TotalCaso"::text IN ('NaN', 'Infinity', '-Infinity') OR "TotalCaso" < 0 OR "TotalCaso" <> trunc("TotalCaso") OR "TotalCaso" > 9007199254740991)
    OR ("SexMasc"::text IN ('NaN', 'Infinity', '-Infinity') OR "SexMasc" < 0 OR "SexMasc" <> trunc("SexMasc") OR "SexMasc" > 9007199254740991)
    OR ("SexFem"::text IN ('NaN', 'Infinity', '-Infinity') OR "SexFem" < 0 OR "SexFem" <> trunc("SexFem") OR "SexFem" > 9007199254740991)
    OR (COALESCE("SexMasc", 0) + COALESCE("SexFem", 0)) > "TotalCaso"),
  'age_invalid_rows', COUNT(*) FILTER (WHERE "TotalCaso" IS NULL OR ("TotalCaso"::text IN ('NaN', 'Infinity', '-Infinity') OR "TotalCaso" < 0 OR "TotalCaso" <> trunc("TotalCaso") OR "TotalCaso" > 9007199254740991)
    OR ("FxMenorUmAno"::text IN ('NaN', 'Infinity', '-Infinity') OR "FxMenorUmAno" < 0 OR "FxMenorUmAno" <> trunc("FxMenorUmAno") OR "FxMenorUmAno" > 9007199254740991)
    OR ("FxUmQuatro"::text IN ('NaN', 'Infinity', '-Infinity') OR "FxUmQuatro" < 0 OR "FxUmQuatro" <> trunc("FxUmQuatro") OR "FxUmQuatro" > 9007199254740991)
    OR ("FxCincoNove"::text IN ('NaN', 'Infinity', '-Infinity') OR "FxCincoNove" < 0 OR "FxCincoNove" <> trunc("FxCincoNove") OR "FxCincoNove" > 9007199254740991)
    OR ("FxDezQuatorze"::text IN ('NaN', 'Infinity', '-Infinity') OR "FxDezQuatorze" < 0 OR "FxDezQuatorze" <> trunc("FxDezQuatorze") OR "FxDezQuatorze" > 9007199254740991)
    OR ("FxQuizeOuMais"::text IN ('NaN', 'Infinity', '-Infinity') OR "FxQuizeOuMais" < 0 OR "FxQuizeOuMais" <> trunc("FxQuizeOuMais") OR "FxQuizeOuMais" > 9007199254740991)
    OR (COALESCE("FxMenorUmAno", 0) + COALESCE("FxUmQuatro", 0) + COALESCE("FxCincoNove", 0) + COALESCE("FxDezQuatorze", 0) + COALESCE("FxQuizeOuMais", 0)) > "TotalCaso"),
  'weekly_avg',    0,
  'weekly_median', 0,
  'weekly_stddev', 0,

  -- Série semanal
  'weekly_series', (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('ano', "ANO", 'se', "SemEpidemio", 'total', total)
      ORDER BY "ANO", "SemEpidemio"
    ), '[]'::jsonb)
    FROM (
      SELECT "ANO", "SemEpidemio", SUM(COALESCE("TotalCaso"::numeric,0))::bigint total
      FROM public.cevesp_notificacoes
      WHERE COALESCE("Excluido",0) = 0
        AND "SemEpidemio" IS NOT NULL
        AND (p_ano IS NULL OR (p_ano_fim IS NOT NULL AND p_ano_fim > p_ano AND "ANO" BETWEEN p_ano AND p_ano_fim) OR "ANO" = p_ano)
        AND (p_gve IS NULL OR p_gve = '' OR "GVE_NOME" = p_gve)
        AND (p_municipio IS NULL OR p_municipio = '' OR LOWER("MunicipioNotificacao") LIKE LOWER('%'||p_municipio||'%'))
        AND (p_se_inicio IS NULL OR "SemEpidemio" >= p_se_inicio)
        AND (p_se_fim    IS NULL OR "SemEpidemio" <= p_se_fim)
      GROUP BY "ANO", "SemEpidemio"
    ) _
  ),

  -- Top municípios
  'top_municipios', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', municipio, 'total', total) ORDER BY total DESC), '[]'::jsonb)
    FROM (
      SELECT "MunicipioNotificacao" municipio, SUM(COALESCE("TotalCaso"::numeric,0))::bigint total
      FROM public.cevesp_notificacoes
      WHERE COALESCE("Excluido",0) = 0
        AND "MunicipioNotificacao" IS NOT NULL
        AND (p_ano IS NULL OR (p_ano_fim IS NOT NULL AND p_ano_fim > p_ano AND "ANO" BETWEEN p_ano AND p_ano_fim) OR "ANO" = p_ano)
        AND (p_gve IS NULL OR p_gve = '' OR "GVE_NOME" = p_gve)
        AND (p_municipio IS NULL OR p_municipio = '' OR LOWER("MunicipioNotificacao") LIKE LOWER('%'||p_municipio||'%'))
        AND (p_se_inicio IS NULL OR "SemEpidemio" >= p_se_inicio)
        AND (p_se_fim    IS NULL OR "SemEpidemio" <= p_se_fim)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 15
    ) _
  ),

  -- Top GVEs
  'top_gves', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', gve, 'total', total) ORDER BY total DESC), '[]'::jsonb)
    FROM (
      SELECT "GVE_NOME" gve, SUM(COALESCE("TotalCaso"::numeric,0))::bigint total
      FROM public.cevesp_notificacoes
      WHERE COALESCE("Excluido",0) = 0
        AND "GVE_NOME" IS NOT NULL
        AND (p_ano IS NULL OR (p_ano_fim IS NOT NULL AND p_ano_fim > p_ano AND "ANO" BETWEEN p_ano AND p_ano_fim) OR "ANO" = p_ano)
        AND (p_gve IS NULL OR p_gve = '' OR "GVE_NOME" = p_gve)
        AND (p_municipio IS NULL OR p_municipio = '' OR LOWER("MunicipioNotificacao") LIKE LOWER('%'||p_municipio||'%'))
        AND (p_se_inicio IS NULL OR "SemEpidemio" >= p_se_inicio)
        AND (p_se_fim    IS NULL OR "SemEpidemio" <= p_se_fim)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 15
    ) _
  ),

  -- Top unidades
  'top_units', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', unit, 'total', total) ORDER BY total DESC), '[]'::jsonb)
    FROM (
      SELECT "Unid_notificacao" unit, SUM(COALESCE("TotalCaso"::numeric,0))::bigint total
      FROM public.cevesp_notificacoes
      WHERE COALESCE("Excluido",0) = 0
        AND "Unid_notificacao" IS NOT NULL
        AND (p_ano IS NULL OR (p_ano_fim IS NOT NULL AND p_ano_fim > p_ano AND "ANO" BETWEEN p_ano AND p_ano_fim) OR "ANO" = p_ano)
        AND (p_gve IS NULL OR p_gve = '' OR "GVE_NOME" = p_gve)
        AND (p_municipio IS NULL OR p_municipio = '' OR LOWER("MunicipioNotificacao") LIKE LOWER('%'||p_municipio||'%'))
        AND (p_se_inicio IS NULL OR "SemEpidemio" >= p_se_inicio)
        AND (p_se_fim    IS NULL OR "SemEpidemio" <= p_se_fim)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    ) _
  )
)
FROM public.cevesp_notificacoes
WHERE COALESCE("Excluido",0) = 0
  AND (p_ano IS NULL OR (p_ano_fim IS NOT NULL AND p_ano_fim > p_ano AND "ANO" BETWEEN p_ano AND p_ano_fim) OR "ANO" = p_ano)
  AND (p_gve IS NULL OR p_gve = '' OR "GVE_NOME" = p_gve)
  AND (p_municipio IS NULL OR p_municipio = '' OR LOWER("MunicipioNotificacao") LIKE LOWER('%'||p_municipio||'%'))
  AND (p_se_inicio IS NULL OR "SemEpidemio" >= p_se_inicio)
  AND (p_se_fim    IS NULL OR "SemEpidemio" <= p_se_fim)
$$;

REVOKE ALL ON FUNCTION public.cevesp_relatorio(int,int,text,text,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cevesp_relatorio(int,int,text,text,int,int) TO service_role;
COMMENT ON FUNCTION public.cevesp_relatorio(int,int,text,text,int,int) IS 'CEVESP report with per-row demographic validation v1';
