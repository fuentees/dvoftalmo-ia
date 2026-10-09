import { BUSINESS_TIME_ZONE, dateToEpiWeek, currentEpiWeek as officialCurrentEpiWeek } from "@/lib/epi-week";
import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";
import { createAdminClient } from "@/lib/supabase/admin";
import { excluidoFlag } from "@/lib/cevesp-clean";
import { auditStructure, conteudoKey, unidadeKey, type StructuralFinding } from "@/lib/cevesp-audit";

export interface InvalidRecord {
  recordId: string;
  pkColumn: string;
  controlaSubmit: string | null;
  dtNotificacao: string | null;
  semEpidemio: number | null;
  municipio: string | null;
  gve: string | null;
  ano: number | null;
  totalCaso: number | null;
  issue: string;
  issueType: "data_tempo" | "conteudo" | "duplicidade";
  /** Código estável do problema (ex.: se_invalida, duplicata). */
  problem: string;
  /** Chave única da linha (um registro pode ter vários problemas). */
  issueKey: string;
  /** Resumo da primeira sugestão, para exibição. */
  suggestedField: string;
  suggestedValue: string;
  /** Todas as alterações sugeridas (ex.: ANO e SemEpidemio juntos). */
  suggestions: Array<{ field: string; oldValue: string; newValue: string }>;
  /** Grupo de duplicidade (unidade + semana), quando houver. */
  group?: string;
  /** Data/hora de digitação no MySQL (created_at). */
  createdAt?: string | null;
  /** Registros do grupo de duplicidade, do mais antigo ao mais recente, para comparação. */
  groupMembers?: GroupMember[];
}

export interface GroupMember {
  recordId: string;
  createdAt: string | null;
  dtNotificacao: string | null;
  notificante: string | null;
  valores: Record<string, number | null>;
}

const MEMBER_FIELDS = ["TotalCaso", "FxMenorUmAno", "FxUmQuatro", "FxCincoNove", "FxDezQuatorze", "FxQuizeOuMais", "SexMasc", "SexFem"];

function createdAtOf(r: Record<string, unknown>) {
  return r.created_at_origem ? String(r.created_at_origem).replace("T", " ").slice(0, 19) : null;
}

function groupMemberOf(r: Record<string, unknown>): GroupMember {
  return {
    recordId: recordIdOf(r),
    createdAt: createdAtOf(r),
    dtNotificacao: r.DtNotificacao ? String(r.DtNotificacao).slice(0, 10) : (r.dt_notificacao_raw ? String(r.dt_notificacao_raw) : null),
    notificante: r.Nome_notificante ? String(r.Nome_notificante) : null,
    valores: Object.fromEntries(MEMBER_FIELDS.map((f) => [f, toNumber(r[f])]))
  };
}

export interface CorrectionProposal {
  recordId: string;
  tableName: string;
  pkColumn: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function withSuggestions(record: InvalidRecord): InvalidRecord {
  const oldValue = record.suggestedField === "SemEpidemio" ? String(record.semEpidemio ?? "")
    : record.suggestedField === "TotalCaso" ? String(record.totalCaso ?? "")
    : record.suggestedField === "DtNotificacao" ? (record.dtNotificacao ?? "") : "";
  return {
    ...record,
    suggestions: record.suggestedField && record.suggestedValue
      ? [{ field: record.suggestedField, oldValue, newValue: record.suggestedValue }]
      : []
  };
}

function conservativeSuggestion(record: InvalidRecord, now = new Date()): InvalidRecord {
  if (record.suggestedField === "DtNotificacao" || record.suggestedField === "TotalCaso") return withSuggestions({ ...record, suggestedValue: "" });
  if (record.suggestedField === "SemEpidemio") {
    const match = record.dtNotificacao?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return withSuggestions({ ...record, suggestedValue: "" });
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const valid = date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) && date.getFullYear() >= 1990 && date <= now;
    return withSuggestions({ ...record, suggestedValue: valid ? String(dateToEpiWeek(date)) : "" });
  }
  return withSuggestions(record);
}

