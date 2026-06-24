-- Backfill tratamento column for traconet rows where it is NULL.
-- ENCAMINHA = '1' means the patient was referred for surgery/treatment.
-- We store a human-readable value so existing keyword checks (cirurg/epila) work.

UPDATE sinan_tracoma_rows
SET tratamento = CASE
  WHEN raw->>'ENCAMINHA' = '1' THEN 'Encaminhado para cirurgia/epilação'
  WHEN raw->>'ENCAMINHA' = '2' THEN 'Não encaminhado'
  WHEN raw->>'ENCAMINHA' = '9' THEN 'Ignorado'
  ELSE NULL
END
WHERE source_bank = 'traconet'
  AND tratamento IS NULL
  AND raw IS NOT NULL
  AND raw->>'ENCAMINHA' IS NOT NULL;

