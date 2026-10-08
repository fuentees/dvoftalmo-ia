import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { estimateAzithromycin } from "@/services/tracoma-analytics";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json() as {
      targetPopulation?: number;
      coveragePercent?: number;
      childrenRatio?: number;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Envie um objeto JSON válido." }, { status: 400 });
  }

  if (!body.targetPopulation || body.targetPopulation < 1) {
    return NextResponse.json({ error: "targetPopulation obrigatorio e deve ser >= 1." }, { status: 400 });
  }

  try {
    const result = estimateAzithromycin({
      targetPopulation: body.targetPopulation,
      coveragePercent: body.coveragePercent,
      childrenRatio: body.childrenRatio
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Parâmetros inválidos." }, { status: 400 });
  }
}
