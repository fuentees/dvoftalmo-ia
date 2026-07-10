import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readNotificationRows } from "@/lib/external/notification-db";
import { summarizeNotificationRows, summarizeFromRpc, type RpcRelatorioData } from "@/services/notification-report";
import { runEndemicChannel } from "@/services/cevesp-endemic";
import { generateBulletinDocx, generateBulletinPdf, type CanalEndemicoInput } from "@/services/bulletin";
import { pickCurrentChannelPoint } from "@/lib/epi-week";

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
  const ano      = anoParam ? Number(anoParam) : undefined;
  const gve      = request.nextUrl.searchParams.get("gve")          ?? undefined;
  const municipio = request.nextUrl.searchParams.get("municipio")   ?? undefined;
  const seInicio = request.nextUrl.searchParams.get("seInicio")     ? Number(request.nextUrl.searchParams.get("seInicio")) : undefined;
  const seFim    = request.nextUrl.searchParams.get("seFim")        ? Number(request.nextUrl.searchParams.get("seFim"))   : undefined;
  const format   = request.nextUrl.searchParams.get("format") ?? "docx";

  try {
    const now = new Date();
    const targetYear = ano ?? now.getFullYear();

    const rpcArgs = {
      p_ano: ano ?? null, p_ano_fim: null as null,
      p_gve: gve ?? null, p_municipio: municipio ?? null,
      p_se_inicio: seInicio ?? null, p_se_fim: seFim ?? null
    };

    // ── fetch report + canal endêmico in parallel ──────────────────────────
    const admin = createAdminClient();
    const [relRes, endemicData] = await Promise.allSettled([
      admin.rpc("cevesp_relatorio", rpcArgs),
      runEndemicChannel({ gve, municipality: municipio })
    ]);

    // ── build report summary (RPC or fallback) ─────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let report: any;
    if (relRes.status === "fulfilled" && !relRes.value.error && relRes.value.data) {
      report = summarizeFromRpc(relRes.value.data as RpcRelatorioData, [], null);
    } else {
      const rows = await readNotificationRows({ ano, gve, municipio, seInicio, seFim });
      report = summarizeNotificationRows(rows.rows, rows.total);
    }

    // ── determine current SE ───────────────────────────────────────────────
    const lastWeek = report.indicators.weeklySeries.at(-1);
    let se = dateToSe(now);
    if (lastWeek) {
      const m = lastWeek.week.match(/SE(\d+)$/);
      if (m) se = parseInt(m[1], 10);
    }

    // ── build canal endêmico section ───────────────────────────────────────
    let canalEndemico: CanalEndemicoInput | undefined;
    if (endemicData.status === "fulfilled" && endemicData.value.length > 0) {
      const pts = endemicData.value;
      const pt = pickCurrentChannelPoint(pts);
      if (pt) {
        const cur = pt.currentYear!;
        const zona: CanalEndemicoInput["zona"] =
          cur > pt.q3 ? "epidemia" : cur > pt.q1 ? "alerta" : "sucesso";
        canalEndemico = {
          lastSE: pt.se,
          zona,
          currentCases: cur,
          q1: pt.q1,
          median: pt.median,
          q3: pt.q3,
          weeksAboveQ3: pts.filter((p) => p.currentYear != null && p.currentYear > p.q3).length
        };
      }
    }

    const endLabel = ano && ano < now.getFullYear()
      ? `31 Dez ${ano}`
      : now.toLocaleDateString("pt-BR");
    const period = `1 Jan ${targetYear} a ${endLabel}`;

    const bulletinInput = {
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
      recommendations: report.bulletinSections.recomendacoes,
      canalEndemico
    };

    const gveSuffix = gve ? `_${gve.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}` : "";
    const seSuffix = seInicio || seFim ? `_SE${seInicio ?? 1}-${seFim ?? 53}` : "";
    const baseName = `Boletim_Conjuntivite_SE${String(se).padStart(2, "0")}_${targetYear}${gveSuffix}${seSuffix}`;

    if (format === "pdf") {
      const pdfBytes = await generateBulletinPdf(bulletinInput);
      return new NextResponse(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${baseName}.pdf"`
        }
      });
    }

    const bulletinBuffer = await generateBulletinDocx(bulletinInput);
    return new NextResponse(new Uint8Array(bulletinBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao gerar boletim." },
      { status: 500 }
    );
  }
}
