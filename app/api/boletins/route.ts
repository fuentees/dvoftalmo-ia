import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateWeeklyBulletin } from "@/services/bulletins-generator";

export async function GET() {
  const supabase = await createClient();
  const user     = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bulletins")
    .select("id, se, ano, title, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const result = await generateWeeklyBulletin({
    se: body?.se,
    ano: body?.ano,
    force: Boolean(body?.force)
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
