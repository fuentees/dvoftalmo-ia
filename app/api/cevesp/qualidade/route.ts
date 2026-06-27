import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { findInvalidRecords, saveCorrectionsToQueue, type InvalidRecord } from "@/services/cevesp-corrections";
import { getNotificationTableName } from "@/lib/external/notification-db";

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function recordsToCsv(records: InvalidRecord[]) {
  const headers: Array<keyof InvalidRecord> = [
    "recordId",
    "controlaSubmit",
    "dtNotificacao",
    "semEpidemio",
    "ano",
    "municipio",
    "gve",
    "totalCaso",
    "issueType",
    "issue",
    "suggestedField",
    "suggestedValue"
  ];
  const labels = [
    "ID",
    "ControlaSubmit",
    "Data notificacao",
    "Semana epidemiologica",
    "Ano",
    "Municipio",
    "GVE",
    "Total casos",
    "Tipo",
    "Problema",
    "Campo sugerido",
    "Valor sugerido"
  ];
  return [
    labels.join(";"),
    ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(";"))
  ].join("\n");
}

function summarize(records: InvalidRecord[]) {
  const byType: Record<string, number> = {};
  const gveMap: Record<string, number> = {};
  const anoMap: Record<string, number> = {};
  const municipioMap: Record<string, { gve: string | null; count: number }> = {};

  for (const record of records) {
    const typeKey = record.issue.split(":")[0].trim();
    byType[typeKey] = (byType[typeKey] ?? 0) + 1;

    if (record.gve) gveMap[record.gve] = (gveMap[record.gve] ?? 0) + 1;
    if (record.ano) anoMap[String(record.ano)] = (anoMap[String(record.ano)] ?? 0) + 1;
    if (record.municipio) {
      if (!municipioMap[record.municipio]) municipioMap[record.municipio] = { gve: record.gve, count: 0 };
      municipioMap[record.municipio].count++;
    }
  }

  return {
    byType,
    byGve: Object.entries(gveMap)
      .map(([gve, count]) => ({ gve, count }))
      .sort((a, b) => b.count - a.count),
    byAno: Object.entries(anoMap)
      .map(([ano, count]) => ({ ano: Number(ano), count }))
      .sort((a, b) => a.ano - b.ano),
    byMunicipio: Object.entries(municipioMap)
      .map(([municipio, { gve, count }]) => ({ municipio, gve, count }))
      .sort((a, b) => b.count - a.count)
  };
}

function filterRecords(records: InvalidRecord[], issueFilter: string, query: string) {
  const normalizedQuery = normalizeSearch(query);
  return records.filter((record) => {
    const typeKey = record.issue.split(":")[0].trim();
    const matchesIssue = issueFilter === "todos" || typeKey === issueFilter || record.issue.startsWith(issueFilter);
    const matchesQuery = !normalizedQuery || normalizeSearch([
      record.recordId,
      record.dtNotificacao,
      record.semEpidemio,
      record.ano,
      record.municipio,
      record.gve,
      record.totalCaso,
      record.issue,
      record.issueType,
      record.suggestedField,
      record.suggestedValue
    ].join(" ")).includes(normalizedQuery);
    return matchesIssue && matchesQuery;
  });
}

function applyScopeFilters(
  records: InvalidRecord[],
  filters: { municipio?: string; seInicio?: number; seFim?: number }
) {
  const selectedMunicipio = normalizeSearch(filters.municipio);
  return records.filter((record) => {
    const matchesMunicipio = !selectedMunicipio || normalizeSearch(record.municipio).includes(selectedMunicipio);
    const se = typeof record.semEpidemio === "number" ? record.semEpidemio : Number(record.semEpidemio);
    const matchesSeInicio = filters.seInicio == null || (Number.isFinite(se) && se >= filters.seInicio);
    const matchesSeFim = filters.seFim == null || (Number.isFinite(se) && se <= filters.seFim);
    return matchesMunicipio && matchesSeInicio && matchesSeFim;
  });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 500);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);
    const issueFilter = searchParams.get("issue") ?? "todos";
    const query = searchParams.get("q") ?? "";
    const format = searchParams.get("format");
    const anoParam = searchParams.get("ano");
    const ano = anoParam ? Number(anoParam) : undefined;
    const gve = searchParams.get("gve") ?? undefined;
    const municipio = searchParams.get("municipio") ?? undefined;
    const seInicio = searchParams.get("seInicio") ? Number(searchParams.get("seInicio")) : undefined;
    const seFim = searchParams.get("seFim") ? Number(searchParams.get("seFim")) : undefined;

    const records = await findInvalidRecords(undefined, ano, gve);
    const scopedRecords = applyScopeFilters(records, { municipio, seInicio, seFim });
    const filteredRecords = filterRecords(scopedRecords, issueFilter, query);

    if (format === "csv") {
      return new NextResponse(recordsToCsv(filteredRecords), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="cevesp-qualidade-${new Date().toISOString().slice(0, 10)}.csv"`
        }
      });
    }

    return NextResponse.json({
      records: filteredRecords.slice(offset, offset + limit),
      ...summarize(scopedRecords),
      total: scopedRecords.length,
      filteredTotal: filteredRecords.length,
      limit,
      offset,
      source: "cevesp_quality_audit"
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("econnrefused") || msg.toLowerCase().includes("etimedout") || msg.toLowerCase().includes("connect")) {
      return NextResponse.json(
        {
          error: "conexao_falhou",
          message: "Não foi possível conectar ao banco CEVESP. Se estiver fora da rede interna, importe/sincronize a base e consulte pelo cache do Supabase."
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await req.json() as { recordIds?: string[] };

  try {
    const records = await findInvalidRecords();
    const tableName = getNotificationTableName();

    const targets = body.recordIds?.length
      ? records.filter((record) => body.recordIds!.includes(record.recordId))
      : records;

    const proposals = targets
      .filter((record) => record.suggestedField && record.suggestedValue)
      .map((record) => ({
        recordId: record.recordId,
        tableName,
        pkColumn: record.pkColumn,
        fieldName: record.suggestedField,
        oldValue: record.suggestedField === "DtNotificacao"
          ? (record.dtNotificacao ?? "")
          : String(record.semEpidemio ?? ""),
        newValue: record.suggestedValue,
        reason: record.issue
      }));

    const result = await saveCorrectionsToQueue(proposals, user.id);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
