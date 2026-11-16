export type DistributionQuality = {
  status: "complete" | "partial" | "unavailable" | "inconsistent" | "unverified";
  informedCases: number;
  totalCases: number;
  invalidRows?: number;
};

export function isCaseCount(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  if (typeof value === "string" && !value.trim()) return false;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0;
}

/** Missing categories do not imply zero; impossible sums cannot define a profile. */
export function distributionQuality(totalCases: number, values: unknown[], invalidRows = 0): DistributionQuality {
  const present = values.filter(value => value != null && value !== "");
  const informedCases = present.reduce<number>((sum, value) => sum + (isCaseCount(value) ? Number(value) : 0), 0);
  const invalid = !isCaseCount(totalCases) || present.some(value => !isCaseCount(value)) || invalidRows > 0 || informedCases > totalCases;
  const status = invalid ? "inconsistent" : informedCases === 0 && totalCases > 0 ? "unavailable" : informedCases < totalCases ? "partial" : "complete";
  return { status, informedCases, totalCases, ...(invalidRows ? { invalidRows } : {}) };
}

/** Aggregate totals cannot prove that errors within individual records did not cancel. */
export function distributionQualityFromAggregate(totalCases: number, values: unknown[], invalidRows?: unknown): DistributionQuality {
  const aggregate = distributionQuality(totalCases, values);
  if (aggregate.status === "inconsistent" || aggregate.status === "unavailable") return aggregate;
  if (!isCaseCount(invalidRows)) return { ...aggregate, status: "unverified" };
  return distributionQuality(totalCases, values, Number(invalidRows));
}

export function distributionWarning(quality: DistributionQuality, label: string): string | undefined {
  if (quality.status === "unverified") return `Distribuição por ${label} indisponível: não foi possível validar as contagens de cada registro nesta consulta. Confira as pendências de qualidade antes de interpretar o perfil.`;
  if (quality.status === "inconsistent") return `Distribuição por ${label} indisponível: as contagens são incompatíveis com o total de casos ou contêm valores inválidos. Confira as pendências na origem.`;
  if (quality.status === "unavailable") return `Distribuição por ${label} indisponível: não há contagens informadas para os casos deste recorte.`;
  if (quality.status === "partial") return `Distribuição por ${label} parcial: ${quality.informedCases.toLocaleString("pt-BR")} de ${quality.totalCases.toLocaleString("pt-BR")} casos têm contagem informada. Percentuais referem-se apenas a esses casos.`;
}
