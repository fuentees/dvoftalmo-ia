-- cevesp_agrupado: agrega TotalCaso no banco por grain temporal e dimensão opcional.
-- Retorna ~240 linhas (anos × meses) em vez de 300k linhas brutas, evitando
-- o timeout do Vercel causado por 300+ requisições de paginação.
CREATE OR REPLACE FUNCTION cevesp_agrupado(
  p_grain      text    DEFAULT 'month',   -- 'month' | 'year' | 'week'
  p_metric     text    DEFAULT 'total_casos',
  p_dim        text    DEFAULT NULL,      -- 'gve' | 'drs' | 'municipio' | 'uvis' | NULL
  p_ano_start  int     DEFAULT NULL,
  p_ano_end    int     DEFAULT NULL,
  p_gve        text    DEFAULT NULL,
  p_municipio  text    DEFAULT NULL,
  p_se_start   int     DEFAULT NULL,
  p_se_end     int     DEFAULT NULL
)
RETURNS TABLE(ano int, mes int, se int, dim_value text, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    "ANO"::int AS ano,
    CASE WHEN p_grain = 'month' THEN "Mes"::int          ELSE NULL END AS mes,
    CASE WHEN p_grain = 'week'  THEN "SemEpidemio"::int  ELSE NULL END AS se,
    CASE
      WHEN p_dim = 'gve'       THEN "GVE_NOME"
      WHEN p_dim = 'drs'       THEN "DRS_NOME"
      WHEN p_dim = 'municipio' THEN "MunicipioNotificacao"
      WHEN p_dim = 'uvis'      THEN "UVIS"
      ELSE NULL
    END AS dim_value,
    CASE
      WHEN p_metric = 'municipios_notificadores' THEN COUNT(DISTINCT "MunicipioNotificacao")::bigint
      WHEN p_metric = 'unidades_notificadoras'   THEN COUNT(DISTINCT "Unid_notificacao")::bigint
      ELSE SUM(
        CASE p_metric
          WHEN 'total_casos'       THEN COALESCE("TotalCaso"::numeric, 0)
          WHEN 'notificacoes'      THEN 1
          WHEN 'surtos'            THEN CASE WHEN LOWER(COALESCE("Surto",'')) IN ('1','s','sim','true','x') OR COALESCE("NuSurto"::numeric,0)>0 THEN 1 ELSE 0 END
          WHEN 'coletas'           THEN COALESCE("NuColetaMaterialBio"::numeric, 0)
          WHEN 'acoes_educativas'  THEN COALESCE("NuAcaoEducativa"::numeric, 0)
          WHEN 'treinamentos'      THEN COALESCE("NuTreinamento"::numeric, 0)
          WHEN 'afastamentos'      THEN CASE WHEN LOWER(COALESCE("AfastamentoProfSintomatico",'')) IN ('1','s','sim','true','x') THEN 1 ELSE 0 END
          WHEN 'encaminhamentos'   THEN COALESCE("NuEncamimento"::numeric, 0)
          ELSE COALESCE("TotalCaso"::numeric, 0)
        END
      )::bigint
    END AS total
  FROM cevesp_notificacoes
  WHERE COALESCE("Excluido", 0) = 0
    AND "ANO" IS NOT NULL AND "ANO" > 1900
    AND (p_ano_start IS NULL OR "ANO" >= p_ano_start)
    AND (p_ano_end   IS NULL OR "ANO" <= p_ano_end)
    AND (p_gve       IS NULL OR p_gve       = '' OR "GVE_NOME"              ILIKE '%' || p_gve       || '%')
    AND (p_municipio IS NULL OR p_municipio = '' OR "MunicipioNotificacao"  ILIKE '%' || p_municipio || '%')
    AND (p_se_start  IS NULL OR "SemEpidemio" >= p_se_start)
    AND (p_se_end    IS NULL OR "SemEpidemio" <= p_se_end)
    AND (p_grain <> 'month' OR ("Mes" >= 1 AND "Mes" <= 12))
    AND (p_grain <> 'week'  OR ("SemEpidemio" >= 1 AND "SemEpidemio" <= 53))
  GROUP BY
    "ANO"::int,
    CASE WHEN p_grain = 'month' THEN "Mes"::int         ELSE NULL END,
    CASE WHEN p_grain = 'week'  THEN "SemEpidemio"::int ELSE NULL END,
    CASE
      WHEN p_dim = 'gve'       THEN "GVE_NOME"
      WHEN p_dim = 'drs'       THEN "DRS_NOME"
      WHEN p_dim = 'municipio' THEN "MunicipioNotificacao"
      WHEN p_dim = 'uvis'      THEN "UVIS"
      ELSE NULL
    END
  ORDER BY
    "ANO"::int,
    CASE WHEN p_grain = 'month' THEN "Mes"::int         ELSE NULL END,
    CASE WHEN p_grain = 'week'  THEN "SemEpidemio"::int ELSE NULL END,
    total DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION cevesp_agrupado(text,text,text,int,int,text,text,int,int) TO service_role;
