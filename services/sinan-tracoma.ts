import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type SinanTracomaBank = "traconet" | "nottraconet";

type RawRow = Record<string, unknown>;

type NormalizedSinanRow = {
  row_key: string;
  source_bank: SinanTracomaBank;
  agravo: string | null;
  ano: number | null;
  dt_notificacao: string | null;
  municipio: string | null;
  ibge: string | null;
  gve: string | null;
  drs: string | null;
  unidade: string | null;
  classificacao: string | null;
  criterio: string | null;
  evolucao: string | null;
  tratamento: string | null;
  conclusao: string | null;
  raw: RawRow;
};

const fieldCandidates = {
  agravo: ["ID_AGRAVO", "AGRAVO", "NM_AGRAVO", "NOME_AGRAVO", "COD_AGRAVO"],
  ano: ["ANO", "NU_ANO", "ANO_NOT", "ANO_NOTIFIC", "DT_NOTIFIC"],
  date: ["DT_NOTIFIC", "DT_NOTIFICACAO", "DT_NOT", "DT_SIN_PRI", "DT_DIAG"],
  municipio: ["ID_MUNICIP", "MUNICIPIO", "NM_MUNICIP", "MUN_NOT", "MUNICIPIO_NOTIFICACAO", "ID_MN_RESI", "MUN_RES"],
  ibge: ["CO_MUNICIP", "IBGE", "ID_MUNICIP", "ID_MN_RESI"],
  gve: ["GVE", "GVE_NOME", "NM_GVE", "REGIONAL", "REG_SAUDE"],
  drs: ["DRS", "DRS_NOME", "NM_DRS"],
  unidade: ["ID_UNIDADE", "UNIDADE", "NM_UNIDADE", "CNES", "ID_CNES"],
  classificacao: ["CLASSI_FIN", "CLASSIFICACAO", "CLASSIFIN", "CRITERIO_CONF"],
  criterio: ["CRITERIO", "CRITERIO_CONF", "TP_CRITERIO"],
  evolucao: ["EVOLUCAO", "EVOL_CASO", "TP_EVOLUCAO"],
  tratamento: ["TRATAMENTO", "TRAT", "ID_TRATAM", "ANTIBIOTIC", "AZITROMIC", "MEDICAMENTO", "DOSE", "DT_TRAT"],
  conclusao: ["CONCLUSAO", "DT_CONCLUSAO", "SIT_CONCLU", "CLASSI_FIN", "CLASSIFICACAO"]
};

function getValue(row: RawRow, candidates: string[]) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const key = keys.find((item) => item.toLowerCase() === candidate.toLowerCase());
    if (key && row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return null;
}

function toStringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function toNumberOrNull(value: unknown) {
  if (value == null) return null;
  const match = String(value).match(/\d{4}/);
  if (match) return Number(match[0]);
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  const br = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  const parts = iso ? [iso[1], iso[2], iso[3]] : br ? [br[3], br[2], br[1]] : null;
  if (!parts) return null;
  const [y, m, d] = parts.map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function rowKey(row: RawRow, bank: SinanTracomaBank) {
  const seed = [
    bank,
    getValue(row, ["NU_NOTIFIC", "ID", "ID_NOTIFIC", "NUM_NOTIFIC"]) ?? "",
    getValue(row, fieldCandidates.date) ?? "",
    getValue(row, fieldCandidates.municipio) ?? "",
    JSON.stringify(row).slice(0, 500)
  ].join("|");
  return createHash("sha256").update(seed).digest("hex");
}

export function normalizeSinanTracomaRow(row: RawRow, bank: SinanTracomaBank): NormalizedSinanRow {
  const date = normalizeDate(getValue(row, fieldCandidates.date));
  const ano = toNumberOrNull(getValue(row, fieldCandidates.ano)) ?? (date ? Number(date.slice(0, 4)) : null);

  return {
    row_key: rowKey(row, bank),
    source_bank: bank,
    agravo: toStringOrNull(getValue(row, fieldCandidates.agravo)),
    ano,
    dt_notificacao: date,
    municipio: toStringOrNull(getValue(row, fieldCandidates.municipio)),
    ibge: toStringOrNull(getValue(row, fieldCandidates.ibge)),
    gve: toStringOrNull(getValue(row, fieldCandidates.gve)),
    drs: toStringOrNull(getValue(row, fieldCandidates.drs)),
    unidade: toStringOrNull(getValue(row, fieldCandidates.unidade)),
    classificacao: toStringOrNull(getValue(row, fieldCandidates.classificacao)),
    criterio: toStringOrNull(getValue(row, fieldCandidates.criterio)),
    evolucao: toStringOrNull(getValue(row, fieldCandidates.evolucao)),
    tratamento: toStringOrNull(getValue(row, fieldCandidates.tratamento)),
    conclusao: toStringOrNull(getValue(row, fieldCandidates.conclusao)),
    raw: row
  };
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseQuestion(question: string) {
  const lower = normalizeText(question);
  const bank: SinanTracomaBank | undefined =
    /nottraconet|nottraconect|casos?|individual|notificacao/.test(lower) ? "nottraconet" :
    /traconet|consolidado|consolidada/.test(lower) ? "traconet" :
    undefined;
  const metric =
    /municipios?/.test(lower) && /quantos|total|numero/.test(lower) ? "municipios" :
    /gve/.test(lower) ? "gve" :
    /drs/.test(lower) ? "drs" :
    "registros";
  const dimension =
    /\bpor\s+ano\b|ano a ano|anual/.test(lower) ? "ano" :
    /\bpor\s+municipio\b|municipios? com|ranking de municipios?/.test(lower) ? "municipio" :
    /\bpor\s+gve\b|\bgve\b/.test(lower) ? "gve" :
    /\bpor\s+drs\b|\bdrs\b/.test(lower) ? "drs" :
    bank ? "ano" : "source_bank";
  const yearBetween = lower.match(/\b(?:de|entre)\s+(20\d{2}|19\d{2})\s+(?:a|ate|e)\s+(20\d{2}|19\d{2})\b/);
  const singleYear = lower.match(/\b(?:em|no|ano de|ano)\s+(20\d{2}|19\d{2})\b/) ?? lower.match(/\b(20\d{2}|19\d{2})\b/);
  const municipio = lower.match(/(?:municipio|munic)\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:em|no|na|por|de|entre|ano|anos)\b|$)/)?.[1]?.trim();
  const agravo = lower.match(/agravo\s+(?:de\s+)?([a-z0-9\s]+?)(?=\s+(?:em|no|na|por|de|entre|ano|anos|banco)\b|$)/)?.[1]?.trim()
    ?? (lower.includes("tracoma") ? "tracoma" : undefined);

  return {
    bank,
    metric,
    dimension,
    yearStart: yearBetween ? Number(yearBetween[1]) : singleYear ? Number(singleYear[1]) : undefined,
    yearEnd: yearBetween ? Number(yearBetween[2]) : singleYear ? Number(singleYear[1]) : undefined,
    municipio,
    agravo,
    limit: Number(lower.match(/\btop\s*(\d+)/)?.[1] ?? 100)
  };
}

export async function importSinanTracomaRows(opts: {
  rows: RawRow[];
  bank: SinanTracomaBank;
  importId?: string;
  totalRows?: number;
  isLastBatch?: boolean;
}) {
  const supabase = createAdminClient();
  const normalized = opts.rows.map((row) => normalizeSinanTracomaRow(row, opts.bank));
  const { error } = await supabase
    .from("sinan_tracoma_rows")
    .upsert(normalized, { onConflict: "row_key", ignoreDuplicates: false });
  if (error) throw new Error(error.message);

  if (opts.isLastBatch ?? true) {
    await supabase.from("sinan_tracoma_import_log").insert({
      import_id: opts.importId ?? null,
      source_bank: opts.bank,
      rows_upserted: opts.totalRows ?? normalized.length,
      notes: "json_csv_import"
    });
  }

  return { upserted: normalized.length };
}

