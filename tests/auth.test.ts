import assert from "node:assert/strict";
import { getCurrentUser } from "../lib/supabase/auth";

async function main() {
  const previous = process.env.DISABLE_AUTH;
  process.env.DISABLE_AUTH = "false";
  try {
    const user = { id: "verified" };
    const untrusted = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "forged" } } } }),
        getUser: async () => ({ data: { user: null }, error: new Error("Invalid token") })
      }
    };
    assert.equal(await getCurrentUser(untrusted), null);
    assert.deepEqual(await getCurrentUser({ auth: { getUser: async () => ({ data: { user } }) } }), user);
    assert.equal(await getCurrentUser({ auth: { getUser: async () => { throw new Error("offline"); } } }), null);
    assert.equal(await getCurrentUser({ auth: { getUser: async () => ({ data: { user }, error: new Error("Rejected") }) } }), null);
  } finally {
    if (previous === undefined) delete process.env.DISABLE_AUTH;
    else process.env.DISABLE_AUTH = previous;
  }
  console.log("Server authentication tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
