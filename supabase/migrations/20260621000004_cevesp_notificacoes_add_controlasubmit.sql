ALTER TABLE cevesp_notificacoes
  ADD COLUMN IF NOT EXISTS "ID"             TEXT,
  ADD COLUMN IF NOT EXISTS "ControlaSubmit" TEXT;
