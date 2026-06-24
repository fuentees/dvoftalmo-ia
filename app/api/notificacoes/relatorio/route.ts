import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { readNotificationRows } from "@/lib/external/notification-db";
import { summarizeNotificationRows } from "@/services/notification-report";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ano = searchParams.get("ano") ? Number(searchParams.get("ano")) : undefined;
  const gve = searchParams.get("gve") ?? undefined;
  const municipio = searchParams.get("municipio") ?? undefined;
  const seInicio = searchParams.get("seInicio") ? Number(searchParams.get("seInicio")) : undefined;
  const seFim = searchParams.get("seFim") ? Number(searchParams.get("seFim")) : undefined;

  try {
    const data = await readNotificationRows({ ano, gve, municipio, seInicio, seFim });
    const summary = summarizeNotificationRows(data.rows, data.total);

    // Fetch previous year for comparison (only when a specific year is selected)
    let previousYear: { ano: number; totalCases: number; notifications: number; reportingMunicipalities: number } | null = null;
    if (ano) {
      try {
        const prevData = await readNotificationRows({ ano: ano - 1, gve, municipio, seInicio, seFim });
        const prevCases = prevData.rows.reduce((sum, row) => sum + Number(row.TotalCaso ?? 0), 0);
        const prevMunicipios = new Set(
          prevData.rows.map((r) => String(r.MunicipioNotificacao ?? "").trim()).filter(Boolean)
        ).size;
        previousYear = {
          ano: ano - 1,
          totalCases: prevCases,
          notifications: prevData.rows.length,
          reportingMunicipalities: prevMunicipios
        };
      } catch {
        // non-critical — main report succeeds even if prev-year fetch fails
      }
    }

    return NextResponse.json({ ...summary, previousYear });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao conectar ao banco de notificacoes.",
        hint: "Confirme se o servidor MariaDB esta acessivel pela maquina que roda o Next.js e se o usuario possui permissao somente leitura."
      },
      { status: 500 }
    );
  }
}
