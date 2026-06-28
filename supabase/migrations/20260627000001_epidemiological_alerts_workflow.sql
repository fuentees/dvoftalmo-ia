-- Operational workflow for epidemiological alerts.
-- Keeps the legacy acknowledged flag for compatibility while allowing follow-up.
ALTER TABLE epidemiological_alerts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'novo'
    CHECK (status IN ('novo', 'em_investigacao', 'confirmado', 'descartado', 'encerrado')),
  ADD COLUMN IF NOT EXISTS status_note TEXT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE epidemiological_alerts
SET status = CASE WHEN acknowledged THEN 'encerrado' ELSE 'novo' END,
    status_updated_at = COALESCE(status_updated_at, created_at),
    closed_at = CASE WHEN acknowledged THEN COALESCE(closed_at, created_at) ELSE closed_at END
WHERE status IS NULL OR status = 'novo';

CREATE INDEX IF NOT EXISTS epidemiological_alerts_status_idx
  ON epidemiological_alerts (status, created_at DESC);
