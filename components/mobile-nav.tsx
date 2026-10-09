"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, Menu, X } from "lucide-react";
import { EpiWeekBadge } from "@/components/epi-week-badge";
import { SidebarContent } from "@/components/navigation/sidebar-content";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header className="flex h-14 items-center justify-between gap-2 bg-sidebar px-4 text-white md:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-brand text-sidebar">
            <Eye className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <span className="min-w-0 truncate text-sm font-bold">Oftalmologia Sanitária</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EpiWeekBadge className="border-sidebar-border bg-sidebar-active text-white" />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-sidebar-active"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[86vw] shadow-xl transition-transform duration-300 md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-active hover:text-white"
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </button>
        <SidebarContent onNavigate={() => setOpen(false)} showEpiWeek={false} />
      </div>
    </>
  );
}
