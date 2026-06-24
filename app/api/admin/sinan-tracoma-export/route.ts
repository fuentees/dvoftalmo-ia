import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCevespSyncPermission } from "@/lib/admin-guard";

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
  const allRows: Array<{ source_bank: string; raw: Record<string, unknown> }> = [];

  for (;;) {
    let q = admin
      .from("sinan_tracoma_rows")
      .select("source_bank,raw")
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
    allRows.push(...(data as unknown as typeof allRows));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // Collect all unique keys from raw JSONB across all rows, preserving insertion order
  const keySet = new Set<string>();
  for (const row of allRows) {
    if (row.raw && typeof row.raw === "object") {
      for (const k of Object.keys(row.raw)) keySet.add(k);
    }
  }
  const rawKeys = Array.from(keySet);

  // source_bank first, then all original SINAN columns from raw
  const headers = ["source_bank", ...rawKeys];

  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(","),
    ...allRows.map(row => {
      const raw = row.raw ?? {};
      return [
        escape(row.source_bank),
        ...rawKeys.map(k => escape(raw[k])),
      ].join(",");
    }),
  ];

  const csv = "﻿" + lines.join("\r\n");
  const bankSuffix = bank === "traconet" || bank === "nottraconet" ? `-${bank}` : "";
  const yearSuffix = year ? `-${year}` : "";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="sinan-tracoma${bankSuffix}${yearSuffix}.csv"`,
      "X-Row-Count": String(allRows.length),
    },
  });
}
