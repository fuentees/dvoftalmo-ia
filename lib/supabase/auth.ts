import { redirect } from "next/navigation";

type AuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: AuthUser | null }; error?: unknown }>;
    getSession: () => Promise<{ data: { session: { user: AuthUser } | null }; error?: unknown }>;
  };
};

export function isAuthDisabledForDev() {
  return process.env.DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";
}

function devUser(): AuthUser {
  return {
    id: "dev-user",
    email: "dev@local.test",
    user_metadata: { full_name: "Desenvolvimento local" },
    app_metadata: { provider: "dev-bypass" }
  };
}

export async function getCurrentUser(supabase: SupabaseLike) {
  if (isAuthDisabledForDev()) return devUser();

  // getSession reads from the cookie first, avoiding a network call when possible.
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user;
  } catch { /* fall through */ }

  // Only try getUser (network call) if session had no user
  try {
    const { data } = await supabase.auth.getUser();
    if (data.user) return data.user;
  } catch { /* network unavailable */ }

  return null;
}

export async function requireCurrentUser(supabase: SupabaseLike) {
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");
  return user;
}
