import { createNotificationConnection, getNotificationTableName, isNotificationConnectionError } from "@/lib/external/notification-db";
import { createAdminClient } from "@/lib/supabase/admin";

export interface InvalidRecord {
  recordId: string;
  pkColumn: string;
  dtNotificacao: string | null;
  semEpidemio: number | null;
  municipio: string | null;
  gve: string | null;
  ano: number | null;
  totalCaso: number | null;
  issue: string;
  issueType: "data_tempo" | "conteudo";
  suggestedField: string;
  suggestedValue: string;
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

function currentEpiWeek() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now.getTime() - startOfYear.getTime()) / 86_400_000 + startOfYear.getDay() + 1) / 7);
}

function mapInvalidCacheRow(r: Record<string, unknown>): InvalidRecord | null {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentSe = currentEpiWeek();
  const rawDt = r.DtNotificacao ? String(r.DtNotificacao).split("T")[0] : null;
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

  let problema = "";
  let issue = "";
  let suggestedField = "";
  let suggestedValue = "";

  if (rawDt && anoData && anoData > currentYear) {
    problema = "data_futura";
    issue = `Data futura: ${rawDt}`;
    suggestedField = "DtNotificacao";
    const d = new Date(rawDt);
    d.setFullYear(currentYear);
    suggestedValue = d.toISOString().split("T")[0];
  } else if (rawDt && anoData && anoData < 1990) {
    problema = "ano_impossivel";
    issue = `Ano impossível: ${anoData}`;
    suggestedField = "DtNotificacao";
    const d = new Date(rawDt);
    d.setFullYear(currentYear);
    suggestedValue = d.toISOString().split("T")[0];
  } else if (se !== null && (se > 53 || se < 1)) {
    problema = se > 53 ? "se_alta" : "se_baixa";
    issue = `SE inválida: ${se}`;
    suggestedField = "SemEpidemio";
    suggestedValue = String(Math.min(currentSe, 53));
  } else if (anoData === currentYear && se !== null && se > currentSe) {
    problema = "se_futura";
    issue = `SE futura: ${se} (SE atual: ${currentSe})`;
    suggestedField = "SemEpidemio";
    suggestedValue = String(currentSe);
  } else if (!String(r.MunicipioNotificacao ?? "").trim()) {
    problema = "municipio_ausente";
    issue = "Município ausente";
  } else if (!String(r.GVE_NOME ?? "").trim()) {
    problema = "gve_ausente";
    issue = "GVE ausente";
  } else if (totalCaso === null) {
    problema = "sem_casos";
    issue = totalCaso === null ? "TotalCaso não informado" : "Nenhum caso confirmado (TotalCaso = 0)";
  } else if (totalCaso === 0 && totalFaixa > 0) {
    problema = "faixa_etaria_divergente";
    issue = `Faixa etaria diverge: soma das faixas=${totalFaixa} com TotalCaso=0`;
  } else if (totalCaso === 0 && totalSexo > 0) {
    problema = "sexo_divergente";
    issue = `Sexo diverge: Masc+Fem=${totalSexo} com TotalCaso=0`;
  } else if (totalCaso < 0) {
    problema = "casos_negativos";
    issue = `Total de casos negativo: ${totalCaso}`;
    suggestedField = "TotalCaso";
    suggestedValue = "0";
  } else if (totalCaso > 0 && totalFaixa === 0) {
    problema = "faixa_etaria_ausente";
    issue = `Faixa etária ausente (${totalFaixa} informado para ${totalCaso} caso(s))`;
  } else if (totalCaso > 0 && totalSexo !== totalCaso) {
    problema = "sexo_divergente";
    issue = `Sexo diverge: Masc+Fem=${totalSexo} ≠ TotalCaso=${totalCaso}`;
  } else {
    return null;
  }

  const DATA_TEMPO = new Set(["data_futura", "ano_impossivel", "se_alta", "se_baixa", "se_futura"]);
  return {
    recordId: String(r.id ?? r.row_key ?? `${r.DtNotificacao ?? ""}-${r.MunicipioNotificacao ?? ""}`),
    pkColumn: "id",
    dtNotificacao: rawDt,
    semEpidemio: se,
    municipio: r.MunicipioNotificacao ? String(r.MunicipioNotificacao) : null,
    gve: r.GVE_NOME ? String(r.GVE_NOME) : null,
    ano: toNumber(r.ANO) ?? anoData,
    totalCaso,
    issue,
    issueType: (DATA_TEMPO.has(problema) ? "data_tempo" : "conteudo") as "data_tempo" | "conteudo",
    suggestedField,
    suggestedValue
  };
}

