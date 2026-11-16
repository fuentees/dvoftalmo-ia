import assert from "node:assert/strict";
import { compareDatasets, indexDataset, publicSummary } from "../scripts/reconcile-cevesp";

const base = { ID: "confidential-record-a", ANO: 2026, Mes: 5, SemEpidemio: 20, DtNotificacao: "2026-05-20", TotalCaso: 0, Excluido: "N", MunicipioNotificacao: "PRIVATE_TERRITORY", Nome_notificante: "PRIVATE_NAME" };
const source = indexDataset([base, { ...base, ID: "confidential-record-b", TotalCaso: null }, { ...base, ID: "confidential-record-c", TotalCaso: 8, Excluido: "S" }]);
assert.deepEqual(source.total, { records: 3, activeRecords: 2, excludedRecords: 1, unknownExclusionRecords: 0, activeKnownCases: 0, activeInvalidCaseRecords: 1 });
assert.equal(source.byYear["2026"].records, 3);
const publicText = JSON.stringify(publicSummary(source));
for (const privateValue of ["confidential-record", "PRIVATE_TERRITORY", "PRIVATE_NAME"]) assert.ok(!publicText.includes(privateValue), "public report must contain only aggregates");

const same = indexDataset([{ ...base, DtNotificacao: "2026-05-20T00:00:00", TotalCaso: "0", Excluido: 0 }]);
assert.equal(compareDatasets(indexDataset([base]), same).sameComparableData, true, "typed numeric values and equivalent dates compare equally");
assert.equal(compareDatasets(indexDataset([base]), indexDataset([{ ...base, TotalCaso: null }])).changedRecords, 1, "zero is different from an unavailable count");
assert.equal(compareDatasets(indexDataset([{ ...base, TotalCaso: "bad-a" }]), indexDataset([{ ...base, TotalCaso: "bad-b" }])).changedRecords, 1, "distinct invalid numbers must not collapse to the same fingerprint");
for (const invalid of [true, [1], "0x1"]) assert.equal(compareDatasets(indexDataset([{ ...base, TotalCaso: invalid }]), indexDataset([{ ...base, TotalCaso: 1 }])).changedRecords, 1, "invalid types/number syntax must not become valid counts");
assert.equal(compareDatasets(indexDataset([{ ...base, TotalCaso: true }]), indexDataset([{ ...base, TotalCaso: "true" }])).changedRecords, 1, "distinct invalid types remain distinct");
assert.equal(compareDatasets(indexDataset([{ ...base, Excluido: 2 }]), indexDataset([{ ...base, Excluido: 0 }])).changedRecords, 1, "unknown exclusion status must not become active");
assert.equal(indexDataset([{ ...base, Excluido: 2 }]).total.unknownExclusionRecords, 1);
assert.equal(indexDataset([{ ...base, Excluido: 2 }]).total.activeRecords, 0);
assert.equal(compareDatasets(indexDataset([{ ...base, DtNotificacao: "2026-02-30" }]), indexDataset([{ ...base, DtNotificacao: "2026-02-31" }])).changedRecords, 1, "distinct invalid dates remain distinct");
assert.equal(compareDatasets(indexDataset([base]), indexDataset([{ ...base, DtNotificacao: "2026-05-20-invalid" }])).changedRecords, 1, "trailing garbage must not be ignored");
assert.equal(compareDatasets(indexDataset([{ ...base, created_at_origem: "2026-05-20 12:00:00" }]), indexDataset([{ ...base, created_at_origem: "2026-05-20T12:00:00-invalid" }])).changedRecords, 1, "invalid timestamps must not be truncated to a valid timestamp");

const first = indexDataset([{ ...base, TotalCaso: 1 }, { ...base, ID: "b", TotalCaso: 3 }]);
const second = indexDataset([{ ...base, TotalCaso: 3 }, { ...base, ID: "b", TotalCaso: 1 }]);
assert.equal(first.total.activeKnownCases, second.total.activeKnownCases);
assert.equal(compareDatasets(first, second).changedRecords, 2, "equal totals do not hide offsetting per-record changes");
assert.deepEqual(
  [compareDatasets(first, indexDataset([base, { ...base, ID: "c" }])).sourceOnlyRecords, compareDatasets(first, indexDataset([base, { ...base, ID: "c" }])).cacheOnlyRecords],
  [1, 1],
);
assert.equal(compareDatasets(indexDataset([base, base]), indexDataset([base])).sameComparableData, false, "ambiguous duplicate identities cannot certify equivalence");
assert.equal(compareDatasets(indexDataset([{ TotalCaso: 0 }]), indexDataset([{ TotalCaso: 0 }])).sameComparableData, false, "missing identities cannot certify equivalence");
assert.equal(indexDataset([{ ...base, ANO: null }, { ...base, ID: "d", ANO: "invalid", TotalCaso: -1 }]).byYear.sem_ano_valido.activeInvalidCaseRecords, 1);
console.log("data reconciliation tests passed ✓");
