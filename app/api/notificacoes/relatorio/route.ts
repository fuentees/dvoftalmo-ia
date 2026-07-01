import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readNotificationRows } from "@/lib/external/notification-db";
import { summarizeNotificationRows, summarizeFromRpc, type RpcRelatorioData } from "@/services/notification-report";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ano = searchParams.get("ano") ? Number(searchParams.get("ano")) : undefined;
  const anoFim = searchParams.get("anoFim") ? Number(searchParams.get("anoFim")) : undefined;
  const gve = searchParams.get("gve") ?? undefined;
  const municipio = searchParams.get("municipio") ?? undefined;
  const seInicio = searchParams.get("seInicio") ? Number(searchParams.get("seInicio")) : undefined;
  const seFim = searchParams.get("seFim") ? Number(searchParams.get("seFim")) : undefined;

  // ── RPC path: aggregation happens in the database ─────────────────────────
  // Replaces three separate raw-row fetches (current year + all years + prev year)
  // with three parallel RPC calls that return only the pre-computed result.
  try {
    const admin = createAdminClient();
    const rpcArgs = {
      p_ano: ano ?? null,
      p_ano_fim: anoFim ?? null,
      p_gve: gve ?? null,
      p_municipio: municipio ?? null,
      p_se_inicio: seInicio ?? null,
      p_se_fim: seFim ?? null
    };
    const mediaArgs = {
      p_gve: gve ?? null,
      p_municipio: municipio ?? null,
      p_se_inicio: seInicio ?? null,
      p_se_fim: seFim ?? null
    };
    const prevArgs = {
      p_ano: ano != null ? ano - 1 : null,
      p_ano_fim: null as null,
      p_gve: gve ?? null,
      p_municipio: municipio ?? null,
      p_se_inicio: seInicio ?? null,
      p_se_fim: seFim ?? null
    };

    const [relRes, mediaRes, prevRes] = await Promise.all([
      admin.rpc("cevesp_relatorio", rpcArgs),
      admin.rpc("cevesp_media_semanal", mediaArgs),
      ano != null
        ? admin.rpc("cevesp_relatorio", prevArgs)
        : Promise.resolve({ data: null, error: null })
    ]);

    if (!relRes.error && relRes.data) {
      const rpc = relRes.data as RpcRelatorioData;
      const weeklyAvg = !mediaRes.error && Array.isArray(mediaRes.data) ? mediaRes.data as Array<{ se: number; media: number }> : [];

      let previousYear: { ano: number; totalCases: number; notifications: number; reportingMunicipalities: number } | null = null;
      if (ano != null && !prevRes.error && prevRes.data) {
        const prev = prevRes.data as RpcRelatorioData;
        previousYear = {
          ano: ano - 1,
          totalCases: Number(prev.total_cases),
          notifications: Number(prev.total_notifications),
          reportingMunicipalities: Number(prev.reporting_municipalities)
        };
      }

      return NextResponse.json(summarizeFromRpc(rpc, weeklyAvg, previousYear));
    }
    // If RPC returned an error (e.g. functions not yet deployed), fall through to raw rows.
  } catch {
    // Unexpected error in RPC path — fall through to raw rows fallback.
  }

  // ── Fallback: raw rows (used before RPCs are deployed or on MySQL source) ──
  // NOTE: allYearsRows (historical average) is intentionally skipped here to avoid
  // fetching 300k+ rows via pagination. weeklyAverage will be empty in fallback mode.
  try {
    const data = await readNotificationRows({ ano, anoFim, gve, municipio, seInicio, seFim });
    const summary = summarizeNotificationRows(data.rows, data.total);

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
        // non-critical
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