export function mapInvalidCacheRow(r: Record<string, unknown>, now = new Date()): InvalidRecord | null {
  if (excluidoFlag(r.Excluido) !== 0) return null;
  const current = officialCurrentEpiWeek(now);
  const currentSe = current.se;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const rawDt = r.DtNotificacao || r.dt_notificacao_raw ? String(r.DtNotificacao || r.dt_notificacao_raw).split("T")[0] : null;
  const dateMatch = rawDt?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsedDate = dateMatch ? new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])) : null;
  const validDate = Boolean(parsedDate && dateMatch && parsedDate.getFullYear() === Number(dateMatch[1]) && parsedDate.getMonth() === Number(dateMatch[2]) - 1 && parsedDate.getDate() === Number(dateMatch[3]));
  const anoData = rawDt ? parseInt(rawDt.slice(0, 4), 10) : null;
  const se = toNumber(r.SemEpidemio);
  const totalCaso = toNumber(r.TotalCaso);
  const totalFaixa =
    (toNumber(r.FxMenorUmAno) ?? 0) +
    (toNumber(r.FxUmQuatro) ?? 0) +
    (toNumber(r.FxCincoNove) ?? 0) +
    (toNumber(r.FxDezQuatorze) ?? 0) +
    (toNumber(r.FxQuizeOuMais) ?? 0);
  const totalSexo = (toNumber(r.SexMasc) ?? 0) + (toNumber(r.SexFem) ?? 0);
  const invalidDisaggregatedField = ["FxMenorUmAno", "FxUmQuatro", "FxCincoNove", "FxDezQuatorze", "FxQuizeOuMais", "SexMasc", "SexFem"]
    .find((field) => r[field] != null && String(r[field]).trim() !== "" &&
      (toNumber(r[field]) == null || !Number.isInteger(toNumber(r[field])) || Number(toNumber(r[field])) < 0));

  let problema = "";
  let issue = "";
  let suggestedField = "";
  let suggestedValue = "";

  if (!rawDt) {
    problema = "data_ausente";
    issue = "Data de notificação ausente";
    suggestedField = "DtNotificacao";
  } else if (!validDate) {
    problema = "dia_impossivel";
    issue = `Data inválida: ${rawDt}`;
    suggestedField = "DtNotificacao";
  } else if (rawDt > today) {
    problema = "data_futura";
    issue = `Data futura: ${rawDt}`;
    suggestedField = "DtNotificacao";
  } else if (anoData != null && anoData < 1990) {
    problema = "ano_impossivel";
    issue = `Ano impossível: ${anoData}`;
    suggestedField = "DtNotificacao";
  } else if (se === null || !Number.isInteger(se) || se > 53 || se < 1) {
    problema = "se_invalida";
    issue = `SE inválida: ${se ?? "não informada"}`;
    suggestedField = "SemEpidemio";
  } else if ((toNumber(r.ANO) ?? anoData) === current.year && se > currentSe) {
    problema = "se_futura";
    issue = `SE futura: ${se} (SE atual: ${currentSe})`;
    suggestedField = "SemEpidemio";
  } else if (!String(r.MunicipioNotificacao ?? "").trim()) {
    problema = "municipio_ausente";
    issue = "Município ausente";
  } else if (!String(r.GVE_NOME ?? "").trim()) {
    problema = "gve_ausente";
    issue = "GVE ausente";
  } else if (totalCaso === null) {
    problema = "sem_casos";
    issue = totalCaso === null ? "TotalCaso não informado" : "Nenhum caso confirmado (TotalCaso = 0)";
  } else if (invalidDisaggregatedField) {
    problema = "contagem_desagregada_invalida";
    issue = `Contagem inválida em ${invalidDisaggregatedField}: ${r[invalidDisaggregatedField]}`;
  } else if (totalCaso === 0 && totalFaixa > 0) {
    problema = "faixa_etaria_divergente";
    issue = `Faixa etária diverge: soma das faixas=${totalFaixa} com TotalCaso=0`;
  } else if (totalCaso === 0 && totalSexo > 0) {
    problema = "sexo_divergente";
    issue = `Sexo diverge: Masc+Fem=${totalSexo} com TotalCaso=0`;
  } else if (totalCaso < 0) {
    problema = "casos_negativos";
    issue = `Total de casos negativo: ${totalCaso}`;
    suggestedField = "TotalCaso";
    suggestedValue = "";
  } else if (totalCaso > 0 && totalFaixa === 0) {
    problema = "faixa_etaria_ausente";
    issue = `Faixa etária ausente: nenhuma faixa informada para ${totalCaso} caso(s)`;
  } else if (!Number.isInteger(totalCaso)) {
    problema = "casos_invalidos";
    issue = `Total de casos inválido: ${totalCaso}`;
    suggestedField = "TotalCaso";
  } else if (totalCaso > 0 && totalFaixa !== totalCaso) {
    problema = "faixa_etaria_divergente";
    issue = `Faixa etária diverge: soma das faixas=${totalFaixa} ≠ TotalCaso=${totalCaso}`;
  } else if (totalCaso > 0 && totalSexo !== totalCaso) {
    problema = "sexo_divergente";
    issue = `Sexo diverge: Masc+Fem=${totalSexo} ≠ TotalCaso=${totalCaso}`;
  } else {
    return null;
  }

  const DATA_TEMPO = new Set(["data_ausente", "dia_impossivel", "data_futura", "ano_impossivel", "se_invalida", "se_futura"]);
  const recordId = recordIdOf(r);
  return conservativeSuggestion({
    recordId,
    pkColumn: "ID",
    controlaSubmit: r.ControlaSubmit != null ? String(r.ControlaSubmit) : null,
    dtNotificacao: rawDt,
    semEpidemio: se,
    municipio: r.MunicipioNotificacao ? String(r.MunicipioNotificacao) : null,
    gve: r.GVE_NOME ? String(r.GVE_NOME) : null,
    // Sem ANO, usa o ano da data só se a data for plausível (evita "4202", "520", NaN)
    ano: toNumber(r.ANO) ?? (validDate && anoData != null && anoData >= 1990 && rawDt! <= today ? anoData : null),
    totalCaso,
    issue,
    issueType: (DATA_TEMPO.has(problema) ? "data_tempo" : "conteudo") as "data_tempo" | "conteudo",
    problem: problema,
    issueKey: `${recordId}#${problema}`,
    suggestedField,
    suggestedValue,
    suggestions: []
  }, now);
}

