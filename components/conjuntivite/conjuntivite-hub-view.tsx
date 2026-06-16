"use client";

import { useState } from "react";
import { Activity, ShieldAlert } from "lucide-react";
import { NotificationsReportView } from "@/components/notifications/notifications-report-view";
import { CevespQualidadeView } from "@/components/cevesp/cevesp-qualidade-view";

type OuterTab = "analise" | "qualidade";

const outerTabs: Array<{ id: OuterTab; label: string; icon: React.ElementType }> = [
  { id: "analise",   label: "Análise Epidemiológica", icon: Activity    },
  { id: "qualidade", label: "Qualidade dos Dados",    icon: ShieldAlert }
];

export function ConjuntiviteHubView() {
  const [tab, setTab] = useState<OuterTab>("analise");

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-6 py-2 backdrop-blur-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Conjuntivite · CEVESP
        </span>
        <div className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {outerTabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1">
        {tab === "analise"   && <NotificationsReportView />}
        {tab === "qualidade" && <CevespQualidadeView />}
      </div>
    </div>
  );
}
