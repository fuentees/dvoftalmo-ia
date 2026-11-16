import assert from "node:assert/strict";
import { runCevespAnalysisCached, summarizeCachedDistributionRows } from "../lib/external/supabase-cevesp";

const sexFields = ["SexMasc", "SexFem"];
const complete = summarizeCachedDistributionRows([{ TotalCaso: 10, SexMasc: 4, SexFem: 6 }], sexFields);
assert.equal(complete.quality.status, "complete");
assert.equal(complete.quality.informedCases, 10);
assert.equal(summarizeCachedDistributionRows([{ TotalCaso: 10, SexMasc: 3, SexFem: null }], sexFields).quality.status, "partial");
assert.equal(summarizeCachedDistributionRows([{ TotalCaso: 10, SexMasc: null, SexFem: null }], sexFields).quality.status, "unavailable", "Missing source fields cannot establish a zero profile");
const cancellation = summarizeCachedDistributionRows([
  { TotalCaso: 10, SexMasc: 15, SexFem: 0 },
  { TotalCaso: 10, SexMasc: 5, SexFem: 0 },
], sexFields);
assert.equal(cancellation.quality.informedCases, 20);
assert.equal(cancellation.quality.totalCases, 20);
assert.equal(cancellation.quality.invalidRows, 1);
assert.equal(cancellation.quality.status, "inconsistent", "Matching aggregate totals must not conceal a row with more classified cases than total cases");
assert.equal(summarizeCachedDistributionRows([
  { TotalCaso: 10, SexMasc: -5, SexFem: 10 },
  { TotalCaso: 10, SexMasc: 5, SexFem: 0 },
], sexFields).quality.status, "inconsistent", "Negative values must not cancel valid source counts");
for (const TotalCaso of [null, "", -1, 1.5, "bad"]) {
  assert.equal(summarizeCachedDistributionRows([{ TotalCaso, SexMasc: 0, SexFem: 0 }], sexFields).quality.status, "inconsistent");
}
const ageFields = ["FxMenorUmAno", "FxUmQuatro", "FxCincoNove", "FxDezQuatorze", "FxQuizeOuMais"];
const age = summarizeCachedDistributionRows([
  { TotalCaso: 10, FxMenorUmAno: 11, FxUmQuatro: 0 },
  { TotalCaso: 10, FxMenorUmAno: 9, FxUmQuatro: 0 },
], ageFields);
assert.equal(age.quality.status, "inconsistent", "Age profiles need the same per-record reconciliation as sex");
assert.equal(age.quality.invalidRows, 1);
console.log("CEVESP cache demographic completeness and per-record cancellation tests passed");

async function verifyRpcProfiles() {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role";
  let response: Record<string, unknown> = {};
  let rawResponse: Array<Record<string, unknown>> | undefined;
  let requests = 0;
  globalThis.fetch = async input => {
    assert.equal(new URL(String(input)).pathname, rawResponse ? "/rest/v1/cevesp_notificacoes" : "/rest/v1/rpc/cevesp_relatorio", "Only synthetic RPC/cache responses may be requested");
    requests += 1;
    return Response.json(rawResponse ?? response);
  };
  const analysis = { metric: "total_casos", dimensions: [], time_grain: "none", date_range: { type: "all" }, filters: [] };
  const base = { total_cases: 20, sex_masc: 20, sex_fem: 0, fx_menor_um: 20, fx_1_4: 0, fx_5_9: 0, fx_10_14: 0, fx_15_mais: 0 };
  try {
    for (const question of ["Distribuição por sexo", "Distribuição por faixa etária"]) {
      response = { ...base, sex_invalid_rows: 1, age_invalid_rows: 1 };
      const invalid = await runCevespAnalysisCached(question, analysis);
      assert.equal(invalid.distributionQuality?.status, "inconsistent");
      assert.deepEqual(invalid.rows, []);
      response = { ...base, sex_invalid_rows: 0, age_invalid_rows: 0 };
      const valid = await runCevespAnalysisCached(question, analysis);
      assert.equal(valid.distributionQuality?.status, "complete");
      assert.ok(valid.rows.length > 0);
      response = base;
      const legacy = await runCevespAnalysisCached(question, analysis);
      assert.equal(legacy.distributionQuality?.status, "unverified");
      assert.deepEqual(legacy.rows, []);
      assert.equal(legacy.interpretation.some(text => text.includes("maior volume foi")), false);
    }
    assert.equal(requests, 6);
    rawResponse = [
      { ANO: 2025, TotalCaso: 10, SexMasc: 15, SexFem: 0, FxMenorUmAno: 15, GVE_NOME: "FIXTURE" },
      { ANO: 2025, TotalCaso: 10, SexMasc: 5, SexFem: 0, FxMenorUmAno: 5, GVE_NOME: "FIXTURE" },
    ];
    const demographicMetrics = ["sexo_masculino", "sexo_feminino", "menor_1_ano", "faixa_1_4", "faixa_5_9", "faixa_10_14", "faixa_15_mais"];
    for (const time_grain of ["none", "year"]) {
      for (const metric of demographicMetrics) {
        const result = await runCevespAnalysisCached("Indicador demográfico específico", { ...analysis, metric, time_grain });
        assert.equal(result.distributionQuality?.status, "inconsistent", `${metric}/${time_grain} must not bypass per-record validation`);
        assert.deepEqual(result.rows, []);
      }
    }
    rawResponse = [{ ANO: 2025, TotalCaso: 10, SexMasc: 3, SexFem: 2, GVE_NOME: "FIXTURE" }];
    const partialMetric = await runCevespAnalysisCached("Casos masculinos", { ...analysis, metric: "sexo_masculino" });
    assert.equal(partialMetric.distributionQuality?.status, "partial");
    assert.ok(partialMetric.rows.length > 0);
    assert.ok(partialMetric.interpretation.some(text => text.includes("parcial")));
    rawResponse = [{ ANO: 2025, TotalCaso: 10, SexMasc: null, SexFem: null, GVE_NOME: "FIXTURE" }];
    const unavailableMetric = await runCevespAnalysisCached("Casos masculinos", { ...analysis, metric: "sexo_masculino" });
    assert.equal(unavailableMetric.distributionQuality?.status, "unavailable");
    assert.deepEqual(unavailableMetric.rows, []);
    const caseTotal = await runCevespAnalysisCached("Total de casos", analysis);
    assert.equal(caseTotal.distributionQuality, undefined, "Case totals must not require demographic completeness");
    assert.ok(caseTotal.rows.some(row => row.Valor === 10));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
  console.log("CEVESP RPC source-row demographic validation and legacy migration tests passed");
}
verifyRpcProfiles().catch(error => { console.error(error); process.exitCode = 1; });
