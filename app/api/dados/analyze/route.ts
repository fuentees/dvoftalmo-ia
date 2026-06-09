import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { analyzeFile } from "@/services/data-analysis";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: `Arquivo muito grande (max 5 MB). Tamanho: ${(file.size / 1024 / 1024).toFixed(1)} MB.` }, { status: 413 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    return NextResponse.json({ error: "Formato nao suportado. Use .xlsx, .xls ou .csv." }, { status: 400 });
  }

  try {
    const result = await analyzeFile(file);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao analisar arquivo." },
      { status: 500 }
    );
  }
}