export async function getSinanTracomaStatus() {
  const supabase = createAdminClient();
  const { count, error: countError } = await supabase.from("sinan_tracoma_rows").select("id", { count: "exact", head: true });
  if (countError) throw new Error(`Erro ao consultar cache SINAN Tracoma: ${countError.message}`);

  const { data: logs, error: logsError } = await supabase
    .from("sinan_tracoma_import_log")
    .select("source_bank, imported_at, rows_upserted")
    .order("imported_at", { ascending: false })
    .limit(5);
  if (logsError) throw new Error(`Erro ao consultar historico de importacao SINAN: ${logsError.message}`);

  const { data, error: sampleError } = await supabase
    .from("sinan_tracoma_rows")
    .select("source_bank, agravo, ano, municipio")
    .limit(20000);
  if (sampleError) throw new Error(`Erro ao ler amostra SINAN Tracoma: ${sampleError.message}`);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const years = Array.from(new Set(rows.map((row) => Number(row.ano)).filter(Number.isFinite))).sort((a, b) => a - b);
  const banks = Array.from(new Set(rows.map((row) => String(row.source_bank ?? "")).filter(Boolean))).sort();
  const agravos = Array.from(new Set(rows.map((row) => String(row.agravo ?? "")).filter(Boolean))).slice(0, 20);
  const municipalities = new Set(rows.map((row) => String(row.municipio ?? "")).filter(Boolean)).size;
  return {
    hasData: (count ?? 0) > 0,
    totalRows: count ?? 0,
    banks,
    agravos,
    years,
    minYear: years[0] ?? null,
    maxYear: years[years.length - 1] ?? null,
    municipalities,
    lastImports: logs ?? []
  };
}

