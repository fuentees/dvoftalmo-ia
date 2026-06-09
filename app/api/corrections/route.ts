import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { emailCorrectionReviewed } from "@/services/email";

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

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["admin", "coordenador"].includes(profile.role)) {
    return NextResponse.json({ error: "Permissão insuficiente. Somente coordenadores e administradores podem revisar correções." }, { status: 403 });
  }

  const body = await request.json() as { id: string; action: "approve" | "reject" };
  if (!body.id || !["approve", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "id e action obrigatórios." }, { status: 400 });
  }

  const newStatus = body.action === "approve" ? "approved" : "rejected";

  const { data: correctionRow } = await supabase
    .from("correction_queue")
    .select("field_name, new_value, record_id")
    .eq("id", body.id)
    .single();

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

  // fire-and-forget email — non-critical
  if (correctionRow) {
    emailCorrectionReviewed({
      action:       body.action,
      fieldName:    correctionRow.field_name ?? "campo",
      recordId:     String(correctionRow.record_id ?? body.id),
      newValue:     String(correctionRow.new_value ?? ""),
      reviewerName: profile.role
    }).catch(() => { /* non-critical */ });
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
