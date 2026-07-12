import assert from "node:assert/strict";
import {
  currentCalendarYear,
  currentEpiWeek,
  dateToEpiWeek,
  dateToEpiWeekYear,
  shiftEpiWeek,
  weeksInEpiYear
} from "../lib/epi-week";

assert.equal(dateToEpiWeek(new Date(2026, 0, 1)), 53);
assert.equal(dateToEpiWeek(new Date(2026, 0, 4)), 1);
assert.equal(dateToEpiWeek(new Date(2026, 6, 11)), 27);
assert.equal(dateToEpiWeek(new Date(2026, 6, 12)), 28);

const saoPauloLateNight = new Date("2026-07-12T02:30:00.000Z");
assert.deepEqual(dateToEpiWeekYear(saoPauloLateNight, "America/Sao_Paulo"), { year: 2026, se: 27 });
assert.deepEqual(currentEpiWeek(saoPauloLateNight), { year: 2026, se: 27 });
assert.equal(currentCalendarYear(saoPauloLateNight), 2026);

const saoPauloSunday = new Date("2026-07-12T15:00:00.000Z");
assert.deepEqual(dateToEpiWeekYear(saoPauloSunday, "America/Sao_Paulo"), { year: 2026, se: 28 });
assert.deepEqual(currentEpiWeek(saoPauloSunday), { year: 2026, se: 28 });

const weekCount = weeksInEpiYear(2026);
assert.ok(weekCount === 52 || weekCount === 53);
assert.deepEqual(shiftEpiWeek(2026, 1, -1), { year: 2025, se: weeksInEpiYear(2025) });
assert.deepEqual(shiftEpiWeek(2026, weekCount, 1), { year: 2027, se: 1 });

console.log("epi week tests passed");
