"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronRight, LogOut, Moon, Sun, User } from "lucide-react";
import { navigationGroups } from "@/components/navigation/nav-items";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const authDisabledForDev = process.env.NEXT_PUBLIC_DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";

export function AppSidebar() {
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
        setUserName(
          data.user.user_metadata?.full_name ??
          data.user.email?.split("@")[0] ??
          ""
        );
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
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-3 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <BarChart3 className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">Centro de Oftalmologia Sanitária</p>
          <p className="truncate text-[11px] text-muted-foreground">Vigilância em Saúde · SP</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navigationGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex min-h-10 items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-primary" : "")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      <span className={cn("block truncate text-[10px] font-normal", active ? "text-primary/70" : "text-muted-foreground/70")}>
                        {item.description}
                      </span>
                    </span>
                    {active && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <User className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium leading-tight">{userName || "Usuário"}</p>
            <p className="truncate text-[10px] text-muted-foreground">{userEmail}</p>
          </div>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={toggleTheme}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {dark ? "Claro" : "Escuro"}
          </button>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" />
            {loggingOut ? "Saindo..." : "Sair"}
          </button>
        </div>
      </div>
    </aside>
  );
}
