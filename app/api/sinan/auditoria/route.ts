import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { auditarSinanTracoma } from "@/services/sinan-tracoma";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const municipio  = searchParams.get("municipio")  ?? undefined;
  const gve        = searchParams.get("gve")        ?? undefined;
  const yearStart  = searchParams.get("yearStart")  ? Number(searchParams.get("yearStart"))  : undefined;
  const yearEnd    = searchParams.get("yearEnd")    ? Number(searchParams.get("yearEnd"))    : undefined;

  try {
    const result = await auditarSinanTracoma({ municipio, gve, yearStart, yearEnd });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("sinan_tracoma_rows")) {
      return NextResponse.json(
        { error: "tabela_ausente", message: "A tabela SINAN Tracoma ainda não foi criada. Execute a migration no Supabase SQL Editor." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
