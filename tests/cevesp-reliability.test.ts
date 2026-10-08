import assert from "node:assert/strict";
import { parseCevespFilters, parseChannelFilters } from "../lib/cevesp-filters";
import { classifyChannelPoint } from "../lib/cevesp-channel";
import { cevespTerritoryCodes, indexTerritoryPopulation } from "../lib/cevesp-population";
import { aggregateEndemicCaseRows, buildChannel } from "../services/cevesp-endemic";
import { summarizeNotificationRows } from "../services/notification-report";
import { canAggregateCevespDateRange, distributionReconciliationMessage, metricValue, resolveDateRange } from "../lib/external/supabase-cevesp";
import { aggregateCevespRates } from "../services/population-rates";
import { listarMunicipiosPorGve, listarGvesSp } from "../lib/municipios-sp";

assert.deepEqual(parseCevespFilters(new URLSearchParams("ano=2024")).anoFim, 2024);
assert.equal(parseCevespFilters(new URLSearchParams("ano=2020&anoFim=2024")).anoFim, 2024);
assert.equal(parseCevespFilters(new URLSearchParams("anoFim=2024")).ano, undefined);
assert.throws(() => parseCevespFilters(new URLSearchParams("ano=foo")), /inválido/);
assert.throws(() => parseCevespFilters(new URLSearchParams("ano=2025&anoFim=2024")), /ano final/);
assert.throws(() => parseCevespFilters(new URLSearchParams("seInicio=1.5")), /inválido/);
assert.throws(() => parseChannelFilters(new URLSearchParams("grain=day")), /Granularidade/);
assert.equal(parseChannelFilters(new URLSearchParams("grain=month&year=2024")).grain, "month");

const territory = new Set(["350010", "350020"]);
const partial = indexTerritoryPopulation([{ codigo_ibge: "3500105", ano: 2024, populacao: 1000 }], territory);
assert.equal(partial.forYear(2024).value, 0, "A partial territory cannot inflate incidence with an incomplete denominator");
const population = indexTerritoryPopulation([
  { codigo_ibge: "3500105", ano: 2024, populacao: 1000 },
  { codigo_ibge: "3500204", ano: 2024, populacao: 1000 },
], territory);
assert.equal(population.forYear(2024).value, 2000);
assert.deepEqual(population.forYear(2023), { value: 2000, sourceYear: 2024, exact: false });
assert.equal(cevespTerritoryCodes(undefined, "São Paulo").size, 1);
assert.equal(cevespTerritoryCodes(undefined, "São").size, 0, "A municipality selection must not include other names by substring");

const channel = buildChannel(
  [2020, 2021, 2022, 2023, 2024].map((yr) => ({ yr, se: 1, cases: 0 })),
  [{ yr: 2025, se: 1, cases: 1 }, { yr: 2025, se: 3, cases: -5 }],
  "week", population
);
assert.equal(channel.length, 53);
assert.equal(channel[0].baseline.length, 5, "Explicit zero observations and pandemic years remain in the baseline");
assert.equal(channel[0].median, 0);
assert.equal(channel[0].currentIncidence, 50);
assert.equal(classifyChannelPoint(channel[0]), "acima");
assert.equal(channel[1].currentYear, null, "Missing periods must not become zero cases");
assert.equal(channel[2].currentYear, null, "Negative counts cannot create apparently valid incidence");
assert.equal(classifyChannelPoint(channel[1]), "sem dado");
const sparse = buildChannel([{ yr: 2024, se: 1, cases: 5 }], [{ yr: 2025, se: 1, cases: 100 }], "month", population);
assert.equal(classifyChannelPoint(sparse[0]), "insuficiente", "A sparse baseline must not classify an epidemic");
assert.equal(buildChannel([], [], "week", population).length, 0);

