-- Add unique constraint required for the weekly cron upsert to resolve conflicts.
-- Without this, INSERT ON CONFLICT (se_epidemiologica, ano, gve) throws in PostgreSQL
-- because there is no unique or exclusion constraint matching the specification.
ALTER TABLE epidemiological_alerts
  ADD CONSTRAINT epidemiological_alerts_se_ano_gve_key
  UNIQUE (se_epidemiologica, ano, gve);
