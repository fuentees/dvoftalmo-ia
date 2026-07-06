import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { MODEL_CATALOG } from "@/lib/ai-models";

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("profiles")
    .select("full_name,email,role,selected_model")
    .eq("id", user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { selected_model?: string | null };

  if (body.selected_model !== undefined) {
    const valid = body.selected_model === null || MODEL_CATALOG.some((m) => m.id === body.selected_model);
    if (!valid) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ selected_model: body.selected_model ?? null, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
