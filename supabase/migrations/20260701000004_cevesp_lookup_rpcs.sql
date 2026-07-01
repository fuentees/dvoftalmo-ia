-- cevesp_gves_disponiveis: DISTINCT GVEs sem varrer 300k linhas
CREATE OR REPLACE FUNCTION cevesp_gves_disponiveis(p_ano int DEFAULT NULL)
RETURNS TABLE(gve text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT "GVE_NOME" AS gve
  FROM cevesp_notificacoes
  WHERE "GVE_NOME" IS NOT NULL AND TRIM("GVE_NOME") <> ''
    AND COALESCE("Excluido", 0) = 0
    AND (p_ano IS NULL OR "ANO" = p_ano)
  ORDER BY "GVE_NOME";
$$;
GRANT EXECUTE ON FUNCTION cevesp_gves_disponiveis(int) TO service_role;

-- cevesp_completude_campos: contagem de preenchimento por campo em uma única passagem
CREATE OR REPLACE FUNCTION cevesp_completude_campos(
  p_ano int  DEFAULT NULL,
  p_gve text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
SELECT jsonb_build_object(
  'total',                      COUNT(*),
  'ANO',                        COUNT("ANO"),
  'Mes',                        COUNT("Mes"),
  'SemEpidemio',                COUNT("SemEpidemio"),
  'DtNotificacao',              COUNT("DtNotificacao"),
  'MunicipioNotificacao',       COUNT(NULLIF(TRIM(COALESCE("MunicipioNotificacao",'')),'')),
  'IbgeNotificacao',            COUNT(NULLIF(TRIM(COALESCE("IbgeNotificacao",'')),'')),
  'GVE_NOME',                   COUNT(NULLIF(TRIM(COALESCE("GVE_NOME",'')),'')),
  'DRS_NOME',                   COUNT(NULLIF(TRIM(COALESCE("DRS_NOME",'')),'')),
  'SUBGRUPOS_VE',               COUNT(NULLIF(TRIM(COALESCE("SUBGRUPOS_VE",'')),'')),
  'Unid_notificacao',           COUNT(NULLIF(TRIM(COALESCE("Unid_notificacao",'')),'')),
  'UVIS',                       COUNT(NULLIF(TRIM(COALESCE("UVIS",'')),'')),
  'Nome_notificante',           COUNT(NULLIF(TRIM(COALESCE("Nome_notificante",'')),'')),
  'CargoFuncao',                COUNT(NULLIF(TRIM(COALESCE("CargoFuncao",'')),'')),
  'TotalCaso',                  COUNT("TotalCaso"),
  'SexMasc',                    COUNT("SexMasc"),
  'SexFem',                     COUNT("SexFem"),
  'FxMenorUmAno',               COUNT("FxMenorUmAno"),
  'FxUmQuatro',                 COUNT("FxUmQuatro"),
  'FxCincoNove',                COUNT("FxCincoNove"),
  'FxDezQuatorze',              COUNT("FxDezQuatorze"),
  'FxQuizeOuMais',              COUNT("FxQuizeOuMais"),
  'Surto',                      COUNT(NULLIF(TRIM(COALESCE("Surto",'')),'')),
  'NuSurto',                    COUNT("NuSurto"),
  'NuColetaMaterialBio',        COUNT("NuColetaMaterialBio"),
  'ColetaMaterialBio',          COUNT(NULLIF(TRIM(COALESCE("ColetaMaterialBio",'')),'')),
  'NuAcaoEducativa',            COUNT("NuAcaoEducativa"),
  'NuTreinamento',              COUNT("NuTreinamento"),
  'AfastamentoProfSintomatico', COUNT(NULLIF(TRIM(COALESCE("AfastamentoProfSintomatico",'')),'')),
  'NuEncamimento',              COUNT("NuEncamimento"),
  'MedidaAdotada',              COUNT(NULLIF(TRIM(COALESCE("MedidaAdotada",'')),  ''))
)
FROM cevesp_notificacoes
WHERE COALESCE("Excluido", 0) = 0
  AND (p_ano  IS NULL OR p_ano  = 0 OR "ANO"      = p_ano)
  AND (p_gve  IS NULL OR p_gve  = '' OR "GVE_NOME" = p_gve);
$$;
GRANT EXECUTE ON FUNCTION cevesp_completude_campos(int,text) TO service_role;

-- Macro auxiliar: soma de filled para avg_pct
-- (reutilizada em cevesp_completude_gve e cevesp_completude_ano via expressão inline)

-- cevesp_completude_gve: preenchimento médio + campos críticos por GVE
CREATE OR REPLACE FUNCTION cevesp_completude_gve(p_ano int DEFAULT NULL)
RETURNS TABLE(gve text, total_rows bigint, avg_pct int, critical_fields int)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
SELECT
  COALESCE(NULLIF(TRIM(COALESCE("GVE_NOME",'')), ''), 'Não informado') AS gve,
  COUNT(*) AS total_rows,
  ROUND(100.0 * (
      COUNT("ANO") + COUNT("Mes") + COUNT("SemEpidemio") + COUNT("DtNotificacao")
    + COUNT(NULLIF(TRIM(COALESCE("MunicipioNotificacao",'')),  ''))
    + COUNT(NULLIF(TRIM(COALESCE("IbgeNotificacao",'')),       ''))
    + COUNT(NULLIF(TRIM(COALESCE("GVE_NOME",'')),              ''))
    + COUNT(NULLIF(TRIM(COALESCE("DRS_NOME",'')),              ''))
    + COUNT(NULLIF(TRIM(COALESCE("SUBGRUPOS_VE",'')),          ''))
    + COUNT(NULLIF(TRIM(COALESCE("Unid_notificacao",'')),      ''))
    + COUNT(NULLIF(TRIM(COALESCE("UVIS",'')),                  ''))
    + COUNT(NULLIF(TRIM(COALESCE("Nome_notificante",'')),      ''))
    + COUNT(NULLIF(TRIM(COALESCE("CargoFuncao",'')),           ''))
    + COUNT("TotalCaso") + COUNT("SexMasc") + COUNT("SexFem")
    + COUNT("FxMenorUmAno") + COUNT("FxUmQuatro") + COUNT("FxCincoNove")
    + COUNT("FxDezQuatorze") + COUNT("FxQuizeOuMais")
    + COUNT(NULLIF(TRIM(COALESCE("Surto",'')),                  ''))
    + COUNT("NuSurto") + COUNT("NuColetaMaterialBio")
    + COUNT(NULLIF(TRIM(COALESCE("ColetaMaterialBio",'')),      ''))
    + COUNT("NuAcaoEducativa") + COUNT("NuTreinamento")
    + COUNT(NULLIF(TRIM(COALESCE("AfastamentoProfSintomatico",'')), ''))
    + COUNT("NuEncamimento")
    + COUNT(NULLIF(TRIM(COALESCE("MedidaAdotada",'')),          ''))
  ) / (COUNT(*) * 30.0))::int AS avg_pct,
  -- critical_fields: quantos dos 30 campos têm fill < 70 %
  (
    CASE WHEN COUNT("ANO")      * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("Mes")      * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("SemEpidemio") * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("DtNotificacao") * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("MunicipioNotificacao",'')),  '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("IbgeNotificacao",'')),       '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("GVE_NOME",'')),              '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("DRS_NOME",'')),              '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("SUBGRUPOS_VE",'')),          '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("Unid_notificacao",'')),      '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("UVIS",'')),                  '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("Nome_notificante",'')),      '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("CargoFuncao",'')),           '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("TotalCaso")   * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("SexMasc")     * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("SexFem")      * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("FxMenorUmAno") * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("FxUmQuatro")   * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("FxCincoNove")  * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("FxDezQuatorze") * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("FxQuizeOuMais") * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("Surto",'')),          '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("NuSurto")          * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("NuColetaMaterialBio") * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("ColetaMaterialBio",'')), '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("NuAcaoEducativa") * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("NuTreinamento")   * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("AfastamentoProfSintomatico",'')), '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT("NuEncamimento")   * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  + CASE WHEN COUNT(NULLIF(TRIM(COALESCE("MedidaAdotada",'')),  '')) * 100 / NULLIF(COUNT(*),0) < 70 THEN 1 ELSE 0 END
  )::int AS critical_fields
