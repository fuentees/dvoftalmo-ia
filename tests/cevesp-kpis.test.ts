import assert from "node:assert/strict";
import { currentEpiWeek, shiftEpiWeek } from "../lib/epi-week";
import { fetchCevespKpis } from "../services/cevesp-kpis";

async function main() {
  const originalFetch = globalThis.fetch;
  const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NOTIFY_DB_HOST"] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role";
  delete process.env.NOTIFY_DB_HOST;
  const current = currentEpiWeek();
  const previous = shiftEpiWeek(current.year, current.se, -1);
  let mode: "missingWeek" | "observedZero" | "invalidCount" | "missingCountHeader" | "invalidRpc" = "missingWeek";
  const reports: Array<Record<string, number>> = [];
  const headFilters: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.hostname, "fixture.supabase.co", "The test must never contact a real integration");
    if (url.pathname.endsWith("/cevesp_notificacoes") && init?.method === "HEAD") {
      headFilters.push(url.search);
      const count = mode === "invalidCount" && url.searchParams.get("TotalCaso") === "is.null" ? 1 : 0;
      return new Response(null, { status: 200, headers: mode === "missingCountHeader" ? {} : { "content-range": `*/${count}` } });
    }
    if (url.pathname.endsWith("/rpc/cevesp_relatorio")) {
      const params = JSON.parse(String(init?.body)) as Record<string, number>;
      reports.push(params);
      const isCurrentWeek = params.p_ano === current.year && params.p_se_inicio === current.se && params.p_se_fim === current.se;
      return Response.json({
        total_notifications: isCurrentWeek && mode === "missingWeek" ? 0 : 1,
        total_cases: mode === "invalidRpc" ? null : isCurrentWeek ? 0 : 10,
        outbreak_notifications: 0, bio_collection_total: 0, top_municipios: []
      });
    }
    if (url.pathname.endsWith("/rpc/cevesp_status_resumo")) {
      return Response.json([{ total_rows: 1, total_cases: 10, anos: [current.year], municipios: 1, gves: 1 }]);
    }
    if (url.pathname.endsWith("/cevesp_sync_log")) return Response.json([{ synced_at: "2026-01-01T12:00:00Z" }]);
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  try {
    const missing = await fetchCevespKpis();
    assert.equal(missing.currentWeek.notifications, 0);
    assert.equal(missing.weekDelta, null, "No notifications must not imply a 100% reduction in cases");
    assert.equal(missing.lastSync, "2026-01-01T12:00:00Z");
    assert.ok(reports.some((params) => params.p_ano === previous.year && params.p_se_inicio === previous.se && params.p_se_fim === previous.se));
    assert.ok(reports.some((params) => params.p_ano === current.year - 1 && params.p_se_inicio === 1 && params.p_se_fim === current.se));
    assert.ok(headFilters.every((query) => new URLSearchParams(query).get("or") === "(Excluido.is.null,Excluido.eq.0)"));
    mode = "observedZero";
    const zero = await fetchCevespKpis();
    assert.equal(zero.currentWeek.notifications, 1);
    assert.equal(zero.weekDelta, -100, "An explicit observed zero remains a valid comparison");
    mode = "invalidCount";
    await assert.rejects(fetchCevespKpis(), /ausentes ou negativas/);
    mode = "missingCountHeader";
    await assert.rejects(fetchCevespKpis(), /verificar a qualidade/);
    mode = "invalidRpc";
    await assert.rejects(fetchCevespKpis(), /Resposta CEVESP inválida/);
    console.log("CEVESP KPI source-contract tests passed");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
