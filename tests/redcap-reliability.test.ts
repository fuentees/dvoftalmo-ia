import assert from "node:assert/strict";
import { redcapExport } from "../lib/external/redcap-client";
import { fetchTracomaSurveys, estimateAzithromycin } from "../services/tracoma-analytics";

async function main() {
  assert.throws(() => estimateAzithromycin({ targetPopulation: Infinity }), /inteiro positivo/);
  assert.throws(() => estimateAzithromycin({ targetPopulation: 100, coveragePercent: 101 }), /Cobertura/);
  assert.throws(() => estimateAzithromycin({ targetPopulation: 100, childrenRatio: -1 }), /Proporção/);
  assert.equal(estimateAzithromycin({ targetPopulation: 100, coveragePercent: 0 }).treatmentTarget, 0);
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.REDCAP_API_URL;
  const originalToken = process.env.REDCAP_API_TOKEN;
  try {
    delete process.env.REDCAP_API_URL;
    delete process.env.REDCAP_API_TOKEN;
    await assert.rejects(fetchTracomaSurveys(), /indisponíveis/);
    await assert.rejects(fetchTracomaSurveys({ yearFrom: NaN }), /anos inteiros/);
    await assert.rejects(fetchTracomaSurveys({ yearFrom: 2026, yearTo: 2025 }), /ano inicial/);
    process.env.REDCAP_API_URL = "https://example.test/api/";
    process.env.REDCAP_API_TOKEN = "test-token";
    globalThis.fetch = async (_input, init) => {
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get("records[0]"), "a");
      assert.equal(params.get("records[1]"), "b");
      return Response.json([]);
    };
    assert.deepEqual(await redcapExport({ records: ["a", "b"] }), []);
    globalThis.fetch = async () => Response.json({ unexpected: true });
    await assert.rejects(redcapExport(), /resposta inválida/);
    globalThis.fetch = async () => Response.json({ error: "Invalid token" });
    await assert.rejects(redcapExport(), /Invalid token/);
    await assert.rejects(fetchTracomaSurveys({ municipality: 'X" OR 1=1' }), /inválido/);
    globalThis.fetch = async () => Response.json([{ municipio: "Teste", ano: 2025, total_examinados: 100, casos_tf: 4, casos_tt: 0 }]);
    const result = await fetchTracomaSurveys();
    assert.equal(result.data[0].tfPrevalence, 4);
    assert.equal(result.data[0].tfEliminated, null);
    assert.equal(result.data[0].populationCoverage, null);
    assert.equal(result.data[0].azithromycinDoses, null);
    globalThis.fetch = async () => Response.json([{ total_examinados: 100, casos_tf: 101, casos_tt: 0 }]);
    await assert.rejects(fetchTracomaSurveys(), /registros/);
    globalThis.fetch = async () => Response.json([{ ano: 2025, total_examinados: 100, casos_tf: "", casos_tt: 0 }]);
    await assert.rejects(fetchTracomaSurveys(), /registros/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.REDCAP_API_URL;
    else process.env.REDCAP_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.REDCAP_API_TOKEN;
    else process.env.REDCAP_API_TOKEN = originalToken;
  }
  console.log("REDCap reliability tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
