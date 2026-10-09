"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Activity, Database, ShieldAlert } from "lucide-react";
import { NotificationsReportView } from "@/components/notifications/notifications-report-view";
import { CevespQualidadeView } from "@/components/cevesp/cevesp-qualidade-view";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import { parseCevespFilters } from "@/lib/cevesp-filters";
import { EpidemicZoneBanner } from "@/components/conjuntivite/epidemic-zone-banner";

type OuterTab = "situacao" | "qualidade" | "consulta";

const outerTabs: Array<{ id: OuterTab; label: string; icon: React.ElementType }> = [
  { id: "situacao",  label: "Situação", icon: Activity },
  { id: "qualidade", label: "Qualidade dos dados", icon: ShieldAlert },
  { id: "consulta",  label: "Consulta",                icon: Database },
];

export function ConjuntiviteHubView() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab: OuterTab =
    requestedTab === "qualidade" || requestedTab === "consulta"
      ? requestedTab
      : "situacao";
  const [tab, setTab] = useState<OuterTab>(initialTab);
  const [yearStart, setYearStart] = useState(searchParams.get("yearStart") ?? searchParams.get("ano") ?? "");
  const [yearEnd, setYearEnd] = useState(searchParams.get("yearEnd") ?? searchParams.get("anoFim") ?? "");
  const [gve, setGve] = useState(searchParams.get("gve") ?? "");
  const [municipio, setMunicipio] = useState(searchParams.get("municipio") ?? "");
  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gve), [gve]);

  const { reportFilters, filterError } = useMemo(() => {
    try {
      const parsed = parseCevespFilters(new URLSearchParams({ ano: yearStart, anoFim: yearEnd, gve, municipio }));
      return { reportFilters: { year: parsed.ano, yearEnd: parsed.anoFim, gve, municipio }, filterError: null };
    } catch (error) { return { reportFilters: undefined, filterError: (error as Error).message }; }
  }, [yearStart, yearEnd, gve, municipio]);

  const hasFilters = yearStart || yearEnd || gve || municipio;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      <EpidemicZoneBanner gve={gve || undefined} municipio={municipio || undefined} year={reportFilters?.yearEnd ?? reportFilters?.year} />
      <div className="px-4 pt-6 md:px-7 md:pt-7">
        <span className="text-[13px] font-semibold uppercase tracking-[0.04em] text-primary">Agravo · CEVESP</span>
        <h1 className="text-[28px] font-bold tracking-tight">Conjuntivite</h1>
      </div>
      <div className="sticky top-0 z-30 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b bg-background/95 px-4 pt-3 backdrop-blur-sm md:px-7">
        <div role="tablist" aria-label="Seções" className="-mx-1 flex max-w-full gap-1 overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {outerTabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-sm transition-colors ${
                  active
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2.5">
          <input
            type="number"
            value={yearStart}
            onChange={(e) => setYearStart(e.target.value)}
            aria-label="Ano inicial"
            min="1900" max="2100" step="1"
            placeholder="Ano início"
            className="h-10 w-28 rounded-lg border bg-background px-2.5 text-sm"
          />
          <input
            type="number"
            value={yearEnd}
            onChange={(e) => setYearEnd(e.target.value)}
            aria-label="Ano final"
            min="1900" max="2100" step="1"
            placeholder="Ano fim"
            className="h-10 w-28 rounded-lg border bg-background px-2.5 text-sm"
          />
          <select
            aria-label="Grupo de Vigilância Epidemiológica"
            value={gve}
            onChange={(e) => { setGve(e.target.value); setMunicipio(""); }}
            className="h-10 min-w-44 rounded-lg border bg-background px-2.5 text-sm"
          >
            <option value="">Todos os GVEs</option>
            {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            aria-label="Município"
            value={municipio}
            onChange={(e) => setMunicipio(e.target.value)}
            className="h-10 min-w-44 rounded-lg border bg-background px-2.5 text-sm"
          >
            <option value="">Todos os municípios</option>
            {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={() => { setYearStart(""); setYearEnd(""); setGve(""); setMunicipio(""); }}
              className="h-10 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      <div className="flex-1">
        {filterError && <p role="alert" className="m-6 rounded-md border border-destructive p-4 text-sm text-destructive">{filterError}</p>}
        {!filterError && tab === "situacao"  && <NotificationsReportView section="situacao" externalFilters={reportFilters} hideFilters />}
        {!filterError && tab === "qualidade" && <div className="px-4 py-6 md:px-7"><CevespQualidadeView externalFilters={reportFilters} /></div>}
        {!filterError && tab === "consulta"  && <NotificationsReportView section="consulta" externalFilters={reportFilters} hideFilters />}
      </div>
    </div>
  );
}
