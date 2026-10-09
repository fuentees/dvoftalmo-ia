"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ChoroplethMap } from "@/components/epidemiology/choropleth-map";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";

type PriorityLevel = "critica" | "alta" | "media";

type SituationPriority = {
  id: string;
  level: PriorityLevel;
  source: "alerta" | "cevesp" | "sinan" | "qualidade";
  agravo: "Conjuntivite" | "Tracoma" | "Dados";
  territorio: string;
  motivo: string;
  acao: string;
  prazo: string;
  evidenciaHref: string;
  score: number;
  detalhe?: string;
};

type SituationPriorities = {
  generatedAt: string;
  priorities: SituationPriority[];
  summary: { total: number; critica: number; alta: number; media: number };
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function priorityStyle(level: PriorityLevel) {
  if (level === "critica") return "border-red-200 bg-red-50 text-red-700";
  if (level === "alta") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function levelRank(level: PriorityLevel) {
  return level === "critica" ? 0 : level === "alta" ? 1 : 2;
}

function downloadCsv(filename: string, rows: SituationPriority[]) {
  if (!rows.length) return;
  const headers = ["prioridade", "agravo", "territorio", "motivo", "acao", "prazo", "detalhe", "evidencia"];
  const csvRows = rows.map((row) => [
    row.level,
    row.agravo,
    row.territorio,
    row.motivo,
    row.acao,
    row.prazo,
    row.detalhe ?? "",
    row.evidenciaHref
  ]);
  const csv = [
    headers.join(";"),
    ...csvRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(";"))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function TerritoriesView() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [agravo, setAgravo] = useState<"todos" | "Conjuntivite" | "Tracoma" | "Dados">(
    searchParams.get("agravo") === "Conjuntivite" || searchParams.get("agravo") === "Tracoma" || searchParams.get("agravo") === "Dados"
      ? searchParams.get("agravo") as "Conjuntivite" | "Tracoma" | "Dados"
      : "todos"
  );
  const [yearStart, setYearStart] = useState(searchParams.get("yearStart") ?? searchParams.get("ano") ?? "");
  const [yearEnd, setYearEnd] = useState(searchParams.get("yearEnd") ?? searchParams.get("anoFim") ?? "");
  const [gve, setGve] = useState(searchParams.get("gve") ?? "");
  const [municipio, setMunicipio] = useState(searchParams.get("municipio") ?? "");
  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gve), [gve]);

  const priorities = useQuery<SituationPriorities>({
    queryKey: ["situacao-prioridades-territorios", yearStart, yearEnd, gve, municipio],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (yearStart) params.set("yearStart", yearStart);
      if (yearEnd) params.set("yearEnd", yearEnd);
      if (gve) params.set("gve", gve);
      if (municipio) params.set("municipio", municipio);
      const qs = params.toString();
      const response = await fetch(`/api/situacao/prioridades${qs ? `?${qs}` : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar territórios");
      return data;
    },
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const searchedRows = useMemo(() => {
    const q = normalizeText(query);
    return [...(priorities.data?.priorities ?? [])]
      .filter((item) => {
        if (!q) return true;
        return normalizeText(`${item.territorio} ${item.motivo} ${item.acao} ${item.agravo}`).includes(q);
      })
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || b.score - a.score);
  }, [priorities.data?.priorities, query]);
  const rows = useMemo(
    () => searchedRows.filter((item) => agravo === "todos" || item.agravo === agravo),
    [agravo, searchedRows]
  );
  const [mapa, setMapa] = useState<"gve" | "municipio">("gve");
  const byAgravo = useMemo(() => {
    return (["Conjuntivite", "Tracoma", "Dados"] as const).map((item) => {
      const items = searchedRows.filter((row) => row.agravo === item);
      return {
        agravo: item,
        total: items.length,
        critica: items.filter((row) => row.level === "critica").length,
        alta: items.filter((row) => row.level === "alta").length
      };
    });
  }, [searchedRows]);

  // Mapa: nível de prioridade mais alto de cada território (3 crítica, 2 alta, 1 média)
  const nivelPorTerritorio = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const row of rows) {
      const valor = 3 - levelRank(row.level);
      mapa[row.territorio] = Math.max(mapa[row.territorio] ?? 0, valor);
    }
    return mapa;
  }, [rows]);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <PageHeader
        title="Territórios"
        description="Onde agir primeiro: casos, alertas e qualidade do dado por município e GVE, com o motivo de cada posição."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={() => priorities.refetch()} disabled={priorities.isFetching}>
              <RefreshCw className={`h-4 w-4 ${priorities.isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => downloadCsv(`territorios-priorizados-${new Date().toISOString().slice(0, 10)}.csv`, rows)}
              disabled={!rows.length}
            >
              Exportar CSV
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[13px] text-muted-foreground">
          Buscar
          <span className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Território, motivo ou ação" className="h-10 pl-9" />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Ano
          <input type="number" value={yearStart} onChange={(event) => setYearStart(event.target.value)} placeholder="Atual" className="h-10 w-24 rounded-lg border bg-background px-2.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          até
          <input type="number" value={yearEnd} onChange={(event) => setYearEnd(event.target.value)} className="h-10 w-24 rounded-lg border bg-background px-2.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          GVE
          <select value={gve} onChange={(event) => { setGve(event.target.value); setMunicipio(""); }} className="h-10 min-w-44 rounded-lg border bg-background px-2.5 text-sm text-foreground">
            <option value="">Todos os GVEs</option>
            {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Município
          <select value={municipio} onChange={(event) => setMunicipio(event.target.value)} className="h-10 min-w-48 rounded-lg border bg-background px-2.5 text-sm text-foreground">
            <option value="">Todos os municípios</option>
            {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
          </select>
        </label>
        {(yearStart || yearEnd || gve || municipio) && (
          <Button variant="ghost" className="h-10" onClick={() => { setYearStart(""); setYearEnd(""); setGve(""); setMunicipio(""); }}>Limpar</Button>
        )}
      </div>

      <div role="group" aria-label="Agravo" className="flex flex-wrap gap-2">
        {(["todos", "Conjuntivite", "Tracoma", "Dados"] as const).map((item) => {
          const info = byAgravo.find((b) => b.agravo === item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={agravo === item}
              onClick={() => setAgravo(item)}
              className={cn(
                "h-10 rounded-full border px-4 text-sm transition-colors",
                agravo === item ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-input bg-card hover:bg-muted"
              )}
            >
              {item === "todos" ? "Todos" : item === "Dados" ? "Qualidade do dado" : item}{" "}
              <span className="num">{(item === "todos" ? searchedRows.length : info?.total ?? 0).toLocaleString("pt-BR")}</span>
            </button>
          );
        })}
      </div>

      {priorities.isError && (
        <p role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Territórios indisponíveis nesta consulta: {priorities.error.message}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-5">
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[17px] font-semibold">Mapa de prioridade</h2>
            <div role="group" aria-label="Nível do mapa" className="inline-flex rounded-lg border p-0.5">
              {(["gve", "municipio"] as const).map((modo) => (
                <button
                  key={modo}
                  type="button"
                  aria-pressed={mapa === modo}
                  onClick={() => setMapa(modo)}
                  className={cn("h-9 rounded-md px-3 text-[13px]", mapa === modo ? "bg-secondary font-semibold text-secondary-foreground" : "text-muted-foreground")}
                >
                  {modo === "gve" ? "GVE" : "Município"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <ChoroplethMap
              dataUrl={`/api/geo/shapefiles?type=${mapa}`}
              valueMap={nivelPorTerritorio}
              colorScheme={(v) => (v == null ? "#E3E9E7" : v >= 3 ? "#B42318" : v >= 2 ? "#E3A06B" : "#7CC4B7")}
              label="Nível de prioridade"
            />
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#B42318]" />Crítica</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#E3A06B]" />Alta</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#7CC4B7]" />Média</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border bg-[#E3E9E7]" />Sem prioridade</span>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 xl:col-span-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-semibold">Ranking de prioridade</h2>
            <span className="num text-[13px] text-muted-foreground">{rows.length.toLocaleString("pt-BR")} território(s)</span>
          </div>
          {priorities.isLoading ? (
            <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : rows.length === 0 ? (
            <p className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mb-2 h-8 w-8 text-teal-600" aria-hidden="true" />
              Nenhum território priorizado com os filtros atuais.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-semibold">#</th>
                    <th className="px-2 py-2 font-semibold">Território</th>
                    <th className="px-2 py-2 font-semibold">Motivo</th>
                    <th className="px-2 py-2 font-semibold">Prazo</th>
                    <th className="px-2 py-2"><span className="sr-only">Abrir</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item, index) => (
                    <tr key={item.id} className="border-t align-top">
                      <td className="num px-2 py-3 text-muted-foreground">{index + 1}</td>
                      <td className="px-2 py-3">
                        <span className="block font-semibold">{item.territorio}</span>
                        <span className="text-xs text-muted-foreground">{item.agravo}</span>
                      </td>
                      <td className="px-2 py-3">
                        <Badge className={priorityStyle(item.level)}>{item.motivo}</Badge>
                        <p className="mt-1.5 text-[13px] text-muted-foreground">{item.acao}</p>
                        {item.detalhe && <p className="text-xs text-muted-foreground">{item.detalhe}</p>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-[13px]">{item.prazo}</td>
                      <td className="px-2 py-3 text-right">
                        <Link href={item.evidenciaHref} aria-label={`Abrir evidência de ${item.territorio}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-muted">
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