/** ID do MySQL; registros antigos do cache sem ID ficam marcados para não serem corrigidos. */
function recordIdOf(r: Record<string, unknown>) {
  if (r.ID != null && String(r.ID).trim() !== "") return String(r.ID);
  return `sem-id:${r.id ?? String(r.row_key ?? "").slice(0, 10)}`;
}

export function isMysqlRecordId(recordId: string) {
  return /^\d+$/.test(recordId);
}

const STRUCTURAL_TYPE: Record<StructuralFinding["problem"], InvalidRecord["issueType"]> = {
  ano_errado: "data_tempo",
  se_invalida: "data_tempo",
  se_futura: "data_tempo",
  semana_trocada: "duplicidade",
  duplicata: "duplicidade",
  duplicata_conflito: "duplicidade"
};

function structuralRecord(r: Record<string, unknown>, f: StructuralFinding, rowByKey?: (key: string) => Record<string, unknown> | undefined): InvalidRecord {
  const recordId = recordIdOf(r);
  const ano = toNumber(r.ANO);
  const se = toNumber(r.SemEpidemio);
  const suggestions: InvalidRecord["suggestions"] = [];
  if (f.suggestion && isMysqlRecordId(recordId)) {
    if (f.suggestion.ano !== ano) suggestions.push({ field: "ANO", oldValue: String(ano ?? ""), newValue: String(f.suggestion.ano) });
    if (f.suggestion.se !== se) suggestions.push({ field: "SemEpidemio", oldValue: String(se ?? ""), newValue: String(f.suggestion.se) });
  }
  const rawDt = r.DtNotificacao || r.dt_notificacao_raw ? String(r.DtNotificacao || r.dt_notificacao_raw).split("T")[0] : null;
  return {
    recordId,
    pkColumn: "ID",
    controlaSubmit: r.ControlaSubmit != null ? String(r.ControlaSubmit) : null,
    dtNotificacao: rawDt,
    semEpidemio: se,
    municipio: r.MunicipioNotificacao ? String(r.MunicipioNotificacao) : null,
    gve: r.GVE_NOME ? String(r.GVE_NOME) : null,
    ano,
    totalCaso: toNumber(r.TotalCaso),
    issue: f.issue,
    issueType: STRUCTURAL_TYPE[f.problem],
    problem: f.problem,
    issueKey: `${recordId}#${f.problem}`,
    suggestedField: suggestions.map((x) => x.field).join("/"),
    suggestedValue: suggestions.map((x) => x.newValue).join("/"),
    suggestions,
    group: f.group,
    createdAt: createdAtOf(r),
    groupMembers: f.members && rowByKey
      ? f.members.map(rowByKey).filter((m): m is Record<string, unknown> => Boolean(m)).map(groupMemberOf)
      : undefined
  };
}

