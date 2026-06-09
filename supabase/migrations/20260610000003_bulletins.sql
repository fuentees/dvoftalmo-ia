-- Weekly epidemiological bulletins generated automatically every Monday.
CREATE TABLE IF NOT EXISTS bulletins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  se         INT  NOT NULL,
  ano        INT  NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (se, ano)
);

ALTER TABLE bulletins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read bulletins"
  ON bulletins FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages bulletins"
  ON bulletins FOR ALL TO service_role USING (true) WITH CHECK (true);
