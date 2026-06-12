import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { nomeMunicipio, gvePorCodigo } from "@/lib/municipios-sp";

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
  // Preferir campo de nome antes de código IBGE para futuros imports
  municipio: ["NM_MUNICIP", "MUNICIPIO", "MUNICIPIO_NOTIFICACAO", "MUN_NOT", "MUN_RES", "ID_MUNICIP", "ID_MN_RESI"],
  ibge: ["CO_MUNICIP", "IBGE", "ID_MUNICIP", "ID_MN_RESI"],
  gve: ["GVE", "GVE_NOME", "NM_GVE", "REGIONAL", "REG_SAUDE"],
  drs: ["DRS", "DRS_NOME", "NM_DRS"],
  unidade: ["ID_UNIDADE", "UNIDADE", "NM_UNIDADE", "CNES", "ID_CNES"],
  // TRACONET individual: CLASSI_FIN pode não existir — derivado de FORMA_TF/TT/etc. em normalizeSinanTracomaRow
  classificacao: ["CLASSI_FIN", "CLASSIFICACAO", "CLASSIFIN", "CRITERIO_CONF"],
  criterio: ["CRITERIO", "CRITERIO_CONF", "TP_CRITERIO"],
  evolucao: ["EVOLUCAO", "EVOL_CASO", "TP_EVOLUCAO"],
  // ENCAMINHA = encaminhamento para cirurgia (1=Sim) — usado na detecção TT sem cirurgia
  tratamento: ["TRATAMENTO", "TRAT", "ID_TRATAM", "ANTIBIOTIC", "AZITROMIC", "MEDICAMENTO", "DOSE", "DT_TRAT", "ENCAMINHA", "ST_ENCAMINHA"],
  conclusao: ["CONCLUSAO", "DT_CONCLUSAO", "SIT_CONCLU", "CLASSI_FIN", "CLASSIFICACAO"]
};

const consolidatedPositiveFieldCandidates = [
  "NU_CASOPOS", "NU_CAS_POS", "NU_POSITIV", "NU_POSITIVOS", "NU_POS",
  "CASOPOS", "CAS_POS", "CASOS_POS", "POSITIVOS", "N_POSITIVO",
  "QT_POS", "QTD_POS", "TOTAL_POS", "TOT_POS", "NU_CASOS", "CASOS",
  "TOTAL_CASOS", "TOT_CASOS", "QT_CASOS", "QTD_CASOS"
];

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

// Para TRACONET, a forma clínica vem de campos booleanos separados (dicionário SINAN v5).
// "1" = Sim, "2" = Não, "9" = Ignorado.
function deriveTraconetClassificacao(row: RawRow): string | null {
  const keys = Object.keys(row);
  function flag(candidates: string[]) {
    const key = keys.find((k) => candidates.some((c) => k.toLowerCase() === c.toLowerCase()));
    return key ? String(row[key] ?? "").trim() : null;
  }
  const tf = flag(["FORMA_TF", "TP_FORMA_CLINICA_TF", "TF"]);
  const tt = flag(["FORMA_TT", "TP_FORMA_CLINICA_TT", "TT"]);
  const ti = flag(["FORMA_TI", "TP_FORMA_CLINICA_TI", "TI"]);
  const ts = flag(["FORMA_TS", "TP_FORMA_CLINICA_TS", "TS"]);
  const co = flag(["FORMA_CO", "TP_FORMA_CLINICA_CO", "CO"]);

  const formas: string[] = [];
  if (tf === "1") formas.push("TF");
  if (tt === "1") formas.push("TT");
  if (ti === "1") formas.push("TI");
  if (ts === "1") formas.push("TS");
  if (co === "1") formas.push("CO");
  if (formas.length > 0) return formas.join("+");

  // Se todos são "2" (Não), caso sem forma clínica positiva
  const allNo = [tf, tt, ti, ts, co].filter((v) => v !== null);
  if (allNo.length > 0 && allNo.every((v) => v === "2")) return "Sem forma positiva";

  return null; // campos não encontrados — fallback para CLASSI_FIN no chamador
}

