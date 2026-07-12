import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey && process.env.NODE_ENV === "production") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required in production.");
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    serviceRoleKey ?? "local-service-role-key",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}
