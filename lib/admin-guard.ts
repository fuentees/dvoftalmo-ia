import { NextResponse } from "next/server";
import { canManageKnowledgeBase } from "@/lib/permissions";

export async function requireCevespSyncPermission(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !canManageKnowledgeBase(data?.role)) {
    return NextResponse.json(
      { error: "Supervisores, coordenadores e administradores podem sincronizar os bancos de dados." },
      { status: 403 }
    );
  }

  return null;
}
