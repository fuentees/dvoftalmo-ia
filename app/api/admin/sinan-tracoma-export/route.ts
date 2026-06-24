import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCevespSyncPermission } from "@/lib/admin-guard";

const COLUMNS = [
  "source_bank", "ano", "dt_notificacao", "municipio", "ibge", "gve", "drs",
  "unidade", "agravo", "classificacao", "criterio", "evolucao", "tratamento",
  "conclusao", "imported_at",
];

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  const bank = request.nextUrl.searchParams.get("bank");
  const year = request.nextUrl.searchParams.get("year");

  const admin = createAdminClient();
  const PAGE = 1000;
  let offset = 0;
  const rows: Record<string, unknown>[] = [];

  for (;;) {
    let q = admin
      .from("sinan_tracoma_rows")
      .select(COLUMNS.join(","))
      .order("ano", { ascending: true })
      .order("dt_notificacao", { ascending: true, nullsFirst: true })
      .range(offset, offset + PAGE - 1);

    if (bank === "traconet" || bank === "nottraconet") {
      q = q.eq("source_bank", bank);
    }
    if (year) {
      const y = parseInt(year, 10);
      if (!isNaN(y)) q = q.eq("ano", y);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Record<string, unknown>[]));
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
    [COLUMNS.join(","), ...rows.map(r => COLUMNS.map(c => escape(r[c])).join(","))].join("\r\n");

  const bankSuffix = bank === "traconet" || bank === "nottraconet" ? `-${bank}` : "";
  const yearSuffix = year ? `-${year}` : "";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="sinan-tracoma${bankSuffix}${yearSuffix}.csv"`,
      "X-Row-Count": String(rows.length),
    },
  });
}