const summary = summarizeNotificationRows([
  { ANO: 2026, SemEpidemio: 1, TotalCaso: 2, NuSurto: 1, SexMasc: 1, SexFem: 1, DtNotificacao: "2026-01-04", Nome_notificante: "Pessoa" },
  { DtNotificacao: "2026-01-04", TotalCaso: 3, NuSurto: 0, SexMasc: null, SexFem: null, Nome_notificante: null }
], 2);
assert.equal(summary.indicators.weeklySeries[0].week, "2026-SE01");
assert.equal(summary.indicators.weeklySeries[0].total, 5);
assert.equal(summary.indicators.outbreakNotifications, 1, "Reported outbreak count also marks an outbreak notification");
assert.equal(summary.columns.find((col) => col.name === "Nome_notificante")?.numeric, undefined);
assert.equal(summary.columns.find((col) => col.name === "SexMasc")?.numeric?.average, 1, "Missing numeric fields do not become observed zero");

const gve = listarGvesSp().find((name) => listarMunicipiosPorGve(name).length > 1)!;
const municipalities = listarMunicipiosPorGve(gve);
const popRows = municipalities.map((item) => ({ codigo_ibge: item.codigo, municipio: item.nome, uf: "SP", ano: 2024, populacao: 1000 }));
const popIndex: Parameters<typeof aggregateCevespRates>[1] = {
  latestYear: 2024, years: [2024], rows: popRows,
  byCode: new Map(popRows.map((row) => [row.codigo_ibge, [row]])),
  byName: new Map(), byCodeYear: new Map(popRows.map((row) => [`${row.codigo_ibge}:2024`, row])), byNameYear: new Map()
};
const cases = (year: number, total: unknown) => ({ ANO: year, TotalCaso: total, IbgeNotificacao: municipalities[0].codigo, MunicipioNotificacao: municipalities[0].nome, GVE_NOME: gve });
const rates = aggregateCevespRates([cases(2024, 10)], popIndex, { ano: 2024 });
assert.equal(rates.byGve[0].populacao, municipalities.length * 1000, "The regional denominator includes municipalities that did not report");
assert.equal(rates.byMunicipality[0].incidencia100k, 1000);
assert.equal(aggregateCevespRates([cases(2024, null)], popIndex, { ano: 2024 }).byMunicipality[0].casos, null);
assert.equal(aggregateCevespRates([cases(2024, -1)], popIndex, { ano: 2024 }).byGve[0].incidencia100k, null);
assert.equal(aggregateCevespRates([cases(2024, 0)], popIndex, { ano: 2024 }).byMunicipality[0].incidencia100k, 0);
const period = aggregateCevespRates([cases(2020, 10), cases(2024, 10)], popIndex, { ano: 2020, anoFim: 2024 });
assert.equal(period.nYears, 5);
assert.deepEqual(period.missingYears, [2021, 2022, 2023]);
assert.equal(period.byGve[0].incidencia100k, null, "A missing year cannot masquerade as a full annual average");
assert.equal(metricValue({ TotalCaso: 500, SexFem: 10 }, "sexo_feminino"), 10);
assert.equal(metricValue({ TotalCaso: 500, FxUmQuatro: 3 }, "faixa_1_4"), 3);
assert.equal(metricValue({ Excluido: 1, TotalCaso: 50 }, "registros_excluidos"), 1);