/** Regras individuais já cobertas (e melhor sugeridas) pela auditoria por unidade. */
const SUPERSEDED_BY_STRUCTURE = new Set(["se_invalida", "se_futura"]);

/**
 * Audita registros do cache: regras de cada registro + comparação entre registros da
 * mesma unidade (duplicidade, semana trocada, ano errado). `inScope` decide quais
 * registros entram no resultado; os demais servem só de contexto (semanas vizinhas).
 */
export function auditCevespRows(
  rows: Array<Record<string, unknown>>,
  now = new Date(),
  inScope: (row: Record<string, unknown>, anoErrado: boolean) => boolean = () => true
): InvalidRecord[] {
  const active = rows.filter((r) => excluidoFlag(r.Excluido) === 0);
  const structural = auditStructure(active.map((r, i) => ({
    key: String(i),
    ANO: toNumber(r.ANO),
    SemEpidemio: toNumber(r.SemEpidemio),
    DtNotificacao: r.DtNotificacao ? String(r.DtNotificacao).slice(0, 10) : (r.dt_notificacao_raw ? String(r.dt_notificacao_raw) : null),
    createdAt: r.created_at_origem ? String(r.created_at_origem).replace("T", " ") : null,
    unidade: unidadeKey(r),
    conteudo: conteudoKey(r)
  })), now);

  const result: InvalidRecord[] = [];
  active.forEach((r, i) => {
    const found = structural.get(String(i)) ?? [];
    if (!inScope(r, found.some((f) => f.problem === "ano_errado"))) return;
    const single = mapInvalidCacheRow(r, now);
    if (single && !(SUPERSEDED_BY_STRUCTURE.has(single.problem) && found.some((f) => STRUCTURAL_TYPE[f.problem] === "data_tempo"))) {
      const withCreated = { ...single, createdAt: createdAtOf(r) };
      result.push(isMysqlRecordId(single.recordId) ? withCreated : { ...withCreated, suggestions: [], suggestedField: "", suggestedValue: "" });
    }
    for (const f of found) result.push(structuralRecord(r, f, (key) => active[Number(key)]));
    if (!isMysqlRecordId(recordIdOf(r))) {
      result.push({
        ...structuralRecord(r, { problem: "duplicata", issue: "", suggestion: null }),
        issue: "Registro sem ID do MySQL: cache antigo, ressincronize a base (npm run sync-cevesp -- --purge-legacy)",
        issueType: "duplicidade",
        problem: "sem_id",
        issueKey: `${recordIdOf(r)}#sem_id`
      });
    }
  });
  return result;
}

const AUDIT_COLUMNS = 'id,row_key,dt_notificacao_raw,"Excluido","ID","ControlaSubmit","DtNotificacao","SemEpidemio","MunicipioNotificacao","IbgeNotificacao","nCNES","Unid_notificacao","Nome_notificante","GVE_NOME","ANO","TotalCaso","FxMenorUmAno","FxUmQuatro","FxCincoNove","FxDezQuatorze","FxQuizeOuMais","SexMasc","SexFem","Surto"';

