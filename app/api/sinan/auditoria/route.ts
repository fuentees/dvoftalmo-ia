import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { auditarSinanTracoma, type SinanAuditResult } from "@/services/sinan-tracoma";
import { currentCalendarYear } from "@/lib/epi-week";
import { validateTracomaFilters, type TracomaFilter } from "@/lib/tracoma-data";

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function auditToCsv(result: SinanAuditResult) {
  const rows: string[][] = [[
    "tipo",
    "prioridade",
    "banco",
    "nu_notific",
    "row_key",
    "municipio",
    "gve",
    "ano",
    "campo",
    "detalhe"
  ]];

  for (const item of result.correctionRecords ?? []) {
    rows.push([
      item.problem,
      item.priority,
      item.sourceBank.toUpperCase(),
      item.notificationId ?? "",
      item.rowKey ?? "",
      item.municipioNome || item.municipio,
      item.gve,
      item.ano != null ? String(item.ano) : "",
      item.field,
      item.recommendation
    ]);
  }

  for (const item of result.crossBankDivergences ?? []) {
    rows.push([
      "Divergência TRACONET x NOTTRACONET",
      item.risco,
      "TRACONET/NOTTRACONET",
      "",
      "",
      item.municipioNome || item.municipio,
      item.gve,
      String(item.ano),
      "casos positivos",
      `individuais=${item.traconet}; consolidados=${item.nottraconet}; diferença=${item.diff}`
    ]);
  }

  for (const item of result.duplicateNotificationIds ?? []) {
    rows.push([
      "Possível duplicidade do mesmo caso",
      "Critica",
      "TRACONET",
      item.id,
      item.caseKey,
      item.municipio,
      "",
      String(item.ano || ""),
      "NU_NOTIFIC + iniciais + mãe + nascimento + ano",
      `${item.count} repetição(ões); iniciais=${item.iniciais}; nascimento=${item.dataNascimento}`
    ]);
  }

  return rows.map((row) => row.map(csvEscape).join(";")).join("\n");
}

function emptyAuditResult(message: string): SinanAuditResult & { missingData: true; message: string } {
  return {
    missingData: true,
    message,
    totalTraconet: 0,
    totalNottraconetRows: 0,
    totalNottraconet: 0,
    totalTraconetComparable: 0,
    totalTraconetPositive: 0,
    totalTraconetInvalidYear: 0,
    totalNottraconetInvalidYear: 0,
    consolidatedMetrics: {},
    consolidatedMetricsByYear: [],
    diagnostico: {
      traconet: { colunas: [], municipiosAmostra: [], anosAmostra: [], camposPreenchidos: [], camposNumericos: [] },
      nottraconet: { colunas: [], municipiosAmostra: [], anosAmostra: [], camposPreenchidos: [], camposNumericos: [] },
      aviso: message
    },
    crossBankDivergences: [],
    comparisonsByMunicipalityYear: [],
    divergencesByYear: [],
    divergencesByGve: [],
    fieldCompleteness: {},
    fieldCompletenessNottraconet: {},
    fieldCompletenessByGve: [],
    fieldCompletenessByYear: [],
    casosComFormaClinica: 0,
    casosSemFormaPositiva: 0,
    formaClinicaResumo: [],
    semGraduacao: 0,
    semTratamento: 0,
    semConclusao: 0,
    tfSemTratamento: 0,
    ttSemCircurgia: 0,
    ttSemTs: 0,
    anoImpossivel: 0,
    semFormaClinicaDetalhe: [],
    ttSemTsDetalhe: [],
    consolidatedPositiveField: null,
    consolidatedRowsWithoutPositiveField: 0,
    duplicateNotificationIds: [],
    missingNotificationId: 0,
    correctionRecords: [],
    recommendations: [message]
  };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const municipio = searchParams.get("municipio") ?? undefined;
  const gve = searchParams.get("gve") ?? undefined;
  let filters: TracomaFilter;
  try {
    filters = validateTracomaFilters({ municipio, gve, yearStart: searchParams.get("yearStart"), yearEnd: searchParams.get("yearEnd") });
    // Sem ano informado, audita os dois últimos anos: a base inteira levava mais de um minuto
    if (!filters.yearStart && !filters.yearEnd) {
      const year = currentCalendarYear();
      filters = { ...filters, yearStart: year - 1, yearEnd: year };
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const format = searchParams.get("format");

  try {
    const result = await auditarSinanTracoma(filters);
    if (format === "csv") {
      return new NextResponse("\uFEFF" + auditToCsv(result), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="sinan-tracoma-qualidade-${new Date().toISOString().slice(0, 10)}.csv"`
        }
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("Falha na auditoria SINAN Tracoma", err);
    const message = "Não foi possível carregar a auditoria. Tente novamente ou verifique a sincronização do SINAN Tracoma.";
    return NextResponse.json({ ...emptyAuditResult(message), error: message }, { status: 503 });
  }
}
