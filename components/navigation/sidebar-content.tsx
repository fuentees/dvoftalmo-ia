"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Eye, LogOut, Moon, Sun } from "lucide-react";
import { navigationGroups } from "@/components/navigation/nav-items";
import { EpiWeekBadge } from "@/components/epi-week-badge";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const authDisabledForDev = process.env.NEXT_PUBLIC_DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Conteúdo do menu lateral, usado no desktop (fixo) e no celular (gaveta). */
export function SidebarContent({ onNavigate, showEpiWeek = true }: { onNavigate?: () => void; showEpiWeek?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [dark, setDark] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    if (authDisabledForDev) {
      setUserEmail("dev@local.test");
      setUserName("Desenvolvimento local");
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email ?? "");
        setUserName(data.user.user_metadata?.full_name ?? data.user.email?.split("@")[0] ?? "");
      }
    });
  }, [supabase]);

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle("dark");
    setDark(isDark);
    try { localStorage.setItem("dvoftalmo_theme", isDark ? "dark" : "light"); } catch { /* ignore */ }
  }

  async function handleLogout() {
    if (authDisabledForDev) {
      router.push("/dashboard");
      return;
    }
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="flex h-full flex-col gap-5 bg-sidebar px-3.5 py-5 text-sidebar-foreground">
      <div className="space-y-3 px-1.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-brand text-sidebar">
            <Eye className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-bold text-white">Oftalmologia Sanitária</p>
            <p className="truncate text-xs text-sidebar-muted">CVE · SES-SP</p>
          </div>
        </div>
        {showEpiWeek && (
          <p className="flex items-center gap-2 text-xs text-sidebar-muted">
            <EpiWeekBadge className="num border-sidebar-border bg-sidebar-active text-[11px] text-white" />
            semana em curso
          </p>
        )}
      </div>

      <nav aria-label="Menu principal" className="flex-1 space-y-5 overflow-y-auto">
        {navigationGroups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.description}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
                    active
                      ? "bg-sidebar-active font-semibold text-white"
                      : "font-medium text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white"
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-sidebar-border px-1.5 pt-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-[13px] font-semibold text-white">
          {initials(userName || "Usuário")}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium text-white">{userName || "Usuário"}</p>
          <p className="truncate text-xs text-sidebar-muted">{userEmail}</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-white"
        >
          {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          aria-label="Sair"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-white disabled:opacity-50"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}
