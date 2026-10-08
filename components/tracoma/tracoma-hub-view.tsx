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
  { id: "situacao",  label: "Situação Epidemiológica", icon: Activity },
  { id: "qualidade", label: "Qualidade dos Dados",     icon: ShieldAlert },
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
    <div className="flex flex-col">
      <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur-sm sm:px-6">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Tracoma · SINAN / NOTTRACONET
        </span>
        <div role="tablist" aria-label="Seções do painel de tracoma" className="flex max-w-full flex-wrap gap-0.5 rounded-lg bg-muted/60 p-0.5">
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
        <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
          <input
            type="number"
            min={1975}
            max={new Date().getFullYear()}
            aria-label="Ano inicial do tracoma"
            value={yearStart}
            onChange={(event) => setYearStart(event.target.value)}
            placeholder="Ano início"
            className="h-8 w-24 rounded-md border bg-background px-2 text-xs"
          />
          <input
            type="number"
            min={1975}
            max={new Date().getFullYear()}
            aria-label="Ano final do tracoma"
            value={yearEnd}
            onChange={(event) => setYearEnd(event.target.value)}
            placeholder="Ano fim"
            className="h-8 w-24 rounded-md border bg-background px-2 text-xs"
          />
          <select
            value={gve}
            aria-label="GVE do tracoma"
            onChange={(event) => { setGve(event.target.value); setMunicipio(""); }}
            className="h-8 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 text-xs sm:min-w-40 sm:flex-none"
          >
            <option value="">Todos os GVEs</option>
            {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            value={municipio}
            aria-label="Município do tracoma"
            onChange={(event) => setMunicipio(event.target.value)}
            className="h-8 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 text-xs sm:min-w-40 sm:flex-none"
          >
            <option value="">Todos os municípios</option>
            {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
          </select>
          {(yearStart || yearEnd || gve || municipio) && (
            <button
              type="button"
              onClick={() => { setYearStart(""); setYearEnd(""); setGve(""); setMunicipio(""); }}
              className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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
