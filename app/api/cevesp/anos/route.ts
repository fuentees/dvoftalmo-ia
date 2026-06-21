import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cevesp_notificacoes")
    .select('"ANO"')
    .not('"ANO"', "is", null)
    .order('"ANO"', { ascending: false });

  if (error) return NextResponse.json({ anos: [] });

  const anos = Array.from(
    new Set((data ?? []).map((r: Record<string, unknown>) => Number(r["ANO"])).filter((a) => a > 1900))
  ).sort((a, b) => b - a);

  return NextResponse.json({ anos });
}