const octoberWeeks = resolveDateRange({ type: "relative_weeks", amount: 4 }, new Date("2026-10-08T15:00:00-03:00"));
assert.deepEqual(octoberWeeks, { anoStart: 2026, anoEnd: 2026, seStart: 36, seEnd: 40, startDate: "2026-09-10", endDate: "2026-10-08" });
assert.equal(canAggregateCevespDateRange(octoberWeeks), false, "Year/SE aggregate RPCs cannot enforce the partial civil weeks at either end");
const newYearWeeks = resolveDateRange({ type: "relative_weeks", amount: 2 }, new Date("2027-01-03T15:00:00-03:00"));
assert.equal(newYearWeeks.seStart, undefined, "A December-January window cannot use one SE lower bound for both years");
assert.deepEqual(newYearWeeks, { anoStart: 2026, anoEnd: 2027, startDate: "2026-12-20", endDate: "2027-01-03" });
assert.deepEqual(resolveDateRange({ type: "current_month" }, new Date("2027-01-01T02:30:00Z")), {
  anoStart: 2026, anoEnd: 2026, startDate: "2026-12-01", endDate: "2026-12-31"
}, "After midnight UTC remains December in São Paulo");
assert.deepEqual(resolveDateRange({ type: "last_month" }, new Date("2027-01-01T02:30:00Z")), {
  anoStart: 2026, anoEnd: 2026, startDate: "2026-11-01", endDate: "2026-11-30"
});
assert.equal(canAggregateCevespDateRange(resolveDateRange({ type: "between", start: "2024-01-01", end: "2024-12-31" })), true);
assert.match(distributionReconciliationMessage(10, 14, "sexo"), /Divergência.*14.*10.*em 4/);
assert.match(distributionReconciliationMessage(10, 14, "faixas etárias"), /Divergência/);
assert.match(distributionReconciliationMessage(10, 6, "sexo"), /Há 4 casos sem correspondência/);
assert.match(distributionReconciliationMessage(10, 10, "sexo"), /corresponde ao total/);
assert.doesNotMatch(distributionReconciliationMessage(10, NaN, "sexo"), /corresponde/);
const invalidGrouped = aggregateEndemicCaseRows([
  { ANO: 2025, SemEpidemio: 1, TotalCaso: null },
  { ANO: 2025, SemEpidemio: 1, TotalCaso: 20 },
  { ANO: 2025, SemEpidemio: 2, TotalCaso: -10 },
  { ANO: 2025, SemEpidemio: 2, TotalCaso: 20 },
  { ANO: 2025, SemEpidemio: 3, TotalCaso: 0 },
  { ANO: 2025, SemEpidemio: 4, TotalCaso: 0.5 },
  { ANO: 2025, SemEpidemio: 4, TotalCaso: 0.5 },
  { ANO: 2025, SemEpidemio: 5, TotalCaso: -10, Excluido: 1 },
  { ANO: 2025, SemEpidemio: 5, TotalCaso: 20 }
], "week");
assert.equal(invalidGrouped.find((row) => row.se === 1)?.cases, null, "Missing source counts cannot become a zero observation or be masked by another record");
assert.equal(invalidGrouped.find((row) => row.se === 2)?.cases, null, "-10 + 20 cannot masquerade as a valid 10-case bucket");
assert.equal(invalidGrouped.find((row) => row.se === 3)?.cases, 0);
assert.equal(invalidGrouped.find((row) => row.se === 4)?.cases, null, "Fractional counts cannot add up to a valid integer observation");
assert.equal(invalidGrouped.find((row) => row.se === 5)?.cases, 20, "Excluded records do not invalidate active observations");
const invalidChannel = buildChannel([], invalidGrouped, "week", population);
assert.equal(invalidChannel[0].currentYear, null);
assert.equal(invalidChannel[1].currentIncidence, null);
assert.equal(invalidChannel[2].currentIncidence, 0);
assert.equal(invalidChannel[0].invalidCurrentCaseRecords, 1);
assert.equal(buildChannel([], [{ yr: 2025, se: 1, cases: null }], "week", population)[0].currentYear, null);
assert.equal(buildChannel([], [{ yr: 2025, se: 1, cases: 10, invalid_case_records: 1 }], "week", population)[0].currentYear, null, "MySQL aggregate retains its invalid-source count");
assert.equal(buildChannel([{ yr: 2024, se: 1, cases: 10, invalid_case_records: 1 }], [], "week", population)[0].baseline.length, 0);
console.log("CEVESP reliability tests passed");
