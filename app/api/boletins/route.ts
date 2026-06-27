import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateConjuntiviteBulletin } from "@/services/bulletins-conjuntivite-generator";
import { generateTracomaBulletin } from "@/services/bulletins-tracoma-generator";

type Agravo = "conjuntivite" | "tracoma";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const agravo = searchParams.get("agravo") as Agravo | null;

  const admin = createAdminClient();
  let query = admin
    .from("bulletins")
    .select("id, se, ano, agravo, title, created_at")
    .order("created_at", { ascending: false })
    .limit(40);

  if (agravo === "conjuntivite" || agravo === "tracoma") {
    query = query.eq("agravo", agravo);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json([], {
      headers: {
        "X-DvOftalmo-Warning": `Boletins indisponiveis: ${error.message}`
      }
    });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const agravo: Agravo = body?.agravo === "tracoma" ? "tracoma" : "conjuntivite";
  const force = Boolean(body?.force);

  if (agravo === "tracoma") {
    const result = await generateTracomaBulletin({ ano: body?.ano, anoInicio: body?.anoInicio, force });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  const result = await generateConjuntiviteBulletin({ se: body?.se, ano: body?.ano, force });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
