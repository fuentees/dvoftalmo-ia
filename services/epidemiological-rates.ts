export function incidencePer100k(cases: number, population: number) {
  if (!population || population <= 0) return null;
  return Number(((cases / population) * 100_000).toFixed(2));
}

export function detectionRatePer100k(cases: number, population: number) {
  return incidencePer100k(cases, population);
}

export function prevalencePercent(positive: number, examined: number) {
  if (!examined || examined <= 0) return null;
  return Number(((positive / examined) * 100).toFixed(2));
}

export function examCoveragePercent(examined: number, population: number) {
  if (!population || population <= 0) return null;
  return Number(((examined / population) * 100).toFixed(2));
}
