import { createNotificationConnection, getNotificationTableName } from "@/lib/external/notification-db";
import { createAdminClient } from "@/lib/supabase/admin";

export interface InvalidRecord {
  recordId: string;
  pkColumn: string;
  dtNotificacao: string | null;
  semEpidemio: number | null;
  municipio: string | null;
  issue: string;
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

export async function findInvalidRecords(limit = 100): Promise<InvalidRecord[]> {
  const tableName = getNotificationTableName();
  const dbName = process.env.NOTIFY_DB_NAME!;
  const conn = await createNotificationConnection();

  try {
    const pkCol = await getPrimaryKeyColumn(tableName, dbName);
    const now = new Date();
    const currentYear = now.getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const currentSe = Math.ceil(
      ((now.getTime() - startOfYear.getTime()) / 86_400_000 + startOfYear.getDay() + 1) / 7
    );

    const [rows] = await conn.query(
      `SELECT \`${pkCol}\`, DtNotificacao, SemEpidemio, MunicipioNotificacao
       FROM \`${tableName}\`
       WHERE DtNotificacao > CURDATE()
          OR year(DtNotificacao) < 1990
          OR SemEpidemio > 53
          OR SemEpidemio < 1
          OR (year(DtNotificacao) = ? AND SemEpidemio > ?)
       LIMIT ?`,
      [currentYear, currentSe, limit]
    );

    return (rows as Array<Record<string, unknown>>).map((r) => {
      const ano = r.DtNotificacao ? new Date(String(r.DtNotificacao)).getFullYear() : null;
      const se = r.SemEpidemio != null ? Number(r.SemEpidemio) : null;

      let issue = "";
      let suggestedField = "";
      let suggestedValue = "";

      if (r.DtNotificacao && new Date(String(r.DtNotificacao)) > now) {
        issue = `Data futura: ${r.DtNotificacao}`;
        suggestedField = "DtNotificacao";
        // Suggest same day/month but in current year
        const d = new Date(String(r.DtNotificacao));
        d.setFullYear(currentYear);
        suggestedValue = d.toISOString().split("T")[0];
      } else if (ano !== null && ano < 1990) {
        issue = `Ano impossível: ${ano}`;
        suggestedField = "DtNotificacao";
        const d = new Date(String(r.DtNotificacao));
        d.setFullYear(currentYear);
        suggestedValue = d.toISOString().split("T")[0];
      } else if (se !== null && (se > 53 || se < 1)) {
        issue = `SE inválida: ${se}`;
        suggestedField = "SemEpidemio";
        suggestedValue = String(Math.min(currentSe, 53));
      } else if (se !== null && ano === currentYear && se > currentSe) {
        issue = `SE futura: ${se} (SE atual: ${currentSe})`;
        suggestedField = "SemEpidemio";
        suggestedValue = String(currentSe);
      }

      return {
        recordId: String(r[pkCol]),
        pkColumn: pkCol,
        dtNotificacao: r.DtNotificacao ? String(r.DtNotificacao).split("T")[0] : null,
        semEpidemio: se,
        municipio: r.MunicipioNotificacao ? String(r.MunicipioNotificacao) : null,
        issue,
        suggestedField,
        suggestedValue
      };
    });
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

  await supabase
    .from("correction_queue")
    .update({
      status: "applied",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      applied_at: new Date().toISOString()
    })
    .eq("id", correctionId);
}
