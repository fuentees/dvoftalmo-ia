import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { applyCorrection } from "@/services/cevesp-corrections";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only coordinators and admins can apply corrections
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "coordenador"].includes(profile.role)) {
    return NextResponse.json({ error: "Permissão insuficiente." }, { status: 403 });
  }

  const body = await request.json() as { id: string };
  if (!body.id) return NextResponse.json({ error: "id obrigatório." }, { status: 400 });

  try {
    await applyCorrection(body.id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao aplicar correção." },
      { status: 500 }
    );
  }
}
