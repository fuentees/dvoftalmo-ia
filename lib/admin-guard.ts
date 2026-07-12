import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageKnowledgeBase, canManageSystemSettings } from "@/lib/permissions";
import { isAuthDisabledForDev } from "@/lib/supabase/auth";
import type { UserRole } from "@/lib/types";

const roles: UserRole[] = ["admin", "coordenador", "supervisor", "usuario"];

function asUserRole(value: unknown): UserRole | undefined {
  return roles.includes(value as UserRole) ? (value as UserRole) : undefined;
}

export async function requireCevespSyncPermission(supabase: SupabaseClient, userId: string) {
  if (isAuthDisabledForDev()) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !canManageKnowledgeBase(asUserRole(data?.role))) {
    return NextResponse.json(
      { error: "Supervisores, coordenadores e administradores podem sincronizar os bancos de dados." },
      { status: 403 }
    );
  }

  return null;
}

export async function requireSystemSettingsPermission(supabase: SupabaseClient, userId: string) {
  if (isAuthDisabledForDev()) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !canManageSystemSettings(asUserRole(data?.role))) {
    return NextResponse.json(
      { error: "Coordenadores e administradores podem alterar configuracoes do sistema." },
      { status: 403 }
    );
  }

  return null;
}
