import assert from "node:assert/strict";
import { belongsToConfiguredProject, runAccessTransaction } from "../scripts/verify-panel-access-deploy.mjs";

const project = "https://exampleproject.supabase.co";
assert.equal(belongsToConfiguredProject("postgresql://postgres:unused@db.exampleproject.supabase.co/postgres", project), true);
assert.equal(belongsToConfiguredProject("postgresql://postgres.exampleproject:unused@aws-0-sa-east-1.pooler.supabase.com/postgres", project), true);
assert.equal(belongsToConfiguredProject("postgresql://postgres.exampleproject:unused@unrelated.example/postgres", project), false);
assert.equal(belongsToConfiguredProject("postgresql://postgres.exampleproject:unused@pooler.supabase.com.evil.example/postgres", project), false);
assert.equal(belongsToConfiguredProject("postgresql://postgres.otherproject:unused@aws-0-sa-east-1.pooler.supabase.com/postgres", project), false);
assert.equal(belongsToConfiguredProject("postgresql://postgres:unused@db.exampleproject.supabase.co/other_database", project), false);
assert.equal(belongsToConfiguredProject("not-a-url", project), false);

function fakeClient(failCommand) {
  const commands = [];
  return {
    commands,
    async query(sql) {
      commands.push(sql);
      if (sql === failCommand) throw Object.assign(new Error("Simulated connection failure"), { code: "ECONNRESET" });
      return { rows: [] };
    },
  };
}

const readOnly = fakeClient();
assert.equal(await runAccessTransaction(readOnly, false, async () => "metadata"), "metadata");
assert.equal(readOnly.commands[0], "BEGIN TRANSACTION READ ONLY");
assert.equal(readOnly.commands.at(-1), "ROLLBACK");
assert.equal(readOnly.commands.includes("COMMIT"), false);

const success = fakeClient();
assert.equal(await runAccessTransaction(success, true, async () => "applied"), "applied");
assert.equal(success.commands.at(-1), "COMMIT");

const migrationError = fakeClient();
await assert.rejects(runAccessTransaction(migrationError, true, async () => {
  throw Object.assign(new Error("Migration failure"), { code: "42501" });
}), (error) => error.transactionOutcome === "apply_rolled_back" && error.code === "42501");
assert.equal(migrationError.commands.at(-1), "ROLLBACK");

const lostCommit = fakeClient("COMMIT");
await assert.rejects(runAccessTransaction(lostCommit, true, async () => undefined),
  (error) => error.transactionOutcome === "apply_outcome_unknown");

const lostRollback = fakeClient("ROLLBACK");
await assert.rejects(runAccessTransaction(lostRollback, true, async () => { throw new Error("Migration failure"); }),
  (error) => error.transactionOutcome === "apply_outcome_unknown");

const failedBegin = fakeClient("BEGIN");
await assert.rejects(runAccessTransaction(failedBegin, true, async () => { throw new Error("Work must not run"); }),
  (error) => error.transactionOutcome === "apply_not_started");
assert.deepEqual(failedBegin.commands, ["BEGIN"]);
console.log("Panel access deployment: target validation and transaction recovery passed.");
