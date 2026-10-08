/** Shared semantics: an initial year alone selects that year; an end alone is an upper bound. */
export function parseCevespFilters(params: URLSearchParams) {
  function integer(key: string, min: number, max: number) {
    const raw = params.get(key)?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Filtro ${key} inválido: informe um inteiro entre ${min} e ${max}.`);
    }
    return value;
  }
  const ano = integer(params.has("yearStart") ? "yearStart" : "ano", 1900, 2100);
  const explicitEnd = integer(params.has("yearEnd") ? "yearEnd" : "anoFim", 1900, 2100);
  const anoFim = explicitEnd ?? ano;
  const seInicio = integer("seInicio", 1, 53);
  const seFim = integer("seFim", 1, 53);
  if (ano != null && anoFim != null && anoFim < ano) throw new Error("O ano final deve ser igual ou posterior ao inicial.");
  if (seInicio != null && seFim != null && seFim < seInicio) throw new Error("A semana final deve ser igual ou posterior à inicial.");
  return { ano, anoFim, seInicio, seFim, gve: params.get("gve")?.trim() || undefined, municipio: params.get("municipio")?.trim() || undefined };
}

export function parseChannelFilters(params: URLSearchParams) {
  const raw = params.get("year");
  const year = raw ? Number(raw) : undefined;
  if (year != null && (!Number.isInteger(year) || year < 1900 || year > 2100)) throw new Error("Ano inválido para o canal endêmico.");
  const grain = params.get("grain") ?? "week";
  if (grain !== "week" && grain !== "month") throw new Error("Granularidade inválida: use week ou month.");
  return { year, grain, gve: params.get("gve")?.trim() || undefined, municipality: params.get("municipality")?.trim() || params.get("municipio")?.trim() || undefined } as const;
}