async function fetchAuditRows(ano?: number, anoFim?: number, gve?: string) {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const lo = ano ?? anoFim;
  const hi = anoFim && (!ano || anoFim > ano) ? anoFim : ano;

  // full: com data de digitação e ano_suspeito; created: sem ano_suspeito; basic: sem os dois
  type Mode = "full" | "created" | "basic";
  function query(mode: Mode, from: number, count = false) {
    const columns = mode === "full" ? `${AUDIT_COLUMNS},created_at_origem,ano_suspeito`
      : mode === "created" ? `${AUDIT_COLUMNS},created_at_origem` : AUDIT_COLUMNS;
    let q = supabase
      .from("cevesp_notificacoes")
      .select(columns, count ? { count: "exact" } : undefined)
      .order("id")
      .range(from, from + pageSize - 1);
    // O ano anterior entra como contexto (semanas vizinhas na virada do ano). Dos
    // digitados no período, só os de ANO suspeito: a carga em lote de anos antigos não.
    if (lo != null && hi != null) {
      const filters = [`and(ANO.gte.${lo - 1},ANO.lte.${hi})`, "ANO.is.null"];
      if (mode === "full") filters.push(`and(ano_suspeito.is.true,created_at_origem.gte.${lo}-01-01,created_at_origem.lt.${hi + 1}-01-01)`);
      if (mode === "created") filters.push(`and(ANO.gt.${hi},created_at_origem.gte.${lo}-01-01,created_at_origem.lt.${hi + 1}-01-01)`);
      q = q.or(filters.join(",")) as typeof q;
    }
    if (gve) q = q.eq('"GVE_NOME"', gve) as typeof q;
    return q;
  }

  // Primeira página traz o total; as demais são buscadas em paralelo (evita timeout)
  async function run(mode: Mode) {
    const first = await query(mode, 0, true);
    if (first.error) return { rows: [], error: first.error };
    const rows = [...((first.data ?? []) as unknown as Array<Record<string, unknown>>)];
    const total = first.count ?? rows.length;
    const offsets: number[] = [];
    for (let from = pageSize; from < total; from += pageSize) offsets.push(from);
    const CONCURRENCY = 8;
    for (let i = 0; i < offsets.length; i += CONCURRENCY) {
      const pages = await Promise.all(offsets.slice(i, i + CONCURRENCY).map((from) => query(mode, from)));
      for (const page of pages) {
        if (page.error) return { rows, error: page.error };
        for (const row of (page.data ?? []) as unknown as Array<Record<string, unknown>>) rows.push(row);
      }
    }
    return { rows, error: null };
  }

  // Migrações ainda não aplicadas: audita com o que existir no cache
  for (const mode of ["full", "created", "basic"] as Mode[]) {
    const result = await run(mode);
    if (!result.error) return result.rows;
    if (!/ano_suspeito|created_at_origem/.test(result.error.message)) {
      throw new Error(`Erro ao consultar cache CEVESP: ${result.error.message}`);
    }
  }
  throw new Error("Erro ao consultar cache CEVESP.");
}

export async function findInvalidRecordsFromCache(limit?: number, ano?: number, anoFim?: number, gve?: string): Promise<InvalidRecord[]> {
  const rows = await fetchAuditRows(ano, anoFim, gve);
  const lo = ano ?? anoFim;
  const hi = anoFim && (!ano || anoFim > ano) ? anoFim : ano;
  const inScope = (r: Record<string, unknown>, anoErrado: boolean) => {
    if (lo == null || hi == null) return true;
    const a = toNumber(r.ANO);
    if (a != null && a >= lo && a <= hi) return true;
    // Fora do período pelo ANO: entra só se a auditoria confirmou ano errado e o registro
    // foi digitado no período (carga em lote de anos antigos não entra)
    const created = r.created_at_origem ? Number(String(r.created_at_origem).slice(0, 4)) : null;
    return anoErrado && created != null && created >= lo && created <= hi;
  };
  const records = auditCevespRows(rows, new Date(), inScope);
  return limit ? records.slice(0, limit) : records;
}

