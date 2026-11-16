import assert from "node:assert/strict";
import { assessNotificationDate, businessDateIso, isObservedBucket, observationYears, observedBucketLimit } from "../lib/cevesp-time-boundary";
import { aggregateEndemicCaseRows, buildChannel } from "../services/cevesp-endemic";
import { indexTerritoryPopulation } from "../lib/cevesp-population";

const now = new Date("2026-10-09T15:00:00Z");
assert.equal(businessDateIso(now), "2026-10-09");
assert.equal(businessDateIso(new Date("2026-10-10T02:30:00Z")), "2026-10-09", "Civil dates must use São Paulo rather than the UTC day");
const futureSourceDate = assessNotificationDate("5202-05-23", now);
assert.equal(futureSourceDate.value, null, "A source typo must never make the base appear fresh");
assert.equal(futureSourceDate.issue, "future");
assert.equal(futureSourceDate.raw, "5202-05-23", "The rejected source date remains available for audit");
assert.equal(assessNotificationDate("2026-10-10", now).issue, "future");
assert.equal(assessNotificationDate("2026-02-30", now).issue, "invalid", "Date parsing must reject JavaScript calendar rollover");
assert.equal(assessNotificationDate("2026-02-29", now).issue, "invalid");
assert.equal(assessNotificationDate("2024-02-29", now).value, "2024-02-29");
assert.equal(assessNotificationDate("2026-10-09T00:00:00", now).value, "2026-10-09");
assert.equal(assessNotificationDate(null, now).issue, "missing");
assert.deepEqual(observationYears([2024, 2024, "2025", 2026, 2027, 2028, 2029, NaN, 1900, 2024.5, "invalid"], now), { years: [2024, 2025, 2026], excludedYears: [2027, 2028, 2029] });

assert.equal(observedBucketLimit(2026, "week", now), 40);
assert.equal(isObservedBucket(2026, 40, "week", now), true);
assert.equal(isObservedBucket(2026, 41, "week", now), false);
assert.equal(isObservedBucket(2026, 11, "month", now), false);
assert.equal(isObservedBucket(2025, 11, "month", now), true, "Old reference years retain their complete observed calendar");
assert.equal(observedBucketLimit(2027, "week", now), 0);
assert.equal(observedBucketLimit(2026, "week", new Date("2026-01-01T15:00:00Z")), 0, "Calendar 2026 cannot borrow SE53 from epidemiological year2025");

const population = indexTerritoryPopulation([{ codigo_ibge: "3500105", ano: 2026, populacao: 1000 }], new Set(["350010"]));
const grouped = aggregateEndemicCaseRows([
  { ANO: 2026, SemEpidemio: 40, TotalCaso: 10 },
  { ANO: 2026, SemEpidemio: 41, TotalCaso: 500 },
  { ANO: 2026, SemEpidemio: 41, TotalCaso: 700 },
], "week");
const channel = buildChannel([{ yr: 2025, se: 41, cases: 20 }], grouped, "week", population, now);
assert.equal(channel[39].currentYear, 10);
assert.equal(channel[39].currentIncidence, 1000);
assert.equal(channel[40].currentYear, null, "Future notifications cannot become observed cases in charts, tables or exports");
assert.equal(channel[40].currentIncidence, null);
assert.equal(channel[40].population, null);
assert.equal(channel[40].futureCurrentCaseRecords, 2, "Excluded source records remain an explicit quality diagnostic");
assert.equal(channel[40].baseline.length, 1, "The historical band can continue through future current-year buckets");
const mysqlChannel = buildChannel([], [{ yr: 2026, se: 41, cases: 1200, source_record_count: 2 }], "week", population, now);
assert.equal(mysqlChannel[40].futureCurrentCaseRecords, 2, "MySQL and cache use the same future-period rule");
assert.equal(mysqlChannel[40].currentYear, null);
console.log("CEVESP temporal boundary, source diagnostics and future channel observation tests passed");
