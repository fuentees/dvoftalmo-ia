import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { readNotificationRows } from "@/lib/external/notification-db";
import { summarizeNotificationRows } from "@/services/notification-report";
import { generateBulletinDocx } from "@/services/bulletin";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const data = await readNotificationRows();
    const report = summarizeNotificationRows(data.rows, data.total);

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
    const se = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    const period = `1 Jan ${now.getFullYear()} a ${now.toLocaleDateString("pt-BR")}`;

    const bulletinBuffer = await generateBulletinDocx({
      se,
      year: now.getFullYear(),
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

    const filename = `Boletim_Conjuntivite_SE${String(se).padStart(2, "0")}_${now.getFullYear()}.docx`;
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
