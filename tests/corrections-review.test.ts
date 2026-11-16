import assert from "node:assert/strict";
import { assertRecordedCorrectionReview } from "../services/cevesp-corrections";

const valid = { status: "approved", reviewed_by: "00000000-0000-0000-0000-000000000202", reviewed_at: "2026-10-09T13:00:00+00:00" };
assert.doesNotThrow(() => assertRecordedCorrectionReview(valid));
for (const item of [
  { ...valid, status: "pending" },
  { ...valid, reviewed_by: null },
  { ...valid, reviewed_by: " " },
  { ...valid, reviewed_at: null },
  { ...valid, reviewed_at: "invalid-date" },
  { status: "approved" },
]) {
  assert.throws(() => assertRecordedCorrectionReview(item), /sem aprovação registrada/);
}
console.log("Corrections: missing review blocks source application.");
