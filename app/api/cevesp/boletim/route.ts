import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { readNotificationRows } from "@/lib/external/notification-db";
import { summarizeNotificationRows } from "@/services/notification-report";
import { generateBulletinDocx } from "@/services/bulletin";

function dateToSe(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000);
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const anoParam = request.nextUrl.searchParams.get("ano");
  const ano = anoParam ? Number(anoParam) : undefined;
  const gve = request.nextUrl.searchParams.get("gve") ?? undefined;
  const municipio = request.nextUrl.searchParams.get("municipio") ?? undefined;
  const seInicio = request.nextUrl.searchParams.get("seInicio") ? Number(request.nextUrl.searchParams.get("seInicio")) : undefined;
  const seFim = request.nextUrl.searchParams.get("seFim") ? Number(request.nextUrl.searchParams.get("seFim")) : undefined;

  try {
    const data = await readNotificationRows({ ano, gve, municipio, seInicio, seFim });
    const report = summarizeNotificationRows(data.rows, data.total);

    const now = new Date();
    const targetYear = ano ?? now.getFullYear();

    // Use last week in series for SE, fallback to current SE
    const lastWeek = report.indicators.weeklySeries.at(-1);
    let se = dateToSe(now);
    if (lastWeek) {
      const match = lastWeek.week.match(/SE(\d+)$/);
      if (match) se = parseInt(match[1], 10);
    }

    const endLabel = ano && ano < now.getFullYear()
      ? `31 Dez ${ano}`
      : now.toLocaleDateString("pt-BR");
    const period = `1 Jan ${targetYear} a ${endLabel}`;

    const bulletinBuffer = await generateBulletinDocx({
      se,
      year: targetYear,
      period,
      indicators: {
        ...report.indicators,
        outbreakTotal: report.indicators.outbreakTotal,
        symptomaticStaffRemoval: report.indicators.symptomaticStaffRemoval
      },
      alerts: report.alerts,
      interpretation: report.interpretation,
      recommendations: report.bulletinSections.recomendacoes
    });

    const gveSuffix = gve ? `_${gve.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}` : "";
    const seSuffix = seInicio || seFim ? `_SE${seInicio ?? 1}-${seFim ?? 53}` : "";
    const filename = `Boletim_Conjuntivite_SE${String(se).padStart(2, "0")}_${targetYear}${gveSuffix}${seSuffix}.docx`;
    return new NextResponse(new Uint8Array(bulletinBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao gerar boletim." },
      { status: 500 }
    );
  }
}
