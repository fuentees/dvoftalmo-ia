import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { auditarSinanTracoma, type SinanAuditResult } from "@/services/sinan-tracoma";

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

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const municipio = searchParams.get("municipio") ?? undefined;
  const gve = searchParams.get("gve") ?? undefined;
  const yearStart = searchParams.get("yearStart") ? Number(searchParams.get("yearStart")) : undefined;
  const yearEnd = searchParams.get("yearEnd") ? Number(searchParams.get("yearEnd")) : undefined;
  const format = searchParams.get("format");

  try {
    const result = await auditarSinanTracoma({ municipio, gve, yearStart, yearEnd });
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
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("sinan_tracoma_rows")) {
      return NextResponse.json(
        { error: "tabela_ausente", message: "A tabela SINAN Tracoma ainda não foi criada. Execute a migration no Supabase SQL Editor." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
