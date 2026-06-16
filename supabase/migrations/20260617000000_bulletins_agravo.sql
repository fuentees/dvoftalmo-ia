-- Add disease type (agravo) to bulletins so conjunctivitis and trachoma
-- bulletins can coexist, each with their own (se, ano, agravo) identity.
-- Trachoma bulletins use se = 0 to represent an annual (non-SE) bulletin.

ALTER TABLE bulletins
  ADD COLUMN IF NOT EXISTS agravo TEXT NOT NULL DEFAULT 'conjuntivite'
    CHECK (agravo IN ('conjuntivite', 'tracoma'));

-- Replace the old unique constraint (se, ano) with the new three-column one.
ALTER TABLE bulletins DROP CONSTRAINT IF EXISTS bulletins_se_ano_key;
ALTER TABLE bulletins ADD CONSTRAINT bulletins_se_ano_agravo_key UNIQUE (se, ano, agravo);
