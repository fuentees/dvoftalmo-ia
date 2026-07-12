"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, Database, ShieldAlert } from "lucide-react";
import { TracomaAnaliseView } from "@/components/tracoma/tracoma-analise-view";
import { TracomaConsultaView } from "@/components/tracoma/tracoma-consulta-view";
import { SinanQualidadeView } from "@/components/sinan/sinan-qualidade-view";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";

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

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-6 py-2 backdrop-blur-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Tracoma · SINAN / NOTTRACONET
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
            value={yearStart}
            onChange={(event) => setYearStart(event.target.value)}
            placeholder="Ano início"
            className="h-8 w-24 rounded-md border bg-background px-2 text-xs"
          />
          <input
            type="number"
            value={yearEnd}
            onChange={(event) => setYearEnd(event.target.value)}
            placeholder="Ano fim"
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

      <div className="flex-1">
        {tab === "situacao"  && <TracomaAnaliseView externalFilters={filters} />}
        {tab === "qualidade" && <SinanQualidadeView externalFilters={filters} embedded />}
        {tab === "consulta"  && <TracomaConsultaView externalFilters={filters} hideFilters />}
      </div>
    </div>
  );
}
