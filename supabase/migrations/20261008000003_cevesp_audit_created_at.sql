-- Auditoria CEVESP por unidade notificadora.
--
-- created_at_origem: data/hora de digitação no MySQL (hora local). A unidade consolida a
-- semana N e notifica na N+1, então essa data indica a semana a que o registro se refere
-- e permite achar semana trocada, semana em branco/futura e ano digitado errado.
ALTER TABLE cevesp_notificacoes
  ADD COLUMN IF NOT EXISTS created_at_origem TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_cevesp_created_origem ON cevesp_notificacoes (created_at_origem);
CREATE INDEX IF NOT EXISTS idx_cevesp_id_mysql       ON cevesp_notificacoes ("ID");

-- RPC antiga sem uso que sugeria sempre a semana atual (semana ISO) para qualquer SE
-- inválida; a auditoria é feita em services/cevesp-corrections.ts.
DROP FUNCTION IF EXISTS cevesp_quality_audit(int, int, int, text);
