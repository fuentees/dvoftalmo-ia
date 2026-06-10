import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runCevespAnalysis } from "@/services/cevesp-analytics";
import { getAIConfig } from "@/services/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, unknown> = {};

  // 1. Check Supabase connection and row count
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("cevesp_notificacoes")
      .select("id", { count: "exact", head: true });
    results.supabase_rows = error ? `ERROR: ${error.message}` : count;
  } catch (e) {
    results.supabase_rows = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 2. Check if cevesp_aggregate RPC works
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("cevesp_aggregate", {
      p_metric: "total_casos",
      p_dimension: "gve",
      p_ano_start: 2026,
      p_ano_end: 2026,
      p_se_start: null,
      p_se_end: null,
      p_gve: null,
      p_drs: null,
      p_municipio: null,
      p_lim: 5
    });
    results.cevesp_aggregate_2026 = error ? `ERROR: ${error.message}` : (data ?? []).slice(0, 5);
  } catch (e) {
    results.cevesp_aggregate_2026 = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 3. Check AI config (provider, model, key present)
  try {
    const config = await getAIConfig();
    results.ai_provider = config.provider;
    results.ai_model = config.model;
    results.ai_key_present = !!config.apiKey;
  } catch (e) {
    results.ai_config = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 4. Run full cevesp analysis (same path as consultar_cevesp tool)
  try {
    const analysis = await runCevespAnalysis("quantos casos de conjuntivite temos em 2026?");
    results.cevesp_analysis = {
      rows_count: analysis.rows?.length ?? 0,
      first_3_rows: analysis.rows?.slice(0, 3),
      interpretation: analysis.interpretation
    };
  } catch (e) {
    results.cevesp_analysis = `EXCEPTION: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 5. ENV check
  results.notify_db_host_set = !!process.env.NOTIFY_DB_HOST;
  results.commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

  return NextResponse.json(results, { status: 200 });
}
