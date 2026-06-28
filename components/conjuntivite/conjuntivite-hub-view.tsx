"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Activity, Database, ShieldAlert } from "lucide-react";
import { NotificationsReportView } from "@/components/notifications/notifications-report-view";
import { CevespQualidadeView } from "@/components/cevesp/cevesp-qualidade-view";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";

type OuterTab = "situacao" | "qualidade" | "consulta";

const outerTabs: Array<{ id: OuterTab; label: string; icon: React.ElementType }> = [
  { id: "situacao",  label: "Situação Epidemiológica", icon: Activity },
  { id: "qualidade", label: "Qualidade dos Dados",     icon: ShieldAlert },
  { id: "consulta",  label: "Consulta",                icon: Database }
];

export function ConjuntiviteHubView() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab: OuterTab = requestedTab === "qualidade" || requestedTab === "consulta" ? requestedTab : "situacao";
  const [tab, setTab] = useState<OuterTab>(initialTab);
  const [year, setYear] = useState("");
  const [gve, setGve] = useState("");
  const [municipio, setMunicipio] = useState("");
  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gve), [gve]);
  const filters = useMemo(() => ({
    year: year ? Number(year) : undefined,
    gve,
    municipio
  }), [year, gve, municipio]);

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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            type="number"
            value={year}
            onChange={(event) => setYear(event.target.value)}
            placeholder="Ano"
            className="h-8 w-24 rounded-md border bg-background px-2 text-xs"
          />
          <select
            value={gve}
            onChange={(event) => { setGve(event.target.value); setMunicipio(""); }}
            className="h-8 min-w-40 rounded-md border bg-background px-2 text-xs"
          >
            <option value="">Todos os GVEs</option>
            {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            value={municipio}
            onChange={(event) => setMunicipio(event.target.value)}
            className="h-8 min-w-40 rounded-md border bg-background px-2 text-xs"
          >
            <option value="">Todos os municípios</option>
            {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
          </select>
          {(year || gve || municipio) && (
            <button
              type="button"
              onClick={() => { setYear(""); setGve(""); setMunicipio(""); }}
              className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      <div className="flex-1">
        {tab === "situacao"  && <NotificationsReportView section="situacao" externalFilters={filters} hideFilters />}
        {tab === "qualidade" && <CevespQualidadeView externalFilters={filters} />}
        {tab === "consulta"  && <NotificationsReportView section="consulta" externalFilters={filters} hideFilters />}
      </div>
    </div>
  );
}
