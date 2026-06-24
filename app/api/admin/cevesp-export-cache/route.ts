import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCevespSyncPermission } from "@/lib/admin-guard";

const HEADERS = [
  "ANO", "Mes", "SemEpidemio", "DtNotificacao", "MunicipioNotificacao", "IbgeNotificacao",
  "GVE_NOME", "gve_numero", "CodMacroGVE", "DRS_NOME", "drs_numero", "SUBGRUPOS_VE",
  "Unid_notificacao", "nCNES", "UVIS", "Nome_notificante", "CargoFuncao",
  "TotalCaso", "SexMasc", "SexFem",
  "FxMenorUmAno", "FxUmQuatro", "FxCincoNove", "FxDezQuatorze", "FxQuizeOuMais",
  "Surto", "NuSurto", "NuColetaMaterialBio", "ColetaMaterialBio", "NuAcaoEducativa",
  "NuTreinamento", "AfastamentoProfSintomatico", "NuEncamimento", "MedidaAdotada",
  "Excluido", "editable", "ID", "ControlaSubmit",
];

// PostgREST select string: case-sensitive columns need double-quote wrapping
const SELECT = HEADERS.map(h => `"${h}"`).join(",");

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  const year = request.nextUrl.searchParams.get("year");

  const admin = createAdminClient();
  const PAGE = 1000;
  let offset = 0;
  const rows: Record<string, unknown>[] = [];

  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = admin
      .from("cevesp_notificacoes")
      .select(SELECT)
      .order('"ANO"', { ascending: true })
      .order('"SemEpidemio"', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (year) {
      const y = parseInt(year, 10);
      if (!isNaN(y)) q = q.eq('"ANO"', y);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv =
    "﻿" +
    [HEADERS.join(","), ...rows.map(r => HEADERS.map(c => escape(r[c])).join(","))].join("\r\n");

  const yearSuffix = year ? `-${year}` : "";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="cevesp-notificacoes${yearSuffix}.csv"`,
      "X-Row-Count": String(rows.length),
    },
  });
}
