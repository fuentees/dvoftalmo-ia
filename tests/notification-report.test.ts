import assert from "node:assert/strict";
import { summarizeNotificationRows, summarizeFromRpc, type RpcRelatorioData } from "@/services/notification-report";
import { distributionQuality } from "@/lib/cevesp-distribution";

const rows = [
  {
    ANO: 2026,
    SemEpidemio: 12,
    DtNotificacao: "2026-01-01",
    TotalCaso: 3,
    MunicipioNotificacao: "SAO PAULO",
    GVE_NOME: "SAO PAULO",
    Unid_notificacao: "UBS A"
  },
  {
    ANO: 2026,
    SemEpidemio: 12,
    DtNotificacao: "2026-04-01",
    TotalCaso: 2,
    MunicipioNotificacao: "SAO PAULO",
    GVE_NOME: "SAO PAULO",
    Unid_notificacao: "UBS A"
  },
  {
    ANO: 2026,
    SemEpidemio: 13,
    DtNotificacao: "2026-04-02",
    TotalCaso: 5,
    MunicipioNotificacao: "CAMPINAS",
    GVE_NOME: "CAMPINAS",
    Unid_notificacao: "UBS B"
  }
];

const summary = summarizeNotificationRows(rows, rows.length);

assert.deepEqual(summary.indicators.weeklySeries, [
  { week: "2026-SE12", total: 5 },
  { week: "2026-SE13", total: 5 }
]);
assert.equal(summary.indicators.totalCases, 10);
assert.equal(summary.indicators.reportingMunicipalities, 2);

const invalidProfile = summarizeNotificationRows([
  { TotalCaso: 10, SexMasc: 20, SexFem: 0, FxQuizeOuMais: 20 },
  { TotalCaso: 10, SexMasc: 0, SexFem: 0, FxQuizeOuMais: 0 }
], 2);
assert.equal(invalidProfile.indicators.distributionQuality.sex.status, "inconsistent", "Opposite row errors must not cancel into a plausible aggregate");
assert.equal(invalidProfile.indicators.distributionQuality.age.status, "inconsistent");
assert.deepEqual(invalidProfile.indicators.sexDistribution, []);
assert.deepEqual(invalidProfile.indicators.ageDistribution, []);
assert.equal(invalidProfile.alerts.some(alert => alert.title.includes("faixa etaria")), false);
assert.equal(invalidProfile.interpretation.some(text => text.includes("maior ocorrencia na faixa")), false);
assert.equal(summarizeNotificationRows([{ TotalCaso: 10, SexMasc: "erro" }], 1).indicators.distributionQuality.sex.status, "inconsistent");
assert.equal(distributionQuality(10, [3, 2]).status, "partial");
assert.equal(distributionQuality(10, [null, undefined]).status, "unavailable");
assert.equal(distributionQuality(0, [0, 0]).status, "complete");
assert.equal(distributionQuality(10, [true, []]).status, "inconsistent");
assert.equal(distributionQuality(10, [-1, 11]).status, "inconsistent");
assert.equal(distributionQuality(10, [2.5, 7.5]).status, "inconsistent");

const rpc = {
  total_notifications: 2, total_cases: 10,
  sex_masc: 900, sex_fem: 100, fx_menor_um: 1, fx_1_4: 2, fx_5_9: 1, fx_10_14: 1, fx_15_mais: 5,
  sex_invalid_rows: 0, age_invalid_rows: 0,
  weekly_series: [{ ano: 2026, se: 0, total: 1 }, { ano: 2026, se: 12, total: 9 }]
} as RpcRelatorioData;
const rpcReport = summarizeFromRpc(rpc, [{ se: 0, media: 1 }, { se: 12, media: 9 }], null);
assert.deepEqual(rpcReport.indicators.sexDistribution, []);
assert.equal(rpcReport.indicators.distributionQuality.sex.status, "inconsistent");
assert.equal(rpcReport.indicators.distributionQuality.age.status, "complete");
assert.deepEqual(rpcReport.indicators.weeklySeries, [{ week: "2026-SE12", total: 9 }]);
assert.deepEqual(rpcReport.indicators.weeklyAverage, [{ se: "SE12", average: 9 }]);
const cancelledRpc: RpcRelatorioData = {
  ...rpc, total_cases: 20, sex_masc: 20, sex_fem: 0,
  fx_menor_um: 20, fx_1_4: 0, fx_5_9: 0, fx_10_14: 0, fx_15_mais: 0,
  sex_invalid_rows: 1, age_invalid_rows: 1,
};
const cancelledReport = summarizeFromRpc(cancelledRpc, [], null);
assert.equal(cancelledReport.indicators.distributionQuality.sex.status, "inconsistent", "A valid aggregate sum must not hide invalid source rows counted by the RPC");
assert.equal(cancelledReport.indicators.distributionQuality.age.status, "inconsistent");
assert.deepEqual(cancelledReport.indicators.sexDistribution, []);
assert.deepEqual(cancelledReport.indicators.ageDistribution, []);
assert.equal(cancelledReport.indicators.totalCases, 20, "Demographic validation must not suppress the case total");
const verifiedRpc = { ...cancelledRpc, sex_invalid_rows: 0, age_invalid_rows: 0 };
const verifiedReport = summarizeFromRpc(verifiedRpc, [], null);
assert.equal(verifiedReport.indicators.distributionQuality.sex.status, "complete");
assert.equal(verifiedReport.indicators.distributionQuality.age.status, "complete");
assert.equal(verifiedReport.indicators.sexDistribution.length, 2);
const legacyRpc: RpcRelatorioData = { ...verifiedRpc };
delete legacyRpc.sex_invalid_rows;
delete legacyRpc.age_invalid_rows;
const legacyReport = summarizeFromRpc(legacyRpc, [], null);
assert.equal(legacyReport.indicators.distributionQuality.sex.status, "unverified");
assert.equal(legacyReport.indicators.distributionQuality.age.status, "unverified");
assert.deepEqual(legacyReport.indicators.sexDistribution, []);
assert.deepEqual(legacyReport.indicators.ageDistribution, []);
assert.equal(legacyReport.interpretation.some(text => text.includes("maior ocorrencia na faixa")), false);
assert.deepEqual(summarizeNotificationRows([{ ANO: 2026, SemEpidemio: 0, DtNotificacao: "2026-03-01", TotalCaso: 1 }], 1).indicators.weeklySeries, [], "An invalid reported week must not be silently replaced by a date");

console.log("notification report tests passed");
