-- RPC: anos disponíveis no cache — index-only scan em idx_cevesp_ano_se
CREATE OR REPLACE FUNCTION cevesp_anos_disponiveis()
RETURNS TABLE(ano int)
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT DISTINCT "ANO"
  FROM   cevesp_notificacoes
  WHERE  "ANO" IS NOT NULL
  ORDER  BY "ANO" DESC;
$$;

GRANT EXECUTE ON FUNCTION cevesp_anos_disponiveis() TO service_role;

-- RPC: status resumido do cache — evita buscar todas as linhas em JS
CREATE OR REPLACE FUNCTION cevesp_status_resumo()
RETURNS TABLE(
  total_rows    bigint,
  total_cases   numeric,
  min_ano       int,
  max_ano       int,
  anos          int[],
  municipios    bigint,
  gves          bigint,
  last_date     date
)
LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT
    COUNT(*)                                                              AS total_rows,
    COALESCE(SUM("TotalCaso"::numeric), 0)                               AS total_cases,
    MIN("ANO")                                                            AS min_ano,
    MAX("ANO")                                                            AS max_ano,
    ARRAY(
      SELECT DISTINCT "ANO"
      FROM   cevesp_notificacoes
      WHERE  "ANO" IS NOT NULL
      ORDER  BY "ANO"
    )                                                                     AS anos,
    COUNT(DISTINCT "MunicipioNotificacao")                                AS municipios,
    COUNT(DISTINCT "GVE_NOME")                                            AS gves,
    MAX("DtNotificacao")                                                  AS last_date
  FROM cevesp_notificacoes
  WHERE COALESCE("Excluido", 0) = 0;
$$;

GRANT EXECUTE ON FUNCTION cevesp_status_resumo() TO service_role;
