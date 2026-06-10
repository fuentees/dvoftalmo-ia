-- Preserva o valor original de datas inválidas para auditoria de qualidade
ALTER TABLE cevesp_notificacoes
  ADD COLUMN IF NOT EXISTS dt_notificacao_raw TEXT;

CREATE INDEX IF NOT EXISTS idx_cevesp_dt_raw
  ON cevesp_notificacoes (dt_notificacao_raw)
  WHERE dt_notificacao_raw IS NOT NULL;

-- RPC: relatório de qualidade de dados para o agente
CREATE OR REPLACE FUNCTION cevesp_qualidade_dados()
RETURNS TABLE(
  tipo_problema  text,
  campo          text,
  valor_original text,
  quantidade     bigint,
  exemplo_gve    text,
  exemplo_unidade text
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    'data_invalida'       AS tipo_problema,
    'DtNotificacao'       AS campo,
    dt_notificacao_raw    AS valor_original,
    COUNT(*)              AS quantidade,
    MAX("GVE_NOME")       AS exemplo_gve,
    MAX("Unid_notificacao") AS exemplo_unidade
  FROM cevesp_notificacoes
  WHERE dt_notificacao_raw IS NOT NULL
  GROUP BY dt_notificacao_raw
  ORDER BY COUNT(*) DESC
$$;

GRANT EXECUTE ON FUNCTION cevesp_qualidade_dados TO service_role;
