import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { estimateAzithromycin } from "@/services/tracoma-analytics";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    targetPopulation?: number;
    coveragePercent?: number;
    childrenRatio?: number;
  };

  if (!body.targetPopulation || body.targetPopulation < 1) {
    return NextResponse.json({ error: "targetPopulation obrigatorio e deve ser >= 1." }, { status: 400 });
  }

  const result = estimateAzithromycin({
    targetPopulation: body.targetPopulation,
    coveragePercent: body.coveragePercent,
    childrenRatio: body.childrenRatio
  });

  return NextResponse.json(result);
}
