-- Backfill classificacao for traconet rows imported before the FORMA_ derivation
-- logic was active. Reads FORMA_TF/TI/TS/TT/CO flags from raw JSONB:
-- '1' = Sim (form present), '2' = Não, '' or NULL = not filled.

UPDATE sinan_tracoma_rows
SET classificacao = (
  WITH forms AS (
    SELECT forma
    FROM (VALUES
      ('TF', raw->>'FORMA_TF'),
      ('TI', raw->>'FORMA_TI'),
      ('TS', raw->>'FORMA_TS'),
      ('TT', raw->>'FORMA_TT'),
      ('CO', raw->>'FORMA_CO')
    ) AS f(forma, valor)
    WHERE valor = '1'
    ORDER BY forma
  )
  SELECT CASE
    WHEN COUNT(*) > 0 THEN string_agg(forma, '+')
    -- all flags answered but none is '1' → no active form
    WHEN (
      SELECT COUNT(*) > 0 FROM (VALUES
        (raw->>'FORMA_TF'), (raw->>'FORMA_TI'), (raw->>'FORMA_TS'),
        (raw->>'FORMA_TT'), (raw->>'FORMA_CO')
      ) AS f(v) WHERE v IN ('2')
    ) THEN 'Sem forma positiva'
    ELSE NULL
  END
  FROM forms
)
WHERE source_bank = 'traconet'
  AND classificacao IS NULL
  AND raw IS NOT NULL;
