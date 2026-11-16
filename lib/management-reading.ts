export type QualityReadout = {
  label: string;
  detail: string;
  tone: "neutral" | "attention";
  nextAction: string;
};

export function qualityReadout(input: {
  state: "pending" | "loading" | "unavailable" | "ready";
  issues?: number;
  affectedRecords?: number;
}): QualityReadout {
  if (input.state === "loading") return {
    label: "Verificando qualidade", detail: "A auditoria ainda está carregando.", tone: "neutral",
    nextAction: "Aguardar a auditoria antes de concluir sobre as pendências."
  };
  if (input.state === "pending") return {
    label: "Auditoria ainda não consultada", detail: "Abra Qualidade dos Dados para conferir as pendências deste recorte.", tone: "neutral",
    nextAction: "Consultar a qualidade dos dados antes de divulgar os indicadores."
  };
  if (input.state === "unavailable" || input.issues == null || !Number.isSafeInteger(input.issues) || input.issues < 0) return {
    label: "Qualidade indisponível", detail: "Não foi possível verificar as pendências. Ausência de resposta não significa ausência de erros.", tone: "attention",
    nextAction: "Restabelecer a consulta de qualidade e conferir a base."
  };
  if (input.issues === 0) return {
    label: "0 pendências retornadas", detail: "Nos critérios automáticos consultados.", tone: "neutral",
    nextAction: "Conferir a cobertura dos dados e acompanhar o próximo período."
  };
  const affected = input.affectedRecords;
  return {
    label: `${input.issues.toLocaleString("pt-BR")} inconsistência(s) detectada(s)`,
    detail: affected != null && Number.isSafeInteger(affected) && affected > 0
      ? `Em ${affected.toLocaleString("pt-BR")} registro(s). Um registro pode ter vários problemas.`
      : "Um registro pode apresentar vários problemas.",
    tone: "attention", nextAction: "Abrir as pendências, localizar os registros e encaminhar a conferência."
  };
}

export function managementScope(input: { yearStart?: string | number; yearEnd?: string | number; gve?: string; municipio?: string }) {
  const start = input.yearStart ? String(input.yearStart) : "";
  const end = input.yearEnd ? String(input.yearEnd) : "";
  const period = start && end ? start === end ? start : `${start} a ${end}`
    : start ? `Desde ${start}` : end ? `Até ${end}` : "Histórico disponível";
  const territory = [input.municipio, input.gve ? `GVE ${input.gve}` : ""].filter(Boolean).join(" · ") || "Estado de São Paulo";
  return `${period} · ${territory}`;
}

/** Incompatible source pairs must not be hidden by otherwise valid aggregate totals. */
export function tracomaCountsNeedReview(rows: ReadonlyArray<{
  examinados: number | null;
  positivos: number | null;
  prevalencia: number | null;
  invalidPairs?: number;
}>) {
  return rows.some((row) => row.examinados == null || row.positivos == null
    || !Number.isSafeInteger(row.examinados) || !Number.isSafeInteger(row.positivos)
    || row.examinados < 0 || row.positivos < 0 || row.positivos > row.examinados
    || (row.invalidPairs ?? 0) > 0
    || (row.prevalencia == null && row.examinados > 0));
}

/** Keep unavailable rates blank in a spreadsheet; never export them as observed zero. */
export function rateForCsv(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || value < 0 ? "" : value.toFixed(2).replace(".", ",");
}
