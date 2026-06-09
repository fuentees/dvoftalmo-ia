import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = request.nextUrl.searchParams.get("status") ?? "pending";

  const { data, error } = await supabase
    .from("correction_queue")
    .select("*, proposer:proposed_by(full_name), reviewer:reviewed_by(full_name)")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { id: string; action: "approve" | "reject" };
  if (!body.id || !["approve", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "id e action obrigatórios." }, { status: 400 });
  }

  const newStatus = body.action === "approve" ? "approved" : "rejected";

  const { error } = await supabase
    .from("correction_queue")
    .update({
      status: newStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", body.id)
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: newStatus });
}
