import { redirect } from "next/navigation";

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: any | null }; error?: any }>;
    getSession: () => Promise<{ data: { session: { user: any } | null }; error?: any }>;
  };
};

export async function getCurrentUser(supabase: SupabaseLike) {
  // Try getUser first (validates server-side); fall back to getSession (reads cookie, no network call)
  try {
    const { data } = await supabase.auth.getUser();
    if (data.user) return data.user;
  } catch {
    // Network failure — fall through to session fallback
  }

  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}

export async function requireCurrentUser(supabase: SupabaseLike) {
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");
  return user;
}
