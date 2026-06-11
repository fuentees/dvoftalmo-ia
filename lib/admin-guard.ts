import { NextResponse } from "next/server";
import { canUseAdminReports } from "@/lib/permissions";

export async function requireCevespSyncPermission(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !canUseAdminReports(data?.role)) {
    return NextResponse.json(
      { error: "Apenas administradores e coordenadores podem sincronizar o cache CEVESP." },
      { status: 403 }
    );
  }

  return null;
}
