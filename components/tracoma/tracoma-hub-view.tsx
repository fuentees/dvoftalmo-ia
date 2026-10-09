"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, Database, ShieldAlert } from "lucide-react";
import { TracomaAnaliseView } from "@/components/tracoma/tracoma-analise-view";
import { TracomaConsultaView } from "@/components/tracoma/tracoma-consulta-view";
import { SinanQualidadeView } from "@/components/sinan/sinan-qualidade-view";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import { validateTracomaFilters } from "@/lib/tracoma-data";

type OuterTab = "situacao" | "qualidade" | "consulta";

const outerTabs: Array<{ id: OuterTab; label: string; icon: React.ElementType }> = [
  { id: "situacao",  label: "Situação", icon: Activity },
  { id: "qualidade", label: "Qualidade dos dados", icon: ShieldAlert },
  { id: "consulta",  label: "Consulta",                icon: Database }
];

export function TracomaHubView() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initial: OuterTab = requestedTab === "qualidade" || requestedTab === "consulta" ? requestedTab : "situacao";
  const [tab, setTab] = useState<OuterTab>(initial);
  const [yearStart, setYearStart] = useState(searchParams.get("yearStart") ?? searchParams.get("ano") ?? "");
  const [yearEnd, setYearEnd] = useState(searchParams.get("yearEnd") ?? searchParams.get("anoFim") ?? "");
  const [gve, setGve] = useState(searchParams.get("gve") ?? "");
  const [municipio, setMunicipio] = useState(searchParams.get("municipio") ?? "");
  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gve), [gve]);
  const filters = useMemo(() => ({ yearStart, yearEnd, gve, municipio }), [yearStart, yearEnd, gve, municipio]);
  const filterError = useMemo(() => {
    try { validateTracomaFilters(filters); return ""; } catch (error) { return (error as Error).message; }
  }, [filters]);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      <div className="px-4 pt-6 md:px-7 md:pt-7">
        <span className="text-[13px] font-semibold uppercase tracking-[0.04em] text-primary">Agravo · SINAN</span>
        <h1 className="text-[28px] font-bold tracking-tight">Tracoma</h1>
      </div>
      <div className="sticky top-0 z-30 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b bg-background/95 px-4 pt-3 backdrop-blur-sm md:px-7">
        <div role="tablist" aria-label="Seções do painel de tracoma" className="-mx-1 flex max-w-full gap-1 overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {outerTabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="tracoma-panel"
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
        <div className="flex w-full flex-wrap items-center gap-2 pb-2.5 lg:w-auto">
          <input
            type="number"
            min={1975}
            max={new Date().getFullYear()}
            aria-label="Ano inicial do tracoma"
            value={yearStart}
            onChange={(event) => setYearStart(event.target.value)}
            placeholder="Ano início"
            className="h-10 w-28 rounded-lg border bg-background px-2.5 text-sm"
          />
          <input
            type="number"
            min={1975}
            max={new Date().getFullYear()}
            aria-label="Ano final do tracoma"
            value={yearEnd}
            onChange={(event) => setYearEnd(event.target.value)}
            placeholder="Ano fim"
            className="h-10 w-28 rounded-lg border bg-background px-2.5 text-sm"
          />
          <select
            value={gve}
            aria-label="GVE do tracoma"
            onChange={(event) => { setGve(event.target.value); setMunicipio(""); }}
            className="h-10 min-w-0 max-w-full flex-1 rounded-lg border bg-background px-2.5 text-sm sm:min-w-44 sm:flex-none"
          >
            <option value="">Todos os GVEs</option>
            {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            value={municipio}
            aria-label="Município do tracoma"
            onChange={(event) => setMunicipio(event.target.value)}
            className="h-10 min-w-0 max-w-full flex-1 rounded-lg border bg-background px-2.5 text-sm sm:min-w-44 sm:flex-none"
          >
            <option value="">Todos os municípios</option>
            {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
          </select>
          {(yearStart || yearEnd || gve || municipio) && (
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

      <div id="tracoma-panel" role="tabpanel" className="min-w-0 flex-1">
        {filterError ? <p role="alert" className="m-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{filterError}</p> : <>
          {tab === "situacao" && <TracomaAnaliseView externalFilters={filters} />}
          {tab === "qualidade" && <SinanQualidadeView externalFilters={filters} embedded />}
          {tab === "consulta" && <TracomaConsultaView externalFilters={filters} hideFilters />}
        </>}
      </div>
    </div>
  );
}
