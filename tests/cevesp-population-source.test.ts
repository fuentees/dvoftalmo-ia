import assert from "node:assert/strict";
import { aggregateCevespRates } from "../services/population-rates";
import { listarGvesSp, listarMunicipiosPorGve } from "../lib/municipios-sp";

const gve = listarGvesSp().find((name) => listarMunicipiosPorGve(name).length > 1)!;
const municipalities = listarMunicipiosPorGve(gve);
const rows = municipalities.map((item) => ({ codigo_ibge: item.codigo, municipio: item.nome, uf: "SP", ano: 2024, populacao: 1000 }));
const population: Parameters<typeof aggregateCevespRates>[1] = {
  latestYear: 2024, years: [2024], rows,
  byCode: new Map(rows.map((row) => [row.codigo_ibge, [row]])), byName: new Map(),
  byCodeYear: new Map(rows.map((row) => [`${row.codigo_ibge}:2024`, row])), byNameYear: new Map()
};
const notification = (year: number) => ({ ANO: year, TotalCaso: 10, IbgeNotificacao: municipalities[0].codigo, MunicipioNotificacao: municipalities[0].nome, GVE_NOME: gve });
const historical = aggregateCevespRates([notification(2017)], population, { ano: 2017 });
assert.equal(historical.analysisYear, 2017);
assert.equal(historical.populationYear, 2024, "A 2017 analysis must not label a substitute 2024 denominator as population 2017");
assert.deepEqual(historical.byMunicipality[0].populationSourceYears, [2024]);
assert.deepEqual(historical.byGve[0].populationSourceYears, [2024]);
assert.equal(historical.byGve[0].populationFallback, true);
assert.ok(historical.warnings.some((warning) => /substituta/.test(warning) && /2024/.test(warning)));
const exact = aggregateCevespRates([notification(2024)], population, { ano: 2024 });
assert.equal(exact.byGve[0].populationFallback, false);
assert.ok(!exact.warnings.some((warning) => /substituta/.test(warning)));
const empty = aggregateCevespRates([], population, { ano: 2017 });
assert.equal(empty.populationYear, null);
assert.deepEqual(empty.populationYears, []);
console.log("CEVESP population source-year tests passed");