// Discover primary key column from INFORMATION_SCHEMA
async function getPrimaryKeyColumn(tableName: string, dbName: string): Promise<string> {
  const conn = await createNotificationConnection();
  try {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION
       LIMIT 1`,
      [dbName, tableName]
    );
    const pkRows = rows as Array<Record<string, unknown>>;
    if (!pkRows.length) throw new Error(`Nenhuma chave primária encontrada na tabela ${tableName}.`);
    return String(pkRows[0].COLUMN_NAME);
  } finally {
    await conn.end();
  }
}

/** Quality and completeness use the same synchronized cache and TypeScript rules. */
export async function findInvalidRecords(limit?: number, ano?: number, gve?: string, anoFim?: number): Promise<InvalidRecord[]> {
  return findInvalidRecordsFromCache(limit, ano, anoFim, gve);
}

export async function saveCorrectionsToQueue(
  proposals: CorrectionProposal[],
  userId: string
): Promise<{ saved: number; skipped: number }> {
  const supabase = createAdminClient();
  const tableName = getNotificationTableName();

  // Deduplicate: skip if same record+field already pending
  const { data: existing } = await supabase
    .from("correction_queue")
    .select("record_id, field_name")
    .eq("table_name", tableName)
    .eq("status", "pending");

  const pendingSet = new Set(
    (existing ?? []).map((r: { record_id: string; field_name: string }) => `${r.record_id}::${r.field_name}`)
  );

  const toInsert = proposals.filter(
    (p) => !pendingSet.has(`${p.recordId}::${p.fieldName}`)
  );

  if (!toInsert.length) return { saved: 0, skipped: proposals.length };

  const { error } = await supabase.from("correction_queue").insert(
    toInsert.map((p) => ({
      proposed_by: userId,
      table_name: p.tableName,
      record_id: p.recordId,
      field_name: p.fieldName,
      old_value: p.oldValue,
      new_value: p.newValue,
      reason: p.reason
    }))
  );

  if (error) throw new Error(`Erro ao salvar fila: ${error.message}`);
  return { saved: toInsert.length, skipped: proposals.length - toInsert.length };
}

export async function applyCorrection(correctionId: string, reviewerId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: item, error: fetchErr } = await supabase
    .from("correction_queue")
    .select("*")
    .eq("id", correctionId)
    .eq("status", "approved")
    .single();

  if (fetchErr || !item) throw new Error("Correção não encontrada ou não aprovada.");

  const conn = await createNotificationConnection();
  try {
    // Validate identifiers before using in SQL
    const identPattern = /^[a-zA-Z0-9_]+$/;
    if (!identPattern.test(item.table_name)) throw new Error("table_name inválido.");
    if (!identPattern.test(item.field_name)) throw new Error("field_name inválido.");

    // Só IDs do MySQL: o id interno do cache (Supabase) apontaria para outro registro
    if (!isMysqlRecordId(String(item.record_id))) {
      throw new Error(`Registro ${item.record_id} não tem ID do MySQL; ressincronize o cache antes de corrigir.`);
    }

    // Get PK column
    const pkCol = await getPrimaryKeyColumn(item.table_name, process.env.NOTIFY_DB_NAME!);

    // Só altera se o campo ainda tiver o valor que foi auditado; senão o registro mudou
    // desde a proposta e a correção precisa ser revista.
    const oldValue = String(item.old_value ?? "");
    const guard = oldValue === ""
      ? `(\`${item.field_name}\` IS NULL OR \`${item.field_name}\` = '')`
      : `\`${item.field_name}\` = ?`;
    const [result] = await conn.execute(
      `UPDATE \`${item.table_name}\` SET \`${item.field_name}\` = ? WHERE \`${pkCol}\` = ? AND ${guard}`,
      oldValue === "" ? [item.new_value, item.record_id] : [item.new_value, item.record_id, oldValue]
    );
    if ((result as { affectedRows?: number }).affectedRows !== 1) {
      throw new Error(`Registro ${item.record_id}: ${item.field_name} não está mais com o valor "${oldValue}". Correção não aplicada; revise.`);
    }
  } finally {
    await conn.end();
  }

  const now = new Date().toISOString();
  await supabase
    .from("correction_queue")
    .update({
      status: "applied",
      reviewed_by: reviewerId,
      reviewed_at: now,
      applied_at: now
    })
    .eq("id", correctionId);

  // Write audit entry (best-effort — don't fail the apply if this errors)
  try {
    await supabase.from("correction_audit_log").insert({
      correction_id: correctionId,
      action: "applied",
      applied_by: reviewerId,
      table_name: item.table_name,
      record_id: String(item.record_id),
      field_name: item.field_name,
      old_value: String(item.old_value ?? ""),
      new_value: String(item.new_value),
      applied_at: now
    });
  } catch { /* non-critical */ }
}
