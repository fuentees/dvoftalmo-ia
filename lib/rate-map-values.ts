type TerritoryRow = {
  codigoIbge?: string | null;
  municipio?: string;
  gve?: string;
};

function normalizeKey(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function buildShapeValueMap<T extends TerritoryRow>(rows: T[], valueKey: keyof T) {
  const valueMap: Record<string, number> = {};
  for (const row of rows) {
    const raw = row[valueKey];
    if (raw == null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    const code = String(row.codigoIbge ?? "").replace(/\D/g, "");
    if (code) { valueMap[code] = value; valueMap[code.slice(0, 6)] = value; }
    // Municipal values must not leak through the GVE fallback of other shapes.
    const name = row.municipio || (!code ? row.gve : undefined);
    if (name) { valueMap[name] = value; valueMap[normalizeKey(name)] = value; }
  }
  return valueMap;
}