export async function runSinanTracomaAnalysis(question: string) {
  const parsed = parseQuestion(question);
  const supabase = createAdminClient();
  let query = supabase
    .from("sinan_tracoma_rows")
    .select("source_bank, agravo, ano, dt_notificacao, municipio, gve, drs, unidade, classificacao, criterio, evolucao, tratamento, conclusao");

  if (parsed.bank) query = query.eq("source_bank", parsed.bank);
  if (parsed.agravo) query = query.ilike("agravo", `%${parsed.agravo}%`);
  if (parsed.yearStart) query = query.gte("ano", parsed.yearStart);
  if (parsed.yearEnd) query = query.lte("ano", parsed.yearEnd);
  if (parsed.municipio) query = query.ilike("municipio", `%${parsed.municipio}%`);

  const { data, error } = await query.limit(100000);
  if (error) throw new Error(`SINAN Tracoma: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const groupField = parsed.dimension;
  const groups = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[groupField] ?? "Nao informado");
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  const resultRows = Array.from(groups.entries())
    .map(([label, valor]) => ({ [labelForDimension(groupField)]: label, Valor: valor }))
    .sort((a, b) => Number(b.Valor) - Number(a.Valor))
    .slice(0, Math.min(parsed.limit, 500));

  const totalRow = { [labelForDimension(groupField)]: "Total", Valor: rows.length };
  const banks = Array.from(new Set(rows.map((row) => String(row.source_bank ?? "")))).join(", ") || "nao identificado";
  const agravos = Array.from(new Set(rows.map((row) => String(row.agravo ?? "")).filter(Boolean))).slice(0, 5).join(", ") || "nao informado";
  const quality = buildQualityFindings(rows);

  return {
    question,
    parsed,
    metricLabel: "Registros SINAN Tracoma",
    timeLabel: parsed.yearStart ? `${parsed.yearStart} a ${parsed.yearEnd}` : "todo o cache",
    columns: [labelForDimension(groupField), "Valor"],
    rows: [...resultRows, totalRow],
    quality,
    interpretation: [
      `Foram encontrados ${rows.length} registros no cache SINAN Tracoma.`,
      `Banco(s) considerados: ${banks}. Agravo(s) observado(s): ${agravos}.`,
      parsed.agravo
        ? `A consulta aplicou filtro de agravo contendo "${parsed.agravo}".`
        : "Nenhum filtro de agravo foi identificado na pergunta; para bancos SINAN com multiplos agravos, recomenda-se informar o agravo.",
      "TRACONET deve ser interpretado como base consolidada; NOTTRACONET como base de informacoes individuais/notificacoes de caso.",
      ...quality.recommendations
    ]
  };
}

function isBlank(value: unknown) {
  return value == null || String(value).trim() === "";
}

function buildQualityFindings(rows: Array<Record<string, unknown>>) {
  const total = rows.length;
  const missing = {
    agravo: rows.filter((row) => isBlank(row.agravo)).length,
    ano: rows.filter((row) => isBlank(row.ano)).length,
    municipio: rows.filter((row) => isBlank(row.municipio)).length,
    classificacao: rows.filter((row) => isBlank(row.classificacao)).length,
    criterio: rows.filter((row) => isBlank(row.criterio)).length,
    evolucao: rows.filter((row) => isBlank(row.evolucao)).length,
    tratamento: rows.filter((row) => isBlank(row.tratamento)).length,
    conclusao: rows.filter((row) => isBlank(row.conclusao)).length
  };
  const futureYears = rows.filter((row) => Number(row.ano) > new Date().getFullYear()).length;
  const oldYears = rows.filter((row) => Number(row.ano) > 0 && Number(row.ano) < 1975).length;
  const withoutTreatment = missing.tratamento;
  const withoutConclusion = missing.conclusao;
  const recommendations: string[] = [];

  if (missing.agravo > 0) recommendations.push(`${missing.agravo} registros nao possuem agravo identificado; em base com multiplos agravos, isso prejudica o filtro de tracoma.`);
  if (missing.municipio > 0) recommendations.push(`${missing.municipio} registros nao possuem municipio identificado, limitando analise territorial.`);
  if (withoutTreatment > 0) recommendations.push(`${withoutTreatment} registros nao apresentam campo de tratamento preenchido ou mapeado; verificar antibioticoterapia/azitromicina e completude.`);
  if (withoutConclusion > 0) recommendations.push(`${withoutConclusion} registros nao apresentam conclusao/classificacao final preenchida ou mapeada.`);
  if (futureYears > 0 || oldYears > 0) recommendations.push(`Foram encontrados ${futureYears + oldYears} registros com ano improvavel; revisar datas de notificacao/investigacao.`);
  if (total === 0) recommendations.push("Nenhum registro encontrado para os filtros solicitados.");
  if (recommendations.length === 0) recommendations.push("Nao foram detectadas inconsistencias basicas de completude nos campos mapeados.");

  return {
    total,
    missing,
    futureYears,
    oldYears,
    withoutTreatment,
    withoutConclusion,
    recommendations
  };
}

function labelForDimension(dimension: string) {
  if (dimension === "source_bank") return "Banco";
  if (dimension === "municipio") return "Municipio";
  if (dimension === "gve") return "GVE";
  if (dimension === "drs") return "DRS";
  if (dimension === "ano") return "Ano";
  return dimension;
}

// ── Cross-bank divergence + deep quality audit ────────────────────────────────

export interface SinanAuditResult {
  totalTraconet: number;
  totalNottraconet: number;
  crossBankDivergences: Array<{
    municipio: string;
    ano: number;
    traconet: number;
    nottraconet: number;
    diff: number;
    risco: "alto" | "medio" | "baixo";
  }>;
  fieldCompleteness: Record<string, { total: number; filled: number; pct: number }>;
  semGraduacao: number;          // classificacao em branco
  semTratamento: number;         // tratamento em branco
  semConclusao: number;          // conclusao em branco
  tfSemTratamento: number;       // TF confirmado mas sem tratamento
  ttSemCircurgia: number;        // TT confirmado mas conclusao/tratamento não indica cirurgia
  anoImpossivel: number;         // ano < 1975 ou > ano atual
  recommendations: string[];
}

function normalizeBankLabel(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  if (s.includes("tf") || s.includes("folicular") || s === "1" || s === "tf") return "TF";
  if (s.includes("tt") || s.includes("triqui") || s === "2" || s === "tt") return "TT";
  if (s.includes("tf") && s.includes("tt")) return "TF+TT";
  if (s.includes("4") || s.includes("nao tracoma") || s.includes("não tracoma")) return "Nao tracoma";
  if (s.includes("5") || s.includes("inconclusivo")) return "Inconclusivo";
  return s || "Nao preenchido";
}

export async function auditarSinanTracoma(opts?: {
  municipio?: string;
  gve?: string;
  yearStart?: number;
  yearEnd?: number;
}): Promise<SinanAuditResult> {
  const supabase = createAdminClient();

  let query = supabase
    .from("sinan_tracoma_rows")
    .select("source_bank, agravo, ano, municipio, gve, drs, classificacao, criterio, evolucao, tratamento, conclusao");

  if (opts?.municipio) query = query.ilike("municipio", `%${opts.municipio}%`);
  if (opts?.gve)       query = query.ilike("gve", `%${opts.gve}%`);
  if (opts?.yearStart) query = query.gte("ano", opts.yearStart);
  if (opts?.yearEnd)   query = query.lte("ano", opts.yearEnd);

  const { data, error } = await query.limit(200000);
  if (error) throw new Error(`SINAN auditoria: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const traconetRows    = rows.filter((r) => r.source_bank === "traconet");
  const nottraconetRows = rows.filter((r) => r.source_bank === "nottraconet");

  // ── Cross-bank comparison per municipio×ano ───────────────────────────────
  function countByKey(rs: typeof rows) {
    const m = new Map<string, number>();
    for (const r of rs) {
      const key = `${r.municipio ?? "?"}|${r.ano ?? "?"}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }

  const traconetMap    = countByKey(traconetRows);
  const nottraconetMap = countByKey(nottraconetRows);
  const allKeys = new Set([...traconetMap.keys(), ...nottraconetMap.keys()]);

  const crossBankDivergences: SinanAuditResult["crossBankDivergences"] = [];
  for (const key of allKeys) {
    const tc  = traconetMap.get(key)    ?? 0;
    const ntc = nottraconetMap.get(key) ?? 0;
    const diff = tc - ntc;
    if (diff === 0) continue;
    const [municipio, anoStr] = key.split("|");
    const abs = Math.abs(diff);
    crossBankDivergences.push({
      municipio,
      ano: Number(anoStr) || 0,
      traconet: tc,
      nottraconet: ntc,
      diff,
      risco: abs >= 10 ? "alto" : abs >= 3 ? "medio" : "baixo"
    });
  }
  crossBankDivergences.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // ── Field completeness ────────────────────────────────────────────────────
  const fields = ["agravo", "municipio", "gve", "classificacao", "criterio", "tratamento", "conclusao", "evolucao"];
  const fieldCompleteness: SinanAuditResult["fieldCompleteness"] = {};
  for (const f of fields) {
    const filled = rows.filter((r) => !isBlank(r[f])).length;
    fieldCompleteness[f] = { total: rows.length, filled, pct: rows.length ? Math.round((filled / rows.length) * 100) : 0 };
  }

  // ── Tracoma-specific quality ──────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const semGraduacao  = rows.filter((r) => isBlank(r.classificacao)).length;
  const semTratamento = rows.filter((r) => isBlank(r.tratamento)).length;
  const semConclusao  = rows.filter((r) => isBlank(r.conclusao)).length;

  const tfRows = rows.filter((r) => {
    const cls = normalizeBankLabel(r.classificacao);
    return cls === "TF" || cls === "TF+TT";
  });
  const ttRows = rows.filter((r) => {
    const cls = normalizeBankLabel(r.classificacao);
    return cls === "TT" || cls === "TF+TT";
  });

  const tfSemTratamento = tfRows.filter((r) => isBlank(r.tratamento)).length;
  const ttSemCircurgia  = ttRows.filter((r) => {
    const trat = String(r.tratamento ?? "").toLowerCase();
    const conc = String(r.conclusao ?? "").toLowerCase();
    return !trat.includes("cirurg") && !trat.includes("epila") && !conc.includes("cirurg");
  }).length;

  const anoImpossivel = rows.filter((r) => {
    const ano = Number(r.ano);
    return Number.isFinite(ano) && (ano < 1975 || ano > currentYear);
  }).length;

  // ── Recommendations ───────────────────────────────────────────────────────
  const rec: string[] = [];
  const altoDivergencia = crossBankDivergences.filter((d) => d.risco === "alto");
  if (altoDivergencia.length > 0) {
    const top3 = altoDivergencia.slice(0, 3).map((d) => `${d.municipio} (${d.ano}): TRACONET=${d.traconet}, NOTTRACONET=${d.nottraconet}`).join("; ");
    rec.push(`SUBREGISTRO POTENCIAL em ${altoDivergencia.length} municipio(s)/periodo(s) com divergencia alta entre bancos. Exemplos: ${top3}.`);
  }
  if (semGraduacao > 0) {
    const pct = rows.length ? Math.round((semGraduacao / rows.length) * 100) : 0;
    rec.push(`${semGraduacao} caso(s) (${pct}%) sem graduacao TF/TT preenchida (campo classificacao vazio). Impede calculo de prevalencia e definicao de conduta.`);
  }
  if (tfSemTratamento > 0) rec.push(`${tfSemTratamento} caso(s) classificado(s) como TF confirmado sem campo de tratamento preenchido. Verificar se azitromicina foi prescrita/registrada.`);
  if (ttSemCircurgia > 0)  rec.push(`${ttSemCircurgia} caso(s) com TT confirmado sem indicacao de cirurgia ou epilation no campo de tratamento/conclusao. Risco de progressao para cegueira.`);
  if (semConclusao > 0)    rec.push(`${semConclusao} caso(s) sem conclusao/classificacao final preenchida.`);
  if (anoImpossivel > 0)   rec.push(`${anoImpossivel} registro(s) com ano impossivel (< 1975 ou > ${currentYear}). Corrigir data de notificacao na fonte.`);
  const baixoPct = Object.entries(fieldCompleteness)
    .filter(([, v]) => v.pct < 50 && v.total > 0)
    .map(([k, v]) => `${k}: ${v.pct}%`);
  if (baixoPct.length > 0) rec.push(`Campos com completude < 50%: ${baixoPct.join(", ")}. Verificar mapeamento do arquivo importado.`);
  if (rec.length === 0) rec.push("Nenhuma inconsistencia critica detectada. Dados com boa completude e sem divergencias expressivas entre bancos.");

  return {
    totalTraconet: traconetRows.length,
    totalNottraconet: nottraconetRows.length,
    crossBankDivergences: crossBankDivergences.slice(0, 50),
    fieldCompleteness,
    semGraduacao,
    semTratamento,
    semConclusao,
    tfSemTratamento,
    ttSemCircurgia,
    anoImpossivel,
    recommendations: rec
  };
}

export async function runSinanTracomaContextQuery(message: string) {
  const result = await runSinanTracomaAnalysis(message);
  const header = result.columns.join(" | ");
  const body = result.rows.slice(0, 40).map((row) => result.columns.map((column) => row[column]).join(" | ")).join("\n");
  return {
    result,
    summary: [
      `Fonte: cache SINAN Tracoma (TRACONET/NOTTRACONET).`,
      `Metrica: ${result.metricLabel}. Periodo: ${result.timeLabel}.`,
      header,
      body,
      "",
      result.interpretation.join("\n")
    ].join("\n")
  };
}
