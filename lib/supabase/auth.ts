import { redirect } from "next/navigation";

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: any | null }; error?: any }>;
    getSession: () => Promise<{ data: { session: { user: any } | null }; error?: any }>;
  };
};

export async function getCurrentUser(supabase: SupabaseLike) {
  // getSession reads from the cookie — no network call, no fetch errors
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