async function findInvalidRecordsFromCache(limit?: number): Promise<InvalidRecord[]> {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const invalid: InvalidRecord[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("cevesp_notificacoes")
      .select('id,row_key,"DtNotificacao","SemEpidemio","MunicipioNotificacao","GVE_NOME","ANO","TotalCaso","FxMenorUmAno","FxUmQuatro","FxCincoNove","FxDezQuatorze","FxQuizeOuMais","SexMasc","SexFem"')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Erro ao consultar cache CEVESP: ${error.message}`);

    for (const row of data ?? []) {
      const mapped = mapInvalidCacheRow(row as Record<string, unknown>);
      if (mapped) invalid.push(mapped);
      if (limit && invalid.length >= limit) return invalid.slice(0, limit);
    }

    if (!data || data.length < pageSize) break;
  }

  return invalid;
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

export async function findInvalidRecords(limit?: number): Promise<InvalidRecord[]> {
  let tableName: string;
  let conn: Awaited<ReturnType<typeof createNotificationConnection>>;
  try {
    tableName = getNotificationTableName();
    conn = await createNotificationConnection();
  } catch (error) {
    if (isNotificationConnectionError(error) || !process.env.NOTIFY_DB_HOST) {
      return findInvalidRecordsFromCache(limit);
    }
    throw error;
  }
  const dbName = process.env.NOTIFY_DB_NAME!;

  try {
    const pkCol = await getPrimaryKeyColumn(tableName, dbName);
    const now = new Date();
    const currentYear = now.getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const currentSe = Math.ceil(
      ((now.getTime() - startOfYear.getTime()) / 86_400_000 + startOfYear.getDay() + 1) / 7
    );

    const sql = `SELECT \`${pkCol}\`,
              DtNotificacao, SemEpidemio, MunicipioNotificacao,
              GVE_NOME, ANO, TotalCaso,
              COALESCE(FxMenorUmAno,0)+COALESCE(FxUmQuatro,0)+COALESCE(FxCincoNove,0)+COALESCE(FxDezQuatorze,0)+COALESCE(FxQuizeOuMais,0) AS total_faixa,
              COALESCE(SexMasc,0)+COALESCE(SexFem,0) AS total_sexo,
              CASE
                WHEN DtNotificacao IS NOT NULL
                     AND CAST(DtNotificacao AS CHAR) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                     AND STR_TO_DATE(CAST(DtNotificacao AS CHAR), '%Y-%m-%d') IS NULL
                  THEN 'dia_impossivel'
                WHEN DtNotificacao > CURDATE()       THEN 'data_futura'
                WHEN year(DtNotificacao) < 1990      THEN 'ano_impossivel'
                WHEN SemEpidemio > 53                THEN 'se_alta'
                WHEN SemEpidemio < 1                 THEN 'se_baixa'
                WHEN year(DtNotificacao) = ? AND SemEpidemio > ? THEN 'se_futura'
                WHEN MunicipioNotificacao IS NULL OR TRIM(MunicipioNotificacao) = '' THEN 'municipio_ausente'
                WHEN GVE_NOME IS NULL OR TRIM(GVE_NOME) = ''  THEN 'gve_ausente'
                WHEN TotalCaso IS NULL                         THEN 'sem_casos'
                WHEN TotalCaso < 0                             THEN 'casos_negativos'
                WHEN TotalCaso = 0
                     AND (COALESCE(FxMenorUmAno,0)+COALESCE(FxUmQuatro,0)+COALESCE(FxCincoNove,0)+COALESCE(FxDezQuatorze,0)+COALESCE(FxQuizeOuMais,0)) > 0
                  THEN 'faixa_etaria_divergente'
                WHEN TotalCaso = 0
                     AND (COALESCE(SexMasc,0)+COALESCE(SexFem,0)) > 0
                  THEN 'sexo_divergente'
                WHEN TotalCaso > 0
                     AND (COALESCE(FxMenorUmAno,0)+COALESCE(FxUmQuatro,0)+COALESCE(FxCincoNove,0)+COALESCE(FxDezQuatorze,0)+COALESCE(FxQuizeOuMais,0)) = 0
                  THEN 'faixa_etaria_ausente'
                WHEN TotalCaso > 0
                     AND (COALESCE(SexMasc,0)+COALESCE(SexFem,0)) <> TotalCaso
                  THEN 'sexo_divergente'
                ELSE 'outro'
              END AS problema
       FROM \`${tableName}\`
       WHERE (
              DtNotificacao IS NOT NULL
              AND CAST(DtNotificacao AS CHAR) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              AND STR_TO_DATE(CAST(DtNotificacao AS CHAR), '%Y-%m-%d') IS NULL
             )
          OR DtNotificacao > CURDATE()
          OR year(DtNotificacao) < 1990
          OR SemEpidemio > 53
          OR SemEpidemio < 1
          OR (year(DtNotificacao) = ? AND SemEpidemio > ?)
          OR (MunicipioNotificacao IS NULL OR TRIM(MunicipioNotificacao) = '')
          OR (GVE_NOME IS NULL OR TRIM(GVE_NOME) = '')
          OR TotalCaso IS NULL
          OR TotalCaso < 0
          OR (TotalCaso = 0 AND (COALESCE(FxMenorUmAno,0)+COALESCE(FxUmQuatro,0)+COALESCE(FxCincoNove,0)+COALESCE(FxDezQuatorze,0)+COALESCE(FxQuizeOuMais,0)) > 0)
          OR (TotalCaso = 0 AND (COALESCE(SexMasc,0)+COALESCE(SexFem,0)) > 0)
          OR (TotalCaso > 0 AND (COALESCE(FxMenorUmAno,0)+COALESCE(FxUmQuatro,0)+COALESCE(FxCincoNove,0)+COALESCE(FxDezQuatorze,0)+COALESCE(FxQuizeOuMais,0)) = 0)
          OR (TotalCaso > 0 AND (COALESCE(SexMasc,0)+COALESCE(SexFem,0)) <> TotalCaso)
       ${limit ? "LIMIT ?" : ""}`;
    const queryParams: unknown[] = [currentYear, currentSe, currentYear, currentSe];
    if (limit) queryParams.push(limit);
    const [rows] = await conn.query(sql, queryParams);

    const DATA_TEMPO = new Set(["dia_impossivel", "data_futura", "ano_impossivel", "se_alta", "se_baixa", "se_futura"]);

    return (rows as Array<Record<string, unknown>>).map((r) => {
      const problema   = String(r.problema ?? "");
      const rawDt      = r.DtNotificacao ? String(r.DtNotificacao).split("T")[0] : null;
      const anoData    = rawDt ? parseInt(rawDt.slice(0, 4), 10) : null;
      const se         = r.SemEpidemio  != null ? Number(r.SemEpidemio)  : null;
      const totalCaso  = r.TotalCaso    != null ? Number(r.TotalCaso)    : null;
      const totalFaixa = r.total_faixa  != null ? Number(r.total_faixa)  : null;
      const totalSexo  = r.total_sexo   != null ? Number(r.total_sexo)   : null;

      let issue          = "";
      let suggestedField = "";
      let suggestedValue = "";

      if (problema === "dia_impossivel" && rawDt) {
        const [y, m] = rawDt.split("-").map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        issue = `Dia impossível: ${rawDt} (${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][m-1]} tem ${lastDay} dias)`;
        suggestedField = "DtNotificacao";
        suggestedValue = `${y}-${String(m).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
      } else if (problema === "data_futura" && rawDt) {
        issue = `Data futura: ${rawDt}`;
        suggestedField = "DtNotificacao";
        const d = new Date(rawDt); d.setFullYear(currentYear);
        suggestedValue = d.toISOString().split("T")[0];
      } else if (problema === "ano_impossivel" && rawDt) {
        issue = `Ano impossível: ${anoData}`;
        suggestedField = "DtNotificacao";
        const d = new Date(rawDt); d.setFullYear(currentYear);
        suggestedValue = d.toISOString().split("T")[0];
      } else if (se !== null && (problema === "se_alta" || problema === "se_baixa")) {
        issue = `SE inválida: ${se}`;
        suggestedField = "SemEpidemio";
        suggestedValue = String(Math.min(currentSe, 53));
      } else if (se !== null && problema === "se_futura") {
        issue = `SE futura: ${se} (SE atual: ${currentSe})`;
        suggestedField = "SemEpidemio";
        suggestedValue = String(currentSe);
      } else if (problema === "municipio_ausente") {
        issue = "Município ausente";
      } else if (problema === "gve_ausente") {
        issue = "GVE ausente";
      } else if (problema === "sem_casos") {
        issue = totalCaso === null ? "TotalCaso não informado" : "Nenhum caso confirmado (TotalCaso = 0)";
      } else if (problema === "casos_negativos") {
        issue = `Total de casos negativo: ${totalCaso}`;
        suggestedField = "TotalCaso";
        suggestedValue = "0";
      } else if (problema === "faixa_etaria_divergente") {
        issue = `Faixa etaria diverge: soma das faixas=${totalFaixa ?? 0} com TotalCaso=0`;
      } else if (problema === "faixa_etaria_ausente") {
        issue = `Faixa etária ausente (${totalFaixa ?? 0} informado para ${totalCaso} caso(s))`;
      } else if (problema === "sexo_divergente") {
        issue = `Sexo diverge: Masc+Fem=${totalSexo} ≠ TotalCaso=${totalCaso}`;
      }

      return {
        recordId:      String(r[pkCol]),
        pkColumn:      pkCol,
        dtNotificacao: rawDt,
        semEpidemio:   se,
        municipio:     r.MunicipioNotificacao ? String(r.MunicipioNotificacao) : null,
        gve:           r.GVE_NOME            ? String(r.GVE_NOME)             : null,
        ano:           r.ANO                 ? Number(r.ANO)                  : null,
        totalCaso,
        issue,
        issueType: (DATA_TEMPO.has(problema) ? "data_tempo" : "conteudo") as "data_tempo" | "conteudo",
        suggestedField,
        suggestedValue
      };
    });
  } catch (error) {
    if (isNotificationConnectionError(error)) {
      return findInvalidRecordsFromCache(limit);
    }
    throw error;
  } finally {
    await conn.end();
  }
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

    // Get PK column
    const pkCol = await getPrimaryKeyColumn(item.table_name, process.env.NOTIFY_DB_NAME!);

    await conn.execute(
      `UPDATE \`${item.table_name}\` SET \`${item.field_name}\` = ? WHERE \`${pkCol}\` = ?`,
      [item.new_value, item.record_id]
    );
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
