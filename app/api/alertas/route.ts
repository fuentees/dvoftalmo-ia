import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateEpidemiologicalAlerts } from "@/services/epidemiological-alerts";

const VALID_STATUSES = new Set(["novo", "em_investigacao", "confirmado", "descartado", "encerrado"]);

export async function GET() {
  const supabase = await createClient();
  const user     = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("epidemiological_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json([], {
        headers: { "X-DvOftalmo-Warning": `Alertas indisponiveis: ${error.message}` }
      });
    }
    return NextResponse.json(data ?? []);
  } catch (error) {
    return NextResponse.json([], {
      headers: {
        "X-DvOftalmo-Warning": `Alertas indisponiveis: ${error instanceof Error ? error.message : String(error)}`
      }
    });
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const user     = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, status, note } = await request.json() as { id: string; status?: string; note?: string };
  if (!id) return NextResponse.json({ error: "id obrigatório." }, { status: 400 });
  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "status inválido." }, { status: 400 });
  }

  const nextStatus = status ?? "encerrado";
  const acknowledged = nextStatus === "descartado" || nextStatus === "encerrado";
  const updatePayload = {
    acknowledged,
    status: nextStatus,
    status_note: note?.trim() || null,
    status_updated_at: new Date().toISOString(),
    closed_at: acknowledged ? new Date().toISOString() : null
  };

  const admin = createAdminClient();
  const { error } = await admin
    .from("epidemiological_alerts")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    const legacy = await admin
      .from("epidemiological_alerts")
      .update({ acknowledged })
      .eq("id", id);
    if (legacy.error) return NextResponse.json({ error: legacy.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, legacy: true });
  }
  return NextResponse.json({ ok: true });
}

export async function POST() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await generateEpidemiologicalAlerts());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao gerar alertas." },
      { status: 500 }
    );
  }
}
