import { redirect } from "next/navigation";

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: any | null }; error?: any }>;
    getSession: () => Promise<{ data: { session: { user: any } | null }; error?: any }>;
  };
};

export async function getCurrentUser(supabase: SupabaseLike) {
  try {
    const { data } = await supabase.auth.getUser();
    if (data.user) return data.user;
  } catch (error) {
    if (process.env.NODE_ENV !== "development") throw error;
  }

  if (process.env.NODE_ENV === "development") {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  }

  return null;
}

export async function requireCurrentUser(supabase: SupabaseLike) {
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login");
  return user;
}