// Para TRACONET, encaminhamento cirúrgico é campo ENCAMINHA (1=Sim, 2=Não, 9=Ignorado)
function deriveEncaminhamento(row: RawRow): string | null {
  const keys = Object.keys(row);
  const key = keys.find((k) =>
    ["encaminha", "st_encaminha_cirugia", "st_encaminha", "encaminhamento"].includes(k.toLowerCase())
  );
  if (!key) return null;
  const v = String(row[key] ?? "").trim();
  if (v === "1") return "Sim";
  if (v === "2") return "Não";
  if (v === "9") return "Ignorado";
  return v || null;
}

export function normalizeSinanTracomaRow(row: RawRow, bank: SinanTracomaBank): NormalizedSinanRow {
  const date = normalizeDate(getValue(row, fieldCandidates.date));
  const ano = toNumberOrNull(getValue(row, fieldCandidates.ano)) ?? (date ? Number(date.slice(0, 4)) : null);

  // classificacao: para TRACONET, tenta primeiro CLASSI_FIN; se vazio, deriva dos FORMA_* campos
  let classificacao = toStringOrNull(getValue(row, fieldCandidates.classificacao));
  if (!classificacao && bank === "traconet") {
    classificacao = deriveTraconetClassificacao(row);
  }

  // conclusao: para TRACONET, inclui o encaminhamento cirúrgico se disponível
  let conclusao = toStringOrNull(getValue(row, fieldCandidates.conclusao));
  if (bank === "traconet") {
    const encaminha = deriveEncaminhamento(row);
    if (encaminha) {
      conclusao = conclusao
        ? `${conclusao} | Encaminhamento cirurgia: ${encaminha}`
        : `Encaminhamento cirurgia: ${encaminha}`;
    }
  }

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
    classificacao,
    criterio: toStringOrNull(getValue(row, fieldCandidates.criterio)),
    evolucao: toStringOrNull(getValue(row, fieldCandidates.evolucao)),
    tratamento: toStringOrNull(getValue(row, fieldCandidates.tratamento)),
    conclusao,
    raw: row
  };
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseQuestion(question: string) {
  const lower = normalizeText(question);
  // TRACONET = casos individuais (sexo, idade, TF/TT); NOTTRACONET = consolidado/agregados
  const bank: SinanTracomaBank | undefined =
    /traconet|casos?|individual|notificacao|sexo|idade|forma clinica/.test(lower) ? "traconet" :
    /nottraconet|nottraconect|ntracoma|consolidado|consolidada|agregado/.test(lower) ? "nottraconet" :
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
    .select("source_bank, agravo, ano, dt_notificacao, municipio, gve, drs, unidade, classificacao, criterio, evolucao, tratamento, conclusao, raw");

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
    groups.set(label, (groups.get(label) ?? 0) + sinanCaseWeight(row));
  }
  const resultRows = Array.from(groups.entries())
    .map(([label, valor]) => ({ [labelForDimension(groupField)]: label, Valor: valor }))
    .sort((a, b) => Number(b.Valor) - Number(a.Valor))
    .slice(0, Math.min(parsed.limit, 500));

  const totalCases = rows.reduce((sum, row) => sum + sinanCaseWeight(row), 0);
  const totalRow = { [labelForDimension(groupField)]: "Total", Valor: totalCases };
  const banks = Array.from(new Set(rows.map((row) => String(row.source_bank ?? "")))).join(", ") || "nao identificado";
  const agravos = Array.from(new Set(rows.map((row) => String(row.agravo ?? "")).filter(Boolean))).slice(0, 5).join(", ") || "nao informado";
  const quality = buildQualityFindings(rows);

  return {
    question,
    parsed,
    metricLabel: "Casos SINAN Tracoma",
    timeLabel: parsed.yearStart ? `${parsed.yearStart} a ${parsed.yearEnd}` : "todo o cache",
    columns: [labelForDimension(groupField), "Valor"],
    rows: [...resultRows, totalRow],
    quality,
    interpretation: [
      `Foram considerados ${totalCases} caso(s) SINAN Tracoma em ${rows.length} linha(s) do cache.`,
      `Banco(s) considerados: ${banks}. Agravo(s) observado(s): ${agravos}.`,
      parsed.agravo
        ? `A consulta aplicou filtro de agravo contendo "${parsed.agravo}".`
        : "Nenhum filtro de agravo foi identificado na pergunta; para bancos SINAN com multiplos agravos, recomenda-se informar o agravo.",
      "TRACONET = casos individuais (sexo, idade, TF/TT); NOTTRACONET = consolidado (nº examinados/positivos por localidade).",
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
  diagnostico: {
    traconet: { colunas: string[]; municipiosAmostra: string[]; anosAmostra: number[]; camposPreenchidos: string[] };
    nottraconet: { colunas: string[]; municipiosAmostra: string[]; anosAmostra: number[]; camposPreenchidos: string[] };
    aviso?: string;
  };
  crossBankDivergences: Array<{
    municipio: string;
    municipioNome: string;
    gve: string;
    ano: number;
    traconet: number;
    nottraconet: number;
    diff: number;
    risco: "alto" | "medio" | "baixo";
  }>;
  comparisonsByMunicipalityYear: Array<{
    municipio: string;
    municipioNome: string;
    gve: string;
    ano: number;
    traconet: number;
    nottraconet: number;
    diff: number;
    risco: "alto" | "medio" | "baixo";
  }>;
  divergencesByYear: Array<{
    ano: number;
    traconet: number;
    nottraconet: number;
    diff: number;
    risco: "alto" | "medio" | "baixo";
  }>;
  divergencesByGve: Array<{
    gve: string;
    traconet: number;
    nottraconet: number;
    diff: number;
    risco: "alto" | "medio" | "baixo";
  }>;
  fieldCompleteness: Record<string, { total: number; filled: number; pct: number }>;
  semGraduacao: number;
  semTratamento: number;
  semConclusao: number;
  tfSemTratamento: number;
  ttSemCircurgia: number;
  anoImpossivel: number;
  semFormaClinicaDetalhe: Array<{
    municipio: string;
    municipioNome: string;
    gve: string;
    count: number;
  }>;
  consolidatedPositiveField: string | null;
  consolidatedRowsWithoutPositiveField: number;
  duplicateNotificationIds: Array<{
    id: string;
    count: number;
    municipio: string;
    ano: number;
  }>;
  missingNotificationId: number;
  recommendations: string[];
}

function rawObject(row: Record<string, unknown>): Record<string, unknown> {
  return row.raw && typeof row.raw === "object" ? row.raw as Record<string, unknown> : {};
}

function getRawValue(row: Record<string, unknown>, candidates: string[]) {
  const raw = rawObject(row);
  const keys = Object.keys(raw);
  for (const candidate of candidates) {
    const key = keys.find((item) => item.toLowerCase() === candidate.toLowerCase());
    if (key && raw[key] != null && String(raw[key]).trim() !== "") return { key, value: raw[key] };
  }
  return null;
}

function toNonNegativeNumber(value: unknown): number | null {
  if (value == null) return null;
  const normalized = String(value).trim().replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function sinanCaseWeight(row: Record<string, unknown>): number {
  if (row.source_bank === "nottraconet") {
    const found = getRawValue(row, consolidatedPositiveFieldCandidates);
    return found ? toNonNegativeNumber(found.value) ?? 0 : 0;
  }
  return 1;
}

function normalizeBankLabel(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  // Valores derivados dos campos FORMA_* (ex: "TF", "TT", "TF+TT", "TF+TI")
  if (s === "tf") return "TF";
  if (s === "tt") return "TT";
  if (s.includes("tf") && s.includes("tt")) return "TF+TT";
  if (s.includes("tf")) return "TF";
  if (s.includes("tt") || s.includes("triqui")) return "TT";
  if (s.includes("ti") || s.includes("inflamatorio")) return "TI";
  if (s.includes("ts") || s.includes("cicatricial")) return "TS";
  if (s.includes("co") || s.includes("opacificacao") || s.includes("opacificação")) return "CO";
  if (s.includes("folicular")) return "TF";
  // Valores CLASSI_FIN numéricos (quando não mapeado por FORMA_*)
  if (s === "1") return "TF";
  if (s === "2") return "TT";
  if (s === "3") return "TI";
  if (s === "4" || s.includes("nao tracoma") || s.includes("não tracoma")) return "Nao tracoma";
  if (s === "5" || s.includes("inconclusivo")) return "Inconclusivo";
  return s || "Nao preenchido";
}

export async function auditarSinanTracoma(opts?: {
  municipio?: string;
  gve?: string;
  yearStart?: number;
  yearEnd?: number;
}): Promise<SinanAuditResult> {
  const supabase = createAdminClient();

  // Queries separadas por banco para evitar truncamento por max_rows do PostgREST.
  // TRACONET = casos individuais (TF/TT/sexo/idade/tratamento)
  // NOTTRACONET = consolidado/agregados (nº examinados e positivos por localidade)
  let tcQ = supabase
    .from("sinan_tracoma_rows")
    .select("source_bank, agravo, ano, municipio, gve, drs, classificacao, criterio, evolucao, tratamento, conclusao, raw")
    .eq("source_bank", "traconet");
  if (opts?.municipio) tcQ = tcQ.ilike("municipio", `%${opts.municipio}%`);
  if (opts?.yearStart) tcQ = tcQ.gte("ano", opts.yearStart);
  if (opts?.yearEnd)   tcQ = tcQ.lte("ano", opts.yearEnd);

  let ntcQ = supabase
    .from("sinan_tracoma_rows")
    .select("source_bank, ano, municipio, gve, raw")
    .eq("source_bank", "nottraconet");
  if (opts?.municipio) ntcQ = ntcQ.ilike("municipio", `%${opts.municipio}%`);
  if (opts?.yearStart) ntcQ = ntcQ.gte("ano", opts.yearStart);
  if (opts?.yearEnd)   ntcQ = ntcQ.lte("ano", opts.yearEnd);

  const [tcResult, ntcResult] = await Promise.all([
    tcQ.limit(200000),
    ntcQ.limit(200000),
  ]);

  if (tcResult.error) throw new Error(`SINAN auditoria (TRACONET): ${tcResult.error.message}`);
  if (ntcResult.error) throw new Error(`SINAN auditoria (NOTTRACONET): ${ntcResult.error.message}`);

  let traconetRows    = (tcResult.data  ?? []) as Array<Record<string, unknown>>;
  let nottraconetRows = (ntcResult.data ?? []) as Array<Record<string, unknown>>;

  // Extrai o total de casos positivos de uma linha do NOTTRACONET (campo NU_CASOPOS do raw).
  // Cada linha NOTTRACONET é um relatório consolidado — NU_CASOPOS = nº de casos positivos.
  const positiveFieldUsage = new Map<string, number>();
  const positiveValueCache = new WeakMap<object, number>();
  let consolidatedRowsWithoutPositiveField = 0;

  function ntcCasoPos(r: Record<string, unknown>): number {
    const cached = positiveValueCache.get(r);
    if (cached != null) return cached;

    const found = getRawValue(r, consolidatedPositiveFieldCandidates);
    const n = found ? toNonNegativeNumber(found.value) : null;
    if (found && n != null) {
      positiveFieldUsage.set(found.key, (positiveFieldUsage.get(found.key) ?? 0) + 1);
      positiveValueCache.set(r, n);
      return n;
    }
    consolidatedRowsWithoutPositiveField += 1;
    positiveValueCache.set(r, 0);
    return 0;
  }

  function resolveGveBasic(r: Record<string, unknown>): string {
    return (r.gve ? String(r.gve).trim() : null)
      ?? gvePorCodigo(r.municipio as string)
      ?? "";
  }

  if (opts?.gve) {
    const wantedGve = normalizeText(opts.gve);
    traconetRows = traconetRows.filter((row) => normalizeText(resolveGveBasic(row)).includes(wantedGve));
    nottraconetRows = nottraconetRows.filter((row) => normalizeText(resolveGveBasic(row)).includes(wantedGve));
  }

  // Totais reais: TRACONET = registros individuais; NOTTRACONET = soma de casos positivos
  const totalTraconetCount    = traconetRows.length;
  const totalNottraconetCount = nottraconetRows.reduce((s, r) => s + ntcCasoPos(r), 0);
  const consolidatedPositiveField = Array.from(positiveFieldUsage.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const notificationIdCandidates = ["NU_NOTIFIC", "ID_NOTIFIC", "NUM_NOTIFIC", "NOTIFIC", "NU_NOTIF", "ID"];
  const notificationIdMap = new Map<string, { count: number; municipio: string; ano: number }>();
  let missingNotificationId = 0;
  for (const row of traconetRows) {
    const found = getRawValue(row, notificationIdCandidates);
    const id = found ? String(found.value ?? "").trim() : "";
    if (!id) {
      missingNotificationId += 1;
      continue;
    }
    const current = notificationIdMap.get(id) ?? {
      count: 0,
      municipio: String(row.municipio ?? ""),
      ano: Number(row.ano) || 0
    };
    current.count += 1;
    notificationIdMap.set(id, current);
  }
  const duplicateNotificationIds = Array.from(notificationIdMap.entries())
    .filter(([, value]) => value.count > 1)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  // ── Cross-bank comparison per municipio×ano ───────────────────────────────
  // Compara contagem de casos individuais (TRACONET) vs registros consolidados (NOTTRACONET)
  // diff > 0 → consolidado tem mais registros que individuais (subregistro de individuais)
  // diff < 0 → individuais têm mais que consolidado (possível duplicidade ou casos não consolidados)
  function normMunicipio(v: unknown) {
    return String(v ?? "?").trim().toUpperCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ");
  }
  // TRACONET: cada linha = 1 caso individual → soma +1
  // NOTTRACONET: cada linha = relatório consolidado → soma NU_CASOPOS
  function countTraconetByKey(rs: Array<Record<string, unknown>>) {
    const m = new Map<string, number>();
    for (const r of rs) {
      const key = `${normMunicipio(r.municipio)}|${r.ano ?? "?"}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }
  function countNottraconetByKey(rs: Array<Record<string, unknown>>) {
    const m = new Map<string, number>();
    for (const r of rs) {
      const key = `${normMunicipio(r.municipio)}|${r.ano ?? "?"}`;
      m.set(key, (m.get(key) ?? 0) + ntcCasoPos(r));
    }
    return m;
  }

  // Indexar GVE por município normalizado.
  // r.gve é null em ambos os bancos (SINAN DBF não inclui campo GVE),
  // por isso usa lookup estático pelo código IBGE armazenado em r.municipio.
  const gvePorMunicipio = new Map<string, string>();
  for (const r of [...traconetRows, ...nottraconetRows]) {
    const mun = normMunicipio(r.municipio);
    if (!gvePorMunicipio.has(mun)) {
      const gve = (r.gve ? String(r.gve).trim() : null)
        ?? gvePorCodigo(r.municipio as string);
      if (gve) gvePorMunicipio.set(mun, gve);
    }
  }

  const traconetMap    = countTraconetByKey(traconetRows);
  const nottraconetMap = countNottraconetByKey(nottraconetRows);
  const allKeys = new Set([...traconetMap.keys(), ...nottraconetMap.keys()]);

  const comparisonsByMunicipalityYear: SinanAuditResult["comparisonsByMunicipalityYear"] = [];
  for (const key of allKeys) {
    const tc  = traconetMap.get(key)    ?? 0;
    const ntc = nottraconetMap.get(key) ?? 0;
    const diff = ntc - tc;
    const [municipio, anoStr] = key.split("|");
    const abs = Math.abs(diff);
    comparisonsByMunicipalityYear.push({
      municipio,
      municipioNome: nomeMunicipio(municipio),
      gve: gvePorMunicipio.get(municipio) ?? "",
      ano: Number(anoStr) || 0,
      traconet: tc,
      nottraconet: ntc,
      diff,
      risco: abs >= 10 ? "alto" : abs >= 3 ? "medio" : "baixo"
    });
  }
  comparisonsByMunicipalityYear.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const crossBankDivergences = comparisonsByMunicipalityYear.filter((row) => row.diff !== 0);
  crossBankDivergences.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // ── Por Ano ───────────────────────────────────────────────────────────────
  const yearMap = new Map<number, { traconet: number; nottraconet: number }>();
  for (const [key, tc] of traconetMap) {
    const ano = Number(key.split("|")[1]) || 0;
    const curr = yearMap.get(ano) ?? { traconet: 0, nottraconet: 0 };
    curr.traconet += tc;
    yearMap.set(ano, curr);
  }
  for (const [key, ntc] of nottraconetMap) {
    const ano = Number(key.split("|")[1]) || 0;
    const curr = yearMap.get(ano) ?? { traconet: 0, nottraconet: 0 };
    curr.nottraconet += ntc;
    yearMap.set(ano, curr);
  }
  const divergencesByYear: SinanAuditResult["divergencesByYear"] = Array.from(yearMap.entries())
    .map(([ano, v]) => {
      const diff = v.nottraconet - v.traconet;
      const abs  = Math.abs(diff);
      return { ano, traconet: v.traconet, nottraconet: v.nottraconet, diff, risco: abs >= 50 ? "alto" : abs >= 10 ? "medio" : "baixo" as "alto" | "medio" | "baixo" };
    })
    .sort((a, b) => a.ano - b.ano);

  // ── Por GVE ───────────────────────────────────────────────────────────────
  // r.gve é null em ambos os bancos; usar lookup estático pelo código IBGE em r.municipio
  function resolveGve(r: Record<string, unknown>): string {
    return (r.gve ? String(r.gve).trim() : null)
      ?? gvePorCodigo(r.municipio as string)
      ?? gvePorMunicipio.get(normMunicipio(r.municipio))
      ?? "Não informado";
  }
  function countByGve(rs: Array<Record<string, unknown>>, increment: (r: Record<string, unknown>) => number) {
    const m = new Map<string, number>();
    for (const r of rs) {
      const gve = resolveGve(r);
      m.set(gve, (m.get(gve) ?? 0) + increment(r));
    }
    return m;
  }
  const tcGveMap  = countByGve(traconetRows,    () => 1);
  const ntcGveMap = countByGve(nottraconetRows, ntcCasoPos);
  const allGves   = new Set([...tcGveMap.keys(), ...ntcGveMap.keys()]);
  const divergencesByGve: SinanAuditResult["divergencesByGve"] = Array.from(allGves).map((gve) => {
    const tc   = tcGveMap.get(gve)  ?? 0;
    const ntc  = ntcGveMap.get(gve) ?? 0;
    const diff = ntc - tc;
    const abs  = Math.abs(diff);
    return { gve, traconet: tc, nottraconet: ntc, diff, risco: abs >= 50 ? "alto" : abs >= 10 ? "medio" : "baixo" as "alto" | "medio" | "baixo" };
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // ── Field completeness — somente TRACONET (individuais) tem campos clínicos ──
  const fieldsTraconet = ["agravo", "municipio", "gve", "classificacao", "criterio", "tratamento", "conclusao", "evolucao"];
  const fieldCompleteness: SinanAuditResult["fieldCompleteness"] = {};
  const baseRows = traconetRows.length > 0 ? traconetRows : nottraconetRows; // fallback se só houver um banco
  for (const f of fieldsTraconet) {
    const filled = baseRows.filter((r) => !isBlank(r[f])).length;
    fieldCompleteness[f] = { total: baseRows.length, filled, pct: baseRows.length ? Math.round((filled / baseRows.length) * 100) : 0 };
  }

  // ── Sem forma clínica: detalhe por município ──────────────────────────────
  const semFormaMap = new Map<string, number>();
  for (const r of traconetRows) {
    if (!isBlank(r.classificacao)) continue;
    const mun = String(r.municipio ?? "?").trim();
    semFormaMap.set(mun, (semFormaMap.get(mun) ?? 0) + 1);
  }
  const semFormaClinicaDetalhe = Array.from(semFormaMap.entries())
    .map(([municipio, count]) => ({
      municipio,
      municipioNome: nomeMunicipio(municipio),
      gve: gvePorCodigo(municipio) ?? gvePorMunicipio.get(normMunicipio(municipio)) ?? "Não informado",
      count
    }))
    .sort((a, b) => b.count - a.count);

  // ── Checks clínicos: aplicar SOMENTE nos casos individuais (TRACONET) ─────
  const currentYear = new Date().getFullYear();
  const semGraduacao  = traconetRows.filter((r) => isBlank(r.classificacao)).length;
  const semTratamento = traconetRows.filter((r) => isBlank(r.tratamento)).length;
  const semConclusao  = traconetRows.filter((r) => isBlank(r.conclusao)).length;

  const tfRows = traconetRows.filter((r) => {
    const cls = normalizeBankLabel(r.classificacao);
    return cls === "TF" || cls === "TF+TT";
  });
  const ttRows = traconetRows.filter((r) => {
    const cls = normalizeBankLabel(r.classificacao);
    return cls === "TT" || cls === "TF+TT";
  });

  const tfSemTratamento = tfRows.filter((r) => isBlank(r.tratamento)).length;
  const ttSemCircurgia  = ttRows.filter((r) => {
    const trat = String(r.tratamento ?? "").toLowerCase();
    const conc = String(r.conclusao ?? "").toLowerCase();
    // conclusao já pode conter "Encaminhamento cirurgia: Sim" se ENCAMINHA=1
    if (conc.includes("encaminhamento cirurgia: sim")) return false;
    if (conc.includes("encaminhamento cirurgia: não") || conc.includes("encaminhamento cirurgia: nao")) return true;
    return !trat.includes("cirurg") && !trat.includes("epila") && !conc.includes("cirurg");
  }).length;

  const allRows = [...traconetRows, ...nottraconetRows];
  const anoImpossivel = allRows.filter((r) => {
    const ano = Number(r.ano);
    return Number.isFinite(ano) && (ano < 1975 || ano > currentYear);
  }).length;

  // ── Recommendations ───────────────────────────────────────────────────────
  const rec: string[] = [];
  const altoDivergencia = crossBankDivergences.filter((d) => d.risco === "alto");
  if (altoDivergencia.length > 0) {
    const top3 = altoDivergencia.slice(0, 3).map((d) => {
      const tipo = d.diff > 0
        ? `positivos consolidados(${d.nottraconet}) > individuais(${d.traconet}): subregistro de casos individuais`
        : `individuais(${d.traconet}) > positivos consolidados(${d.nottraconet}): possivel duplicidade ou ausencia no consolidado`;
      return `${d.municipio} ${d.ano}: ${tipo}`;
    }).join("; ");
    rec.push(`DIVERGENCIA ALTA em ${altoDivergencia.length} municipio(s)/periodo(s) entre TRACONET (casos individuais) e NOTTRACONET/NTRACOMA (casos positivos consolidados). Exemplos: ${top3}.`);
  }
  if (nottraconetRows.length > 0 && !consolidatedPositiveField) {
    rec.push("O banco consolidado NOTTRACONET/NTRACOMA foi importado, mas nenhum campo de casos positivos foi reconhecido. A comparacao entre bancos fica indisponivel ate mapear a variavel correta de positivos.");
  } else if (consolidatedRowsWithoutPositiveField > 0) {
    rec.push(`${consolidatedRowsWithoutPositiveField} linha(s) do consolidado nao possuem campo de casos positivos preenchido/mapeado; revisar o DBF consolidado antes de interpretar divergencias.`);
  }
  if (duplicateNotificationIds.length > 0) {
    const exemplos = duplicateNotificationIds.slice(0, 3).map((d) => `${d.id} (${d.count}x)`).join(", ");
    rec.push(`${duplicateNotificationIds.length} identificador(es) de notificacao aparecem mais de uma vez no TRACONET. Verificar possiveis duplicidades. Exemplos: ${exemplos}.`);
  }
  if (missingNotificationId > 0) {
    rec.push(`${missingNotificationId} caso(s) individual(is) do TRACONET sem identificador de notificacao mapeado. Isso limita a deteccao de duplicidades.`);
  }
  if (semGraduacao > 0) {
    const pct = traconetRows.length ? Math.round((semGraduacao / traconetRows.length) * 100) : 0;
    rec.push(`${semGraduacao} caso(s) individual(is) (${pct}%) sem graduacao TF/TI/TS/TT/CO preenchida. Impede calculo de prevalencia e definicao de conduta.`);
  }
  if (tfSemTratamento > 0) rec.push(`${tfSemTratamento} caso(s) TRACONET classificado(s) como TF sem tratamento registrado. TF ativo exige azitromicina — verificar se foi prescrita e registrada.`);
  if (ttSemCircurgia > 0)  rec.push(`${ttSemCircurgia} caso(s) TRACONET com TT confirmado sem encaminhamento para cirurgia/epilation. TT requer referencia oftalmologica — risco de progressao para cegueira.`);
  if (semConclusao > 0)    rec.push(`${semConclusao} caso(s) individual(is) sem conclusao/encerramento preenchido.`);
  if (anoImpossivel > 0)   rec.push(`${anoImpossivel} registro(s) com ano impossivel (< 1975 ou > ${currentYear}). Corrigir data de notificacao na fonte.`);
  const baixoPct = Object.entries(fieldCompleteness)
    .filter(([, v]) => v.pct < 50 && v.total > 0)
    .map(([k, v]) => `${k}: ${v.pct}%`);
  if (baixoPct.length > 0) rec.push(`Campos TRACONET com completude < 50%: ${baixoPct.join(", ")}. Verificar mapeamento do arquivo importado.`);
  if (rec.length === 0) rec.push("Nenhuma inconsistencia critica detectada. Dados com boa completude e sem divergencias expressivas entre bancos.");

  // Busca amostra de raw para diagnóstico — queries separadas por banco para garantir 1 amostra de cada
  const [diagTcSample, diagNtcSample] = await Promise.all([
    supabase.from("sinan_tracoma_rows").select("source_bank, raw").eq("source_bank", "traconet").limit(1),
    supabase.from("sinan_tracoma_rows").select("source_bank, raw").eq("source_bank", "nottraconet").limit(1)
  ]);
  const diagTraconet    = (diagTcSample.data  ?? []) as Array<{ source_bank: string; raw: unknown }>;
  const diagNottraconet = (diagNtcSample.data ?? []) as Array<{ source_bank: string; raw: unknown }>;

  function rawKeys(r: { raw: unknown }): string[] {
    if (!r.raw || typeof r.raw !== "object") return [];
    return Object.keys(r.raw as Record<string, unknown>);
  }

  type DiagSample = Array<{ source_bank: string; raw: unknown }>;

  function bankDiag(bankRows: Array<Record<string, unknown>>, diagSampleRows: DiagSample) {
    if (!bankRows.length) return { colunas: [] as string[], municipiosAmostra: [] as string[], anosAmostra: [] as number[], camposPreenchidos: [] as string[] };
    const colunas = diagSampleRows.length > 0 ? rawKeys(diagSampleRows[0]).slice(0, 30) : [];
    const munic = [...new Set(bankRows.map((r) => String(r.municipio ?? "")).filter(Boolean))].slice(0, 5) as string[];
    const anos  = [...new Set(bankRows.map((r) => Number(r.ano)).filter((a: number) => a > 0))].sort((a: number, b: number) => a - b).slice(0, 5) as number[];
    const normalizedCols = ["agravo","municipio","gve","classificacao","tratamento","conclusao"];
    const preenchidos = normalizedCols.filter((f) => bankRows.some((r) => !isBlank(r[f])));
    return { colunas, municipiosAmostra: munic, anosAmostra: anos, camposPreenchidos: preenchidos };
  }

  // Detecção de inversão: TRACONET deveria ter FORMA_TF/TT nos campos raw
  function temCamposIndividuais(sample: DiagSample) {
    return sample.some((r) => rawKeys(r).some((k) => /forma_t[ftisco]/i.test(k)));
  }
  const traconetTemForma    = temCamposIndividuais(diagTraconet);
  const nottraconetTemForma = temCamposIndividuais(diagNottraconet);
  let aviso: string | undefined;
  if (!traconetTemForma && nottraconetTemForma && traconetRows.length > 0 && nottraconetRows.length > 0) {
    aviso = "ATENÇÃO: Os bancos parecem estar INVERTIDOS na importação. TRACONET não tem campos FORMA_TF/TT mas NOTTRACONET tem. Execute o SQL de correção no Supabase para trocar os labels.";
  }

  return {
    totalTraconet: totalTraconetCount,
    totalNottraconet: totalNottraconetCount,
    diagnostico: {
      traconet: bankDiag(traconetRows, diagTraconet),
      nottraconet: bankDiag(nottraconetRows, diagNottraconet),
      aviso
    },
    crossBankDivergences,
    comparisonsByMunicipalityYear,
    divergencesByYear,
    divergencesByGve,
    fieldCompleteness,
    semGraduacao,
    semTratamento,
    semConclusao,
    tfSemTratamento,
    ttSemCircurgia,
    anoImpossivel,
    semFormaClinicaDetalhe,
    consolidatedPositiveField,
    consolidatedRowsWithoutPositiveField,
    duplicateNotificationIds,
    missingNotificationId,
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