FROM cevesp_notificacoes
WHERE COALESCE("Excluido", 0) = 0
  AND (p_ano IS NULL OR p_ano = 0 OR "ANO" = p_ano)
GROUP BY COALESCE(NULLIF(TRIM(COALESCE("GVE_NOME",'')), ''), 'Não informado')
ORDER BY avg_pct ASC;
$$;
GRANT EXECUTE ON FUNCTION cevesp_completude_gve(int) TO service_role;

-- cevesp_completude_ano: preenchimento médio por ANO
CREATE OR REPLACE FUNCTION cevesp_completude_ano(p_gve text DEFAULT NULL)
RETURNS TABLE(ano int, total_rows bigint, avg_pct int)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
SELECT
  "ANO"::int AS ano,
  COUNT(*) AS total_rows,
  ROUND(100.0 * (
      COUNT("ANO") + COUNT("Mes") + COUNT("SemEpidemio") + COUNT("DtNotificacao")
    + COUNT(NULLIF(TRIM(COALESCE("MunicipioNotificacao",'')),  ''))
    + COUNT(NULLIF(TRIM(COALESCE("IbgeNotificacao",'')),       ''))
    + COUNT(NULLIF(TRIM(COALESCE("GVE_NOME",'')),              ''))
    + COUNT(NULLIF(TRIM(COALESCE("DRS_NOME",'')),              ''))
    + COUNT(NULLIF(TRIM(COALESCE("SUBGRUPOS_VE",'')),          ''))
    + COUNT(NULLIF(TRIM(COALESCE("Unid_notificacao",'')),      ''))
    + COUNT(NULLIF(TRIM(COALESCE("UVIS",'')),                  ''))
    + COUNT(NULLIF(TRIM(COALESCE("Nome_notificante",'')),      ''))
    + COUNT(NULLIF(TRIM(COALESCE("CargoFuncao",'')),           ''))
    + COUNT("TotalCaso") + COUNT("SexMasc") + COUNT("SexFem")
    + COUNT("FxMenorUmAno") + COUNT("FxUmQuatro") + COUNT("FxCincoNove")
    + COUNT("FxDezQuatorze") + COUNT("FxQuizeOuMais")
    + COUNT(NULLIF(TRIM(COALESCE("Surto",'')),                  ''))
    + COUNT("NuSurto") + COUNT("NuColetaMaterialBio")
    + COUNT(NULLIF(TRIM(COALESCE("ColetaMaterialBio",'')),      ''))
    + COUNT("NuAcaoEducativa") + COUNT("NuTreinamento")
    + COUNT(NULLIF(TRIM(COALESCE("AfastamentoProfSintomatico",'')), ''))
    + COUNT("NuEncamimento")
    + COUNT(NULLIF(TRIM(COALESCE("MedidaAdotada",'')),          ''))
  ) / (COUNT(*) * 30.0))::int AS avg_pct
FROM cevesp_notificacoes
WHERE COALESCE("Excluido", 0) = 0
  AND "ANO" IS NOT NULL AND "ANO" > 1900
  AND (p_gve IS NULL OR p_gve = '' OR "GVE_NOME" = p_gve)
GROUP BY "ANO"::int
ORDER BY "ANO"::int;
$$;
GRANT EXECUTE ON FUNCTION cevesp_completude_ano(text) TO service_role;
