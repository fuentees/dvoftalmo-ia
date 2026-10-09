-- Marca no cache os registros com ANO suspeito em relação à data de digitação, para a
-- auditoria buscar só esses entre os digitados no ano filtrado. Sem isso, filtrar 2025
-- trazia a carga em lote de 16/04/2025 (anos de 2007 a 2023 inteiros) como se fosse 2025.
--
-- Mesma regra de lib/cevesp-clean.ts (CEVESP_YEAR_WHERE) e lib/cevesp-audit.ts:
--   ANO vazio; ANO depois do ano de digitação; ou ANO antigo com dia/mês da notificação
--   até 14 dias antes da digitação (erro de digitação do ano).
-- Coluna gerada: o Postgres calcula para as linhas existentes e para cada importação.
ALTER TABLE cevesp_notificacoes
  ADD COLUMN IF NOT EXISTS ano_suspeito BOOLEAN GENERATED ALWAYS AS (
    created_at_origem IS NOT NULL AND (
      "ANO" IS NULL
      OR "ANO" > EXTRACT(YEAR FROM created_at_origem)
      OR (
        "ANO" < EXTRACT(YEAR FROM created_at_origem) - 1
        AND (
          "DtNotificacao" IS NULL
          OR (created_at_origem::date
              - ("DtNotificacao" + make_interval(years => (EXTRACT(YEAR FROM created_at_origem) - EXTRACT(YEAR FROM "DtNotificacao"))::int))::date
             ) BETWEEN 0 AND 14
        )
      )
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_cevesp_ano_suspeito
  ON cevesp_notificacoes (created_at_origem) WHERE ano_suspeito;
