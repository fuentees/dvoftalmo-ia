import assert from "node:assert/strict";
import { managementScope, qualityReadout, rateForCsv, tracomaCountsNeedReview } from "../lib/management-reading";

const unavailable = qualityReadout({ state: "unavailable", issues: 0 });
assert.equal(unavailable.label, "Qualidade indisponível", "Cached zero must not conceal a failed quality request");
assert.ok(!unavailable.nextAction.includes("acompanhar"));
assert.equal(qualityReadout({ state: "pending", issues: 0 }).label, "Auditoria ainda não consultada");
assert.equal(qualityReadout({ state: "loading" }).label, "Verificando qualidade");
for (const issues of [undefined, -1, NaN, 0.5]) assert.equal(qualityReadout({ state: "ready", issues }).label, "Qualidade indisponível");
assert.equal(qualityReadout({ state: "ready", issues: 0 }).label, "0 pendências retornadas");
const duplicates = qualityReadout({ state: "ready", issues: 10, affectedRecords: 3 });
assert.ok(duplicates.label.includes("10"));
assert.ok(duplicates.detail.includes("3 registro(s)"), "Issues and affected records must remain distinguishable");
assert.equal(managementScope({}), "Histórico disponível · Estado de São Paulo");
assert.equal(managementScope({ yearStart: 2020, yearEnd: 2024, municipio: "São Paulo" }), "2020 a 2024 · São Paulo");
assert.equal(managementScope({ yearStart: 2024, yearEnd: 2024 }), "2024 · Estado de São Paulo");
assert.ok(managementScope({ yearStart: 2020 }).startsWith("Desde 2020"));
assert.ok(managementScope({ yearEnd: 2024 }).startsWith("Até 2024"));
assert.equal(rateForCsv(null), "");
assert.equal(rateForCsv(undefined), "");
assert.equal(rateForCsv(NaN), "");
assert.equal(rateForCsv(-1), "");
assert.equal(rateForCsv(0), "0,00", "Observed zero is retained while unavailable rates stay blank");
assert.equal(rateForCsv(12.345), "12,35");
assert.equal(tracomaCountsNeedReview([{ examinados: 0, positivos: 0, prevalencia: null }]), false, "No exams and no positives is distinct from an incompatible pair");
assert.equal(tracomaCountsNeedReview([
  { examinados: 0, positivos: 1, prevalencia: null },
  { examinados: 100, positivos: 0, prevalencia: 0 }
]), true, "A municipality with positives but no exams must block the total even when the aggregate ratio looks valid");
assert.equal(tracomaCountsNeedReview([{ examinados: 100, positivos: 2, prevalencia: null, invalidPairs: 1 }]), true, "Invalid source pairs remain visible after aggregation");
assert.equal(tracomaCountsNeedReview([{ examinados: null, positivos: 2, prevalencia: null }]), true);
assert.equal(tracomaCountsNeedReview([{ examinados: 100, positivos: 2, prevalencia: 2, invalidPairs: 0 }]), false);
console.log("Management reading and unavailable export tests passed");
