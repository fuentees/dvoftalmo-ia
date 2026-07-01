import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Use RPC for an index-only DISTINCT scan — avoids paginating through all rows
  const { data, error } = await admin.rpc("cevesp_anos_disponiveis");

  if (!error && data) {
    const anos = (data as Array<{ ano: number }>).map((r) => r.ano).filter((a) => a > 1900);
    return NextResponse.json({ anos });
  }

  // Fallback: paginate manually if RPC not yet deployed
  const anosSet = new Set<number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: page, error: pageErr } = await admin
      .from("cevesp_notificacoes")
      .select('"ANO"')
      .not('"ANO"', "is", null)
      .range(from, from + pageSize - 1);
    if (pageErr || !page?.length) break;
    for (const r of page as Record<string, unknown>[]) {
      const n = Number(r["ANO"]);
      if (n > 1900) anosSet.add(n);
    }
    if (page.length < pageSize) break;
  }

  const anos = Array.from(anosSet).sort((a, b) => b - a);
  return NextResponse.json({ anos });
}
