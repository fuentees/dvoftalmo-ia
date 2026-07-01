import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const anosSet = new Set<number>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("cevesp_notificacoes")
      .select('"ANO"')
      .not('"ANO"', "is", null)
      .range(from, from + pageSize - 1);
    if (error || !data?.length) break;
    for (const r of data as Record<string, unknown>[]) {
      const n = Number(r["ANO"]);
      if (n > 1900) anosSet.add(n);
    }
    if (data.length < pageSize) break;
  }

  const anos = Array.from(anosSet).sort((a, b) => b - a);
  return NextResponse.json({ anos });
}
