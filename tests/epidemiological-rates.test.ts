import assert from "node:assert/strict";
import {
  detectionRatePer100k,
  examCoveragePercent,
  incidencePer100k,
  prevalencePercent
} from "../services/epidemiological-rates";

assert.equal(incidencePer100k(50, 100_000), 50);
assert.equal(incidencePer100k(0, 100_000), 0);
assert.equal(incidencePer100k(10, 0), null);

assert.equal(detectionRatePer100k(12, 24_000), 50);
assert.equal(detectionRatePer100k(12, -1), null);

assert.equal(prevalencePercent(25, 500), 5);
assert.equal(prevalencePercent(10, 0), null);

assert.equal(examCoveragePercent(500, 10_000), 5);
assert.equal(examCoveragePercent(500, 0), null);

console.log("epidemiological rates tests passed");
