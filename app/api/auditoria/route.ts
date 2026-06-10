import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user     = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const skip  = Math.max(0, Number(request.nextUrl.searchParams.get("skip")  ?? 0));
  const limit = Math.min(100, Number(request.nextUrl.searchParams.get("limit") ?? 50));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("correction_audit_log")
    .select("*, applier:applied_by(full_name)")
    .order("applied_at", { ascending: false })
    .range(skip, skip + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

