-- Aggregate tracoma history by year on the DB side to avoid row-limit issues
-- when pulling individual rows (table can have 200k+ rows from older years).

CREATE OR REPLACE FUNCTION nottraconet_history_by_year()
RETURNS TABLE(ano int, munis bigint, exam bigint, pos bigint, trat bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    s.ano::int,
    COUNT(DISTINCT s.municipio)::bigint AS munis,
    SUM(COALESCE(
      CASE WHEN s.raw->>'NU_CASOEXA' ~ '^\d+(\.\d+)?$' THEN (s.raw->>'NU_CASOEXA')::numeric END,
      CASE WHEN s.raw->>'CASOEXA'    ~ '^\d+(\.\d+)?$' THEN (s.raw->>'CASOEXA')::numeric    END,
      CASE WHEN s.raw->>'EXAMINADOS' ~ '^\d+(\.\d+)?$' THEN (s.raw->>'EXAMINADOS')::numeric  END,
      CASE WHEN s.raw->>'NU_ALUNOS'  ~ '^\d+(\.\d+)?$' THEN (s.raw->>'NU_ALUNOS')::numeric   END,
      0
    ))::bigint AS exam,
    SUM(COALESCE(
      CASE WHEN s.raw->>'NU_CASOPOS' ~ '^\d+(\.\d+)?$' THEN (s.raw->>'NU_CASOPOS')::numeric END,
      CASE WHEN s.raw->>'CASOPOS'    ~ '^\d+(\.\d+)?$' THEN (s.raw->>'CASOPOS')::numeric    END,
      CASE WHEN s.raw->>'POSITIVOS'  ~ '^\d+(\.\d+)?$' THEN (s.raw->>'POSITIVOS')::numeric   END,
      0
    ))::bigint AS pos,
    SUM(COALESCE(
      CASE WHEN s.raw->>'NU_TRATAD'  ~ '^\d+(\.\d+)?$' THEN (s.raw->>'NU_TRATAD')::numeric  END,
      CASE WHEN s.raw->>'TRATADOS'   ~ '^\d+(\.\d+)?$' THEN (s.raw->>'TRATADOS')::numeric    END,
      0
    ))::bigint AS trat
  FROM sinan_tracoma_rows s
  WHERE s.source_bank = 'nottraconet'
    AND s.ano IS NOT NULL
    AND s.ano >= 1990
  GROUP BY s.ano
  ORDER BY s.ano
$$;

CREATE OR REPLACE FUNCTION traconet_history_by_year()
RETURNS TABLE(ano int, total bigint, tt bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    s.ano::int,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN UPPER(COALESCE(s.classificacao, '')) LIKE '%TT%' THEN 1 ELSE 0 END)::bigint AS tt
  FROM sinan_tracoma_rows s
  WHERE s.source_bank = 'traconet'
    AND s.ano IS NOT NULL
    AND s.ano >= 1990
  GROUP BY s.ano
  ORDER BY s.ano
$$;

GRANT EXECUTE ON FUNCTION nottraconet_history_by_year() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION traconet_history_by_year()    TO authenticated, anon, service_role;
