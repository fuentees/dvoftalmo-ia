import type { UserRole } from "@/lib/types";

const roleRank: Record<UserRole, number> = {
  admin: 4,
  coordenador: 3,
  supervisor: 2,
  usuario: 1
};

export function canManageUsers(role?: UserRole) {
  return role === "admin";
}

export function canManageKnowledgeBase(role?: UserRole) {
  return Boolean(role && roleRank[role] >= roleRank.supervisor);
}

export function canUseAdminReports(role?: UserRole) {
  return Boolean(role && roleRank[role] >= roleRank.coordenador);
}
