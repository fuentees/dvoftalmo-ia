import assert from "node:assert/strict";
import { summarizeNotificationRows } from "@/services/notification-report";

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

console.log("notification report tests passed");
