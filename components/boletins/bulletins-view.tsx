"use client";

import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft, Calendar, ChevronRight, Clipboard, Eye, Loader2,
  Newspaper, Plus, Printer, RefreshCw, RotateCcw
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChoroplethMap } from "@/components/epidemiology/choropleth-map";
import { currentCalendarYear, currentEpiWeek, shiftEpiWeek } from "@/lib/epi-week";

type Agravo = "conjuntivite" | "tracoma";
type AccentColor = "blue" | "teal";

interface BulletinSummary {
  id: string;
  se: number;
  ano: number;
  agravo: Agravo;
  title: string;
  created_at: string;
}

interface BulletinDetail extends BulletinSummary {
  content: string;
}

interface MapDataRow {
  municipio: string;
  gve: string;
  examinados: number;
  positivos: number;
  prevalencia: number;
}

interface GveMapRow {
  gve: string;
  casos: number;
}

interface MuniMapRow {
  municipio: string;
  gve: string;
  casos: number;
}

interface SeHistoryRow {
  se: number;
  notificacoes: number;
  casos: number;
  surtos: number;
  coletas: number;
  acoes: number;
  treinamentos: number;
  encaminhamentos: number;
}

interface YearHistoryRow {
  ano: number;
  munis: number;
  examinados: number;
  positivos: number;
  prevalencia: number;
  traconet: number;
  tt: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "Não foi possível concluir a operação.");
  return payload;
}

// Clean AI-generated content:
//   1. Strip leading numbers from headings ("## 1. Título" → "## Título")
//   2. Remove any preamble (AI-generated title, institutional header) before the first ## section
function cleanContent(md: string): string {
  let clean = md.replace(/^(#{1,6})\s+\d+[\.\-\)]\s*/gm, "$1 ");
  const firstH2 = clean.search(/^##\s/m);
  if (firstH2 > 0) clean = clean.slice(firstH2);
  return clean.trim();
}

// ──── Markdown component factory — adapts to disease color theme ───────────────
function makeMdComponents(accent: AccentColor): React.ComponentProps<typeof ReactMarkdown>["components"] {
  const headingColor = accent === "blue" ? "text-blue-900" : "text-teal-900";
  const barColor     = accent === "blue" ? "bg-blue-700"   : "bg-teal-600";
  const h3Color      = accent === "blue" ? "text-blue-800" : "text-teal-800";
  const thBg         = accent === "blue" ? "bg-blue-800"   : "bg-teal-800";
  const thBorder     = accent === "blue" ? "border-blue-200" : "border-teal-200";
  const tdBorder     = accent === "blue" ? "border-blue-50"  : "border-teal-50";
  const evenRow      = accent === "blue" ? "even:bg-blue-50/40" : "even:bg-teal-50/40";
  const tableBorder  = accent === "blue" ? "border-blue-100" : "border-teal-100";
  const bqClasses    = accent === "blue"
    ? "border-blue-500 bg-blue-50/60 text-blue-900"
    : "border-teal-500 bg-teal-50/60 text-teal-900";
  const hrColor = accent === "blue" ? "border-blue-100" : "border-teal-100";

  return {
    h1: ({ children }) => (
      <h1 className={`mb-4 mt-8 text-base font-extrabold uppercase tracking-wide ${headingColor} first:mt-0`}>{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className={`mb-3 mt-8 flex items-start gap-2 text-sm font-extrabold uppercase tracking-wider ${headingColor} first:mt-0`}>
        <span className={`mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm ${barColor}`} aria-hidden />
        <span>{children}</span>
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className={`mb-2 mt-5 font-bold ${h3Color}`}>{children}</h3>
    ),
    p: ({ children }) => (
      <p className="mb-3 text-[13px] leading-[1.75] text-gray-700 text-justify hyphens-auto">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[13px] text-gray-700">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-[13px] text-gray-700">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="leading-[1.7] text-justify hyphens-auto">{children}</li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-gray-900">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    blockquote: ({ children }) => (
      <blockquote className={`my-4 rounded-r-md border-l-4 px-4 py-3 text-[13px] leading-relaxed ${bqClasses}`}>
        {children}
      </blockquote>
    ),
    hr: () => <hr className={`my-6 border-t ${hrColor}`} />,
    table: ({ children }) => (
      <div className={`mb-5 overflow-x-auto rounded-lg border shadow-sm ${tableBorder}`}>
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    th: ({ children }) => (
      <th className={`border-b ${thBorder} ${thBg} px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white`}>
        {children}
      </th>
    ),
    tr: ({ children }) => (
      <tr className={`transition-colors ${evenRow}`}>{children}</tr>
    ),
    td: ({ children }) => (
      <td className={`border-b ${tdBorder} px-4 py-2.5 text-gray-700`}>{children}</td>
    ),
  };
}

// ──── Configs per disease ─────────────────────────────────────────────────────
const AGRAVO_CONFIG = {
  conjuntivite: {
    label: "Conjuntivite",
    subtitle: "Boletim semanal — CEVESP/SES-SP",
    divisionLabel: "Centro de Oftalmologia Sanitária",
    headerClass: "bg-blue-900",
    accentClass: "bg-blue-700",
    accent: "blue" as AccentColor,
    badgeClass: "bg-blue-700 text-white hover:bg-blue-700",
    cardClass: "border-blue-100",
    seLabel: (se: number, ano: number) => `SE ${String(se).padStart(2, "0")}/${ano}`,
    seDisplay: (se: number) => String(se).padStart(2, "0"),
  },
  tracoma: {
    label: "Tracoma",
    subtitle: "Boletim anual/período — SINAN/SES-SP",
    divisionLabel: "Centro de Oftalmologia Sanitária — Programa de Eliminação do Tracoma",
    headerClass: "bg-teal-900",
    accentClass: "bg-teal-700",
    accent: "teal" as AccentColor,
    badgeClass: "bg-teal-700 text-white hover:bg-teal-700",
    cardClass: "border-teal-100",
    seLabel: (se: number, ano: number) => se > 0 ? `Período ${se}–${ano}` : `Ano ${ano}`,
    seDisplay: (se: number) => se > 0 ? "PER" : "ANO",
  },
};

// ──── TracomaMapSection ───────────────────────────────────────────────────────
function TracomaMapSection({ ano }: { ano: number }) {
  const { data: rows, isLoading } = useQuery<MapDataRow[]>({
    queryKey: ["tracoma-map", ano],
    queryFn: () => fetchJson(`/api/boletins/mapdata?agravo=tracoma&ano=${ano}`)
  });

  const valueMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const row of rows ?? []) {
      if (row.municipio) m[row.municipio] = row.prevalencia;
    }
    return m;
  }, [rows]);

  const hotspots = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.prevalencia - a.prevalencia).slice(0, 6),
    [rows]
  );

  if (isLoading) {
    return (
      <div className="mb-6 flex h-32 items-center justify-center rounded-lg border border-dashed border-teal-200 text-sm text-teal-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando mapa...
      </div>
    );
  }

  if (!rows?.length) return null;

  return (
    <div className="mb-8 print:break-inside-avoid">
      <div className="mb-3 flex items-start gap-2 text-sm font-extrabold uppercase tracking-wider text-teal-900">
        <span className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm bg-teal-600" aria-hidden />
        <span>Distribuição Geográfica — Prevalência de Tracoma por Município (%)</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_1fr]">
        {/* Map */}
        <div className="overflow-hidden rounded-xl border border-teal-100 shadow-sm">
          <ChoroplethMap
            dataUrl="/api/geo/shapefiles?type=municipio"
            valueMap={valueMap}
            colorScheme={(v) => {
              if (v === null || v === undefined) return "#e2e8f0";
              if (v >= 5)   return "#dc2626";
              if (v >= 2)   return "#f97316";
              if (v >= 0.5) return "#fbbf24";
              return "#6ee7b7";
            }}
            label="Prevalência de Tracoma (%)"
          />
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3 text-xs">
          {/* Hotspots */}
          <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-3">
            <p className="mb-2 font-bold uppercase tracking-wide text-teal-900">
              Maiores prevalências
            </p>
            <div className="space-y-1.5">
              {hotspots.map((row, i) => (
                <div key={row.municipio} className="flex items-center justify-between gap-1">
                  <span className="truncate text-gray-700">{i + 1}. {row.municipio}</span>
                  <span className={`whitespace-nowrap font-bold ${row.prevalencia >= 5 ? "text-red-600" : "text-amber-600"}`}>
                    {row.prevalencia.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="rounded-xl border border-teal-100 p-3">
            <p className="mb-2 font-bold uppercase tracking-wide text-teal-900">Legenda</p>
            <div className="space-y-1.5 text-gray-600">
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#dc2626" }} />
                <span>≥ 5% — acima da meta OMS</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#f97316" }} />
                <span>2 – 5% — atenção</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#fbbf24" }} />
                <span>0,5 – 2% — baixa</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#6ee7b7" }} />
                <span>{"< 0,5%"} — muito baixa</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm bg-slate-200" />
                <span>Sem dados</span>
              </div>
            </div>
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-gray-400">
            Meta OMS: TF {"< 5%"} em crianças de 1–9 anos para eliminação como problema de saúde pública.
          </p>
        </div>
      </div>
    </div>
  );
}

// ──── ConjuntiviteMuniMapSection ─────────────────────────────────────────────
function ConjuntiviteMuniMapSection({ se, ano }: { se: number; ano: number }) {
  const { data: rows, isLoading } = useQuery<MuniMapRow[]>({
    queryKey: ["conjuntivite-muni-map", se, ano],
    queryFn: () => fetchJson(`/api/boletins/mapdata?agravo=conjuntivite&level=municipio&se=${se}&ano=${ano}`)
  });

  const valueMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const row of rows ?? []) {
      if (row.municipio) m[row.municipio] = row.casos;
    }
    return m;
  }, [rows]);

  const topMunis = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.casos - a.casos).slice(0, 8),
    [rows]
  );

  if (isLoading) {
    return (
      <div className="mb-6 flex h-32 items-center justify-center rounded-lg border border-dashed border-blue-200 text-sm text-blue-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando mapa de municípios...
      </div>
    );
  }

  if (!rows?.length) return null;

  const maxCasos = Math.max(...(rows ?? []).map(r => r.casos), 1);

  return (
    <div className="mb-8 print:break-inside-avoid">
      <div className="mb-3 flex items-start gap-2 text-sm font-extrabold uppercase tracking-wider text-blue-900">
        <span className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm bg-blue-700" aria-hidden />
        <span>Distribuição por Município — Casos de Conjuntivite</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_1fr]">
        {/* Map */}
        <div className="overflow-hidden rounded-xl border border-blue-100 shadow-sm">
          <ChoroplethMap
            dataUrl="/api/geo/shapefiles?type=municipio"
            valueMap={valueMap}
            colorScheme={(v) => {
              if (v === null || v === undefined) return "#e2e8f0";
              const ratio = v / maxCasos;
              if (ratio >= 0.75) return "#1d4ed8";
              if (ratio >= 0.5)  return "#3b82f6";
              if (ratio >= 0.25) return "#93c5fd";
              return "#dbeafe";
            }}
            label="Casos de Conjuntivite por Município"
          />
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3 text-xs">
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <p className="mb-2 font-bold uppercase tracking-wide text-blue-900">Municípios com mais casos</p>
            <div className="space-y-1.5">
              {topMunis.map((row, i) => (
                <div key={row.municipio} className="flex items-center justify-between gap-1">
                  <span className="truncate text-gray-700">{i + 1}. {row.municipio}</span>
                  <span className="whitespace-nowrap font-bold text-blue-700">{row.casos}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 p-3">
            <p className="mb-2 font-bold uppercase tracking-wide text-blue-900">Legenda</p>
            <div className="space-y-1.5 text-gray-600">
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#1d4ed8" }} />
                <span>Maior concentração</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#3b82f6" }} />
                <span>Alta</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#93c5fd" }} />
                <span>Moderada</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#dbeafe" }} />
                <span>Baixa</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm bg-slate-200" />
                <span>Sem notificação</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──── ConjuntiviteMapSection ──────────────────────────────────────────────────
function ConjuntiviteMapSection({ se, ano }: { se: number; ano: number }) {
  const { data: rows, isLoading } = useQuery<GveMapRow[]>({
    queryKey: ["conjuntivite-map", se, ano],
    queryFn: () => fetchJson(`/api/boletins/mapdata?agravo=conjuntivite&se=${se}&ano=${ano}`)
  });

  const valueMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const row of rows ?? []) {
      if (row.gve) m[row.gve] = row.casos;
    }
    return m;
  }, [rows]);

  const topGves = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.casos - a.casos).slice(0, 6),
    [rows]
  );

  if (isLoading) {
    return (
      <div className="mb-6 flex h-32 items-center justify-center rounded-lg border border-dashed border-blue-200 text-sm text-blue-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando mapa...
      </div>
    );
  }

  if (!rows?.length) return null;

  const maxCasos = Math.max(...(rows ?? []).map(r => r.casos), 1);

  return (
    <div className="mb-8 print:break-inside-avoid">
      <div className="mb-3 flex items-start gap-2 text-sm font-extrabold uppercase tracking-wider text-blue-900">
        <span className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm bg-blue-700" aria-hidden />
        <span>Distribuição Geográfica — Casos de Conjuntivite por GVE</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_1fr]">
        {/* Map */}
        <div className="overflow-hidden rounded-xl border border-blue-100 shadow-sm">
          <ChoroplethMap
            dataUrl="/api/geo/shapefiles?type=gve"
            valueMap={valueMap}
            colorScheme={(v) => {
              if (v === null || v === undefined) return "#e2e8f0";
              const ratio = v / maxCasos;
              if (ratio >= 0.75) return "#1d4ed8";
              if (ratio >= 0.5)  return "#3b82f6";
              if (ratio >= 0.25) return "#93c5fd";
              return "#dbeafe";
            }}
            label="Casos de Conjuntivite por GVE"
          />
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3 text-xs">
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
            <p className="mb-2 font-bold uppercase tracking-wide text-blue-900">GVEs com mais casos</p>
            <div className="space-y-1.5">
              {topGves.map((row, i) => (
                <div key={row.gve} className="flex items-center justify-between gap-1">
                  <span className="truncate text-gray-700">{i + 1}. {row.gve}</span>
                  <span className="whitespace-nowrap font-bold text-blue-700">{row.casos}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 p-3">
            <p className="mb-2 font-bold uppercase tracking-wide text-blue-900">Legenda</p>
            <div className="space-y-1.5 text-gray-600">
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#1d4ed8" }} />
                <span>Maior concentração</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#3b82f6" }} />
                <span>Alta</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#93c5fd" }} />
                <span>Moderada</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm" style={{ background: "#dbeafe" }} />
                <span>Baixa</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 shrink-0 rounded-sm bg-slate-200" />
                <span>Sem notificação</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──── ConjuntiviteHistoryTable ────────────────────────────────────────────────
function ConjuntiviteHistoryTable({ se: currentSe, ano }: { se: number; ano: number }) {
  const { data: rows, isLoading } = useQuery<SeHistoryRow[]>({
    queryKey: ["conjuntivite-history", ano],
    queryFn: () => fetchJson(`/api/boletins/history?agravo=conjuntivite&ano=${ano}`)
  });

  // Only show SEs up to (and including) the bulletin's reference week
  const filteredRows = useMemo(() => rows?.filter(r => r.se <= currentSe) ?? [], [rows, currentSe]);

  const totals = useMemo(() => {
    if (!filteredRows.length) return null;
    return filteredRows.reduce(
      (acc, r) => ({
        notificacoes: acc.notificacoes + r.notificacoes,
        casos: acc.casos + r.casos,
        surtos: acc.surtos + r.surtos,
        coletas: acc.coletas + r.coletas,
        acoes: acc.acoes + r.acoes,
      }),
      { notificacoes: 0, casos: 0, surtos: 0, coletas: 0, acoes: 0 }
    );
  }, [filteredRows]);

  function trend(rows: SeHistoryRow[], idx: number) {
    if (idx === 0) return null;
    const curr = rows[idx].casos;
    const prev = rows[idx - 1].casos;
    if (!prev && !curr) return null;
    if (curr > prev) return "↑";
    if (curr < prev) return "↓";
    return "→";
  }

  if (isLoading) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-blue-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando histórico...
      </div>
    );
  }

  if (!filteredRows.length) return null;

  return (
    <div className="print:break-inside-avoid">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-start gap-2 text-sm font-extrabold uppercase tracking-wider text-blue-900">
          <span className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm bg-blue-700" aria-hidden />
          <span>Curva Epidêmica — Semanas Epidemiológicas {ano}</span>
        </div>
        <span className="text-xs text-muted-foreground">{filteredRows.length} SE com dados</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-blue-100 shadow-sm">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-blue-800 text-white">
              <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide">SE</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Notificações</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Casos</th>
              <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wide">Tendência</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Surtos</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Coletas</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Ações Ed.</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => {
              const isCurrent = row.se === currentSe;
              const t = trend(filteredRows, idx);
              return (
                <tr
                  key={row.se}
                  className={`border-b transition-colors ${
                    isCurrent
                      ? "bg-blue-100 font-semibold"
                      : idx % 2 === 0 ? "bg-white" : "bg-blue-50/40"
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1.5 ${isCurrent ? "text-blue-800" : "text-gray-600"}`}>
                      {isCurrent && (
                        <span className="inline-block h-2 w-2 rounded-full bg-blue-600" />
                      )}
                      SE {String(row.se).padStart(2, "0")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {row.notificacoes > 0 ? row.notificacoes : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">
                    {row.casos > 0 ? row.casos.toLocaleString("pt-BR") : <span className="font-normal text-gray-300">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-center font-bold ${
                    t === "↑" ? "text-red-500" : t === "↓" ? "text-green-600" : "text-gray-400"
                  }`}>
                    {t ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {row.surtos > 0
                      ? <span className="font-semibold text-amber-600">{row.surtos}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {row.coletas > 0 ? row.coletas : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {row.acoes > 0 ? row.acoes : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t-2 border-blue-200 bg-blue-900 text-white text-[11px] font-semibold">
                <td className="px-3 py-2.5 uppercase tracking-wide">Total {ano}</td>
                <td className="px-3 py-2.5 text-right">{totals.notificacoes.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2.5 text-right">{totals.casos.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2.5 text-center text-blue-300">—</td>
                <td className="px-3 py-2.5 text-right">{totals.surtos > 0 ? totals.surtos : "—"}</td>
                <td className="px-3 py-2.5 text-right">{totals.coletas > 0 ? totals.coletas : "—"}</td>
                <td className="px-3 py-2.5 text-right">{totals.acoes > 0 ? totals.acoes : "—"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-1.5 text-[11px] text-gray-400">
        ↑ aumento · ↓ redução · → estável · {" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> SE do boletim atual
        </span>
      </p>
    </div>
  );
}

// ──── TracomaPrevalenciaChart ─────────────────────────────────────────────────
function TracomaPrevalenciaChart({ rows, currentAno }: { rows: YearHistoryRow[]; currentAno: number }) {
  const dataRows = rows.filter(r => r.examinados >= 10);
  if (dataRows.length < 2) return null;

  const W = 760, H = 170, PL = 44, PR = 52, PT = 14, PB = 32;
  const cW = W - PL - PR, cH = H - PT - PB;

  const years = dataRows.map(r => r.ano);
  const minY = Math.min(...years), maxY = Math.max(...years);
  const yRange = Math.max(maxY - minY, 1);

  const maxPrev = Math.max(...dataRows.map(r => r.prevalencia), 6);
  const yMax = Math.ceil(maxPrev / 2) * 2;

  const xOf = (ano: number) => PL + ((ano - minY) / yRange) * cW;
  const yOf = (v: number) => PT + cH - (v / yMax) * cH;

  const linePath = dataRows
    .map((r, i) => `${i === 0 ? "M" : "L"} ${xOf(r.ano).toFixed(1)} ${yOf(r.prevalencia).toFixed(1)}`)
    .join(" ");

  const omsY = yOf(5);
  const yTicks = Array.from({ length: Math.floor(yMax / 2) + 1 }, (_, i) => i * 2);
  const xLabels = years.filter((y, i) => i === 0 || i === years.length - 1 || y % 5 === 0);

  return (
    <div className="mb-5 print:break-inside-avoid">
      <div className="mb-2 flex items-start gap-2 text-sm font-extrabold uppercase tracking-wider text-teal-900">
        <span className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm bg-teal-600" aria-hidden />
        <span>Tendência da Prevalência — Série Histórica</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-teal-100 bg-white p-2 shadow-sm">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico de tendência da prevalência de tracoma">
          {yTicks.map(v => (
            <line key={v} x1={PL} x2={PL + cW} y1={yOf(v)} y2={yOf(v)} stroke="#e2e8f0" strokeWidth="0.8" />
          ))}
          <line x1={PL} x2={PL + cW} y1={omsY} y2={omsY} stroke="#dc2626" strokeWidth="1.2" strokeDasharray="6 3" />
          <text x={PL + cW + 4} y={omsY + 4} fill="#dc2626" fontSize="10" fontWeight="600">5% (OMS)</text>
          <path d={linePath} fill="none" stroke="#0f766e" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          {dataRows.map(r => (
            <g key={r.ano}>
              <circle
                cx={xOf(r.ano)}
                cy={yOf(r.prevalencia)}
                r={r.ano === currentAno ? 5.5 : 3.5}
                fill={r.prevalencia >= 5 ? "#dc2626" : "#0f766e"}
                stroke="white"
                strokeWidth="1.5"
              />
              <title>{`${r.ano}: ${r.prevalencia.toFixed(1).replace(".", ",")}%`}</title>
            </g>
          ))}
          {yTicks.map(v => (
            <text key={v} x={PL - 5} y={yOf(v) + 3.5} fill="#64748b" fontSize="9.5" textAnchor="end">{v}%</text>
          ))}
          {xLabels.map(y => (
            <text key={y} x={xOf(y)} y={H - PB + 14} fill="#64748b" fontSize="9.5" textAnchor="middle">{y}</text>
          ))}
          <line x1={PL} x2={PL} y1={PT} y2={PT + cH} stroke="#94a3b8" strokeWidth="1" />
          <line x1={PL} x2={PL + cW} y1={PT + cH} y2={PT + cH} stroke="#94a3b8" strokeWidth="1" />
        </svg>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        Linha tracejada vermelha = meta OMS (TF &lt;5%) ·{" "}
        <span className="font-semibold text-red-600">pontos vermelhos</span> = anos acima da meta ·{" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white bg-teal-600 shadow-sm" /> ponto maior = ano do boletim
        </span>
      </p>
    </div>
  );
}

// ──── TracomaHistoryTable ─────────────────────────────────────────────────────
function TracomaHistoryTable({ ano: currentAno }: { ano: number }) {
  const { data: rows, isLoading } = useQuery<YearHistoryRow[]>({
    queryKey: ["tracoma-history"],
    queryFn: () => fetchJson("/api/boletins/history?agravo=tracoma")
  });

  function fmtPct(v: number) {
    return `${v.toFixed(1).replace(".", ",")}%`;
  }

  // Only show years up to and including the bulletin year. currentAno also drives highlighting.
  const filteredRows = useMemo(
    () => rows?.filter(r => r.ano <= currentAno && (r.examinados >= 10 || r.traconet > 0)) ?? [],
    [rows, currentAno]
  );

  const totals = useMemo(() => {
    if (!filteredRows.length) return null;
    const exam = filteredRows.reduce((s, r) => s + r.examinados, 0);
    const pos  = filteredRows.reduce((s, r) => s + r.positivos, 0);
    return {
      examinados: exam,
      positivos: pos,
      traconet: filteredRows.reduce((s, r) => s + r.traconet, 0),
      tt: filteredRows.reduce((s, r) => s + r.tt, 0),
      prevalencia: exam > 0 ? (pos / exam) * 100 : 0,
    };
  }, [filteredRows]);

  if (isLoading) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-teal-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando histórico...
      </div>
    );
  }

  if (!filteredRows.length) return null;

  return (
    <div className="print:break-inside-avoid">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-start gap-2 text-sm font-extrabold uppercase tracking-wider text-teal-900">
          <span className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm bg-teal-600" aria-hidden />
          <span>Série Histórica — Examinados e Casos por Ano</span>
        </div>
        <span className="text-xs text-muted-foreground">{filteredRows.length} anos com dados</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-teal-100 shadow-sm">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-teal-800 text-white">
              <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide">Ano</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Municípios</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Examinados</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Positivos</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">Prevalência</th>
              <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide">TT</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => {
              const isCurrent = row.ano === currentAno;
              const aboveMeta = row.prevalencia >= 5;
              return (
                <tr
                  key={row.ano}
                  className={`border-b transition-colors ${
                    isCurrent
                      ? "bg-teal-100 font-semibold"
                      : idx % 2 === 0 ? "bg-white" : "bg-teal-50/40"
                  }`}
                >
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1.5 ${isCurrent ? "text-teal-800" : "text-gray-600"}`}>
                      {isCurrent && <span className="inline-block h-2 w-2 rounded-full bg-teal-600" />}
                      {row.ano}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {row.munis > 0 ? row.munis : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {row.examinados > 0 ? row.examinados.toLocaleString("pt-BR") : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">
                    {row.positivos > 0 ? row.positivos.toLocaleString("pt-BR") : <span className="font-normal text-gray-300">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${
                    aboveMeta ? "text-red-600" : row.prevalencia >= 2 ? "text-amber-600" : row.examinados > 0 ? "text-green-700" : ""
                  }`}>
                    {row.examinados > 0 ? fmtPct(row.prevalencia) : <span className="font-normal text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.tt > 0
                      ? <span className="font-semibold text-red-600">{row.tt}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totals && filteredRows.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-teal-200 bg-teal-900 text-white text-[11px] font-semibold">
                <td className="px-3 py-2.5 uppercase tracking-wide">Total</td>
                <td className="px-3 py-2.5 text-right text-teal-300">—</td>
                <td className="px-3 py-2.5 text-right">{totals.examinados.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2.5 text-right">{totals.positivos.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2.5 text-right text-teal-300">{fmtPct(totals.prevalencia)}</td>
                <td className="px-3 py-2.5 text-right text-red-300">{totals.tt > 0 ? totals.tt.toLocaleString("pt-BR") : "—"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-1.5 text-[11px] text-gray-400">
        Prevalência ≥ 5%{" "}
        <span className="font-semibold text-red-600">vermelha</span>{" "}
        (acima da meta OMS) · TT = casos de triquíase (cirurgia indicada) ·{" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-teal-600" /> Ano do boletim
        </span>
      </p>

      <div className="mt-6">
        <TracomaPrevalenciaChart rows={filteredRows} currentAno={currentAno} />
      </div>
    </div>
  );
}

// ──── BulletinDetail ──────────────────────────────────────────────────────────
function BulletinDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<BulletinDetail>({
    queryKey: ["bulletin", id],
    queryFn: () => fetchJson(`/api/boletins/${id}`)
  });

  const regenerateMutation = useMutation({
    mutationFn: () => {
      if (!data) throw new Error("Boletim não carregado");
      const body: Record<string, unknown> = { agravo: data.agravo, force: true };
      if (data.agravo === "conjuntivite") { body.se = data.se; body.ano = data.ano; }
      else { body.ano = data.ano; if (data.se > 0) body.anoInicio = data.se; }
      return fetchJson<{ ok: boolean; error?: string }>(
        "/api/boletins",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bulletin", id] });
      await queryClient.invalidateQueries({ queryKey: ["bulletins", data?.agravo] });
      if (data?.agravo === "tracoma") {
        await queryClient.invalidateQueries({ queryKey: ["tracoma-history"] });
        await queryClient.invalidateQueries({ queryKey: ["tracoma-map", data.ano] });
      }
    }
  });

  async function copyContent() {
    if (!data?.content) return;
    await navigator.clipboard.writeText(data.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const cfg = data ? AGRAVO_CONFIG[data.agravo] : AGRAVO_CONFIG.conjuntivite;
  const mdComponents = useMemo(() => makeMdComponents(cfg.accent), [cfg.accent]);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      {/* Action bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" onClick={onBack} className="px-2">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => regenerateMutation.mutate()}
            disabled={!data || regenerateMutation.isPending}
            title="Regera o conteúdo com os dados mais recentes"
          >
            {regenerateMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />}
            {regenerateMutation.isPending ? "Gerando…" : "Regenerar"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!data}>
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          <Button variant="outline" size="sm" onClick={copyContent} disabled={!data?.content}>
            <Clipboard className="h-4 w-4" />
            {copied ? "Copiado" : "Copiar texto"}
          </Button>
        </div>
      </div>

      {regenerateMutation.error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 print:hidden">
          {regenerateMutation.error instanceof Error ? regenerateMutation.error.message : "Erro ao regenerar."}
        </div>
      )}

      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando boletim...
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-gray-200 bg-gray-50 text-gray-600">
          <CardContent className="py-10 text-center text-sm">
            Não foi possível carregar o boletim. Tente novamente mais tarde.
          </CardContent>
        </Card>
      )}

      {data && (
        <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg print:shadow-none print:border-none">

          {/* Top strip — institutional identity */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-950 px-5 py-2 text-[11px] text-blue-200">
            <div className="flex items-center gap-2 font-medium tracking-wide">
              <span className="text-white">ESTADO DE SÃO PAULO</span>
              <span className="opacity-40">·</span>
              <span>Secretaria de Estado da Saúde</span>
            </div>
            <span>Centro de Vigilância Epidemiológica &quot;Prof. Alexandre Vranjac&quot;</span>
          </div>

          {/* Header */}
          <div className={`relative overflow-hidden ${cfg.headerClass} px-8 pb-8 pt-6 text-white`}>
            {/* Watermark */}
            <div
              className="pointer-events-none absolute right-6 top-0 select-none text-[10rem] font-black leading-none text-white/10"
              aria-hidden
            >
              {cfg.seDisplay(data.se)}
            </div>
            <div className="relative flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] opacity-55">
                  {cfg.divisionLabel}
                </p>
                <h1 className="text-4xl font-black leading-tight tracking-tight md:text-5xl">
                  Boletim<br />Epidemiológico
                </h1>
                <p className="mt-2 text-[13px] font-medium opacity-65">{cfg.subtitle}</p>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium uppercase tracking-widest opacity-55">
                  {data.agravo === "conjuntivite"
                    ? "Semana Epidemiológica"
                    : data.se > 0 ? "Período" : "Ano de referência"}
                </div>
                <div className={`mt-0.5 font-black leading-none text-white/90 ${data.agravo === "tracoma" && data.se > 0 ? "text-3xl" : "text-5xl"}`}>
                  {data.agravo === "conjuntivite"
                    ? String(data.se).padStart(2, "0")
                    : data.se > 0
                      ? `${data.se}–${data.ano}`
                      : data.ano}
                </div>
                {data.agravo === "conjuntivite" && (
                  <div className="mt-1 text-sm font-semibold opacity-75">{data.ano}</div>
                )}
                <div className="mt-2 text-[11px] opacity-45">
                  Emitido em {new Date(data.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
            </div>
          </div>

          {/* Title accent strip */}
          <div
            className={`${cfg.accentClass} px-8 py-4 text-white`}
            style={{ borderBottom: "3px solid rgba(255,255,255,0.15)" }}
          >
            <h2 className="text-base font-bold leading-snug md:text-lg">{data.title}</h2>
          </div>

          {/* Bulletin body — markdown with map + history injected at correct sections */}
          <div className="px-8 pb-10 pt-6">
            {(() => {
              const clean = cleanContent(data.content);

              const renderMd = (content: string) =>
                content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {content}
                  </ReactMarkdown>
                ) : null;

              // Returns the index of the next ## heading after `from`
              function nextSectionIdx(from: number): number {
                const n = clean.slice(from + 1).search(/^## /m);
                return n === -1 ? clean.length : from + 1 + n;
              }

              // ── Conjuntivite ─────────────────────────────────────────────
              if (data.agravo === "conjuntivite") {
                const geoIdx  = clean.search(/^## Distribuição Geográfica/im);
                const tendIdx = clean.search(/^## Tendência/im);

                // Neither section found → components at end
                if (geoIdx === -1 && tendIdx === -1) {
                  return (
                    <>
                      {renderMd(clean)}
                      {data.se > 0 && (
                        <div className="mt-6 space-y-6">
                          <ConjuntiviteMuniMapSection se={data.se} ano={data.ano} />
                          <ConjuntiviteMapSection se={data.se} ano={data.ano} />
                          <ConjuntiviteHistoryTable se={data.se} ano={data.ano} />
                        </div>
                      )}
                    </>
                  );
                }

                // cut1 = where geo section starts (or tendency start if no geo)
                const cut1    = geoIdx !== -1 ? geoIdx : tendIdx;
                const cut1End = geoIdx !== -1 ? nextSectionIdx(geoIdx) : cut1;
                // cut2 = where tendency section starts
                const cut2    = tendIdx !== -1 ? tendIdx : clean.length;
                const cut2End = tendIdx !== -1 ? nextSectionIdx(tendIdx) : clean.length;

                // p1 = before map | p2 = between map and history | p3 = after history
                const p1 = clean.slice(0, cut1).trim();
                const p2 = geoIdx !== -1 ? clean.slice(cut1End, cut2).trim() : "";
                const p3 = clean.slice(cut2End).trim();

                return (
                  <>
                    {renderMd(p1)}
                    {data.se > 0 && (
                      <div className="my-6 space-y-6">
                        <ConjuntiviteMuniMapSection se={data.se} ano={data.ano} />
                        <ConjuntiviteMapSection se={data.se} ano={data.ano} />
                      </div>
                    )}
                    {renderMd(p2)}
                    {data.se > 0 && (
                      <div className="my-6">
                        <ConjuntiviteHistoryTable se={data.se} ano={data.ano} />
                      </div>
                    )}
                    {renderMd(p3)}
                  </>
                );
              }

              // ── Tracoma ──────────────────────────────────────────────────
              if (data.agravo === "tracoma") {
                // Annual bulletin → "Distribuição Geográfica"
                // Period bulletin → "Municípios Prioritários"
                const geoPattern = data.se > 0
                  ? /^## Municípios Prioritários/im
                  : /^## Distribuição Geográfica/im;
                const geoIdx = clean.search(geoPattern);

                // Section not found → components before content (visible summary first)
                if (geoIdx === -1) {
                  return (
                    <>
                      <div className="mb-6 space-y-6">
                        <TracomaHistoryTable ano={data.ano} />
                        <TracomaMapSection ano={data.ano} />
                      </div>
                      {renderMd(clean)}
                    </>
                  );
                }

                const p1 = clean.slice(0, geoIdx).trim();
                const p2 = clean.slice(nextSectionIdx(geoIdx)).trim();

                return (
                  <>
                    {renderMd(p1)}
                    <div className="my-6 space-y-6">
                      <TracomaHistoryTable ano={data.ano} />
                      <TracomaMapSection ano={data.ano} />
                    </div>
                    {renderMd(p2)}
                  </>
                );
              }

              return renderMd(clean);
            })()}
          </div>

          {/* Footer */}
          <div className={`flex flex-wrap items-center justify-between gap-2 border-t ${data.agravo === "tracoma" ? "border-teal-100 bg-teal-50 text-teal-700" : "border-blue-100 bg-blue-50 text-blue-700"} px-8 py-3 text-[11px]`}>
            <span>Centro de Vigilância Epidemiológica &quot;Prof. Alexandre Vranjac&quot; | CCD/SES-SP</span>
            <span className="opacity-60">{cfg.seLabel(data.se, data.ano)}</span>
          </div>
        </article>
      )}
    </div>
  );
}

// ──── ConjuntiviteGenerateSection ─────────────────────────────────────────────
function ConjuntiviteGenerateSection({ onSuccess }: { onSuccess: (id: string) => void }) {
  const queryClient = useQueryClient();
  const currentYear = currentCalendarYear();

  // Default: 2 weeks back (notifications from this week refer to last/2-weeks-ago SE)
  const defaultPeriod = useMemo(() => {
    const current = currentEpiWeek();
    return shiftEpiWeek(current.year, current.se, -2);
  }, []);
  const defaultSE = defaultPeriod.se;

  const [se, setSe]   = useState(defaultSE);
  const [ano, setAno] = useState(defaultPeriod.year);
  const [skipped, setSkipped] = useState(false);

  const years = useMemo(() => Array.from({ length: 10 }, (_, i) => currentYear - i), [currentYear]);
  const maxSE  = ano === currentYear ? Math.min(53, defaultSE + 2) : 53;
  const seList = useMemo(() => Array.from({ length: maxSE }, (_, i) => i + 1), [maxSE]);

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson<{ id?: string; skipped?: boolean; se: number; ano: number; agravo: Agravo }>(
        "/api/boletins",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agravo: "conjuntivite", se, ano }) }
      ),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ["bulletins", "conjuntivite"] });
      setSkipped(Boolean(result.skipped));
      if (result.id) onSuccess(result.id);
    }
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 text-xs">
        <label className="text-muted-foreground">Ano</label>
        <select
          value={ano}
          onChange={e => { setAno(Number(e.target.value)); setSe(1); }}
          className="rounded border border-blue-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label className="text-muted-foreground">SE</label>
        <select
          value={se}
          onChange={e => setSe(Number(e.target.value))}
          className="rounded border border-blue-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {seList.map(s => (
            <option key={s} value={s}>
              {String(s).padStart(2, "0")}{s === defaultSE && ano === currentYear ? " (padrão)" : ""}
            </option>
          ))}
        </select>
      </div>

      <Button
        onClick={() => { setSkipped(false); mutation.mutate(); }}
        disabled={mutation.isPending}
        className="bg-blue-700 hover:bg-blue-800"
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Gerar SE {String(se).padStart(2, "0")}/{ano}
      </Button>

      {mutation.error && (
        <span className="text-xs text-red-600">
          {mutation.error instanceof Error ? mutation.error.message : "Erro ao gerar"}
        </span>
      )}
      {skipped && !mutation.isPending && (
        <span className="text-xs text-amber-600">Boletim já existe — abrindo o existente…</span>
      )}
    </div>
  );
}

// ──── TracomaGenerateSection ──────────────────────────────────────────────────
function TracomaGenerateSection({ onSuccess }: { onSuccess: (id: string) => void }) {
  const queryClient = useQueryClient();
  const currentYear = currentCalendarYear();
  const [tipo, setTipo] = useState<"anual" | "periodo">("anual");
  const [ano, setAno]         = useState(currentYear);
  const [anoInicio, setAnoInicio] = useState(currentYear - 2);
  const [skipped, setSkipped] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { agravo: "tracoma", ano };
      if (tipo === "periodo") body.anoInicio = anoInicio;
      return fetchJson<{ id?: string; skipped?: boolean; se: number; ano: number; agravo: Agravo }>(
        "/api/boletins",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
    },
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ["bulletins", "tracoma"] });
      setSkipped(Boolean(result.skipped));
      if (result.id) onSuccess(result.id);
    }
  });

  const years = Array.from({ length: 15 }, (_, i) => currentYear - i);

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Tipo toggle */}
      <div className="flex rounded-lg border border-teal-200 bg-white text-xs overflow-hidden">
        {(["anual", "periodo"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTipo(t)}
            className={`px-3 py-1.5 font-medium transition ${
              tipo === t ? "bg-teal-700 text-white" : "text-teal-700 hover:bg-teal-50"
            }`}
          >
            {t === "anual" ? "Anual" : "Período"}
          </button>
        ))}
      </div>

      {/* Year selectors */}
      <div className="flex items-center gap-2 text-xs">
        {tipo === "periodo" && (
          <>
            <label className="text-muted-foreground">De</label>
            <select
              value={anoInicio}
              onChange={e => setAnoInicio(Number(e.target.value))}
              className="rounded border border-teal-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              {years.filter(y => y < ano).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <label className="text-muted-foreground">até</label>
          </>
        )}
        {tipo === "anual" && <label className="text-muted-foreground">Ano</label>}
        <select
          value={ano}
          onChange={e => setAno(Number(e.target.value))}
          className="rounded border border-teal-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <Button
        onClick={() => { setSkipped(false); mutation.mutate(); }}
        disabled={mutation.isPending || (tipo === "periodo" && anoInicio >= ano)}
        className="bg-teal-700 hover:bg-teal-800"
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {tipo === "anual" ? `Gerar boletim ${ano}` : `Gerar período ${anoInicio}–${ano}`}
      </Button>

      {mutation.error && (
        <span className="text-xs text-red-600">
          {mutation.error instanceof Error ? mutation.error.message : "Erro ao gerar"}
        </span>
      )}
      {skipped && !mutation.isPending && (
        <span className="text-xs text-amber-600">Boletim já existe — abrindo o existente…</span>
      )}
    </div>
  );
}

// ──── BulletinList ────────────────────────────────────────────────────────────
function BulletinList({ agravo, onSelect }: { agravo: Agravo; onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const cfg = AGRAVO_CONFIG[agravo];

  const { data: bulletins = [], isLoading, error } = useQuery<BulletinSummary[]>({
    queryKey: ["bulletins", agravo],
    queryFn: () => fetchJson(`/api/boletins?agravo=${agravo}`)
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando boletins…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        {error instanceof Error ? error.message : "Erro ao carregar boletins."}
      </div>
    );
  }

  if (bulletins.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nenhum boletim de {cfg.label.toLowerCase()} publicado ainda.
        <br />Use o botão acima para gerar o primeiro.
      </div>
    );
  }

  const isTeal = agravo === "tracoma";

  return (
    <div className="space-y-2">
      {bulletins.map(b => (
        <button
          key={b.id}
          onClick={() => onSelect(b.id)}
          className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border bg-background p-3 text-left transition hover:shadow-sm ${
            isTeal ? "hover:border-teal-400 hover:bg-teal-50/40" : "hover:border-blue-400 hover:bg-blue-50/40"
          }`}
        >
          <div className={`rounded-lg px-3 py-2 text-center text-white ${isTeal ? "bg-teal-800" : "bg-blue-900"}`}>
            <div className="text-[10px] font-semibold tracking-widest opacity-60">
              {isTeal ? (b.se > 0 ? "PER" : "ANO") : "SE"}
            </div>
            <div className={`font-black leading-none ${isTeal && b.se > 0 ? "text-sm" : "text-lg"}`}>
              {isTeal
                ? (b.se > 0 ? `${b.se}–${b.ano}` : b.ano)
                : String(b.se).padStart(2, "0")}
            </div>
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{b.title}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {b.ano} · {new Date(b.created_at).toLocaleDateString("pt-BR")}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      ))}
      <div className="pt-1 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["bulletins", agravo] })}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </Button>
      </div>
    </div>
  );
}

// ──── BulletinsView (main export) ─────────────────────────────────────────────
export function BulletinsView() {
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("id"));
  const [activeTab, setActiveTab] = useState<Agravo>(
    (searchParams.get("agravo") as Agravo | null) ?? "conjuntivite"
  );

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) setSelectedId(id);
  }, [searchParams]);

  if (selectedId) {
    return <BulletinDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const tabs: { id: Agravo; label: string; icon: React.ReactNode }[] = [
    { id: "conjuntivite", label: "Conjuntivite", icon: <Eye className="h-4 w-4" /> },
    { id: "tracoma",      label: "Tracoma",       icon: <Newspaper className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">

      {/* Page header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Newspaper className="h-6 w-6 text-blue-700" />
          <h1 className="text-2xl font-semibold text-foreground">Boletins Epidemiológicos</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Boletins gerados automaticamente com base nos dados do CEVESP (conjuntivite) e SINAN (tracoma) — CVE/SES-SP.
        </p>
      </div>

      {/* Disease tabs */}
      <div className="flex gap-1 rounded-xl border bg-muted/30 p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.id
                ? tab.id === "tracoma"
                  ? "bg-teal-800 text-white shadow-sm"
                  : "bg-blue-800 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content per tab */}
      <div className="space-y-4">
        {/* Header strip for active disease */}
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-4 ${
          activeTab === "tracoma" ? "bg-teal-50 border border-teal-100" : "bg-blue-50 border border-blue-100"
        }`}>
          <div>
            <div className={`text-sm font-bold ${activeTab === "tracoma" ? "text-teal-900" : "text-blue-900"}`}>
              {AGRAVO_CONFIG[activeTab].label}
            </div>
            <div className="text-xs text-muted-foreground">{AGRAVO_CONFIG[activeTab].subtitle}</div>
          </div>
          {activeTab === "conjuntivite"
            ? <ConjuntiviteGenerateSection onSuccess={id => setSelectedId(id)} />
            : <TracomaGenerateSection onSuccess={id => setSelectedId(id)} />
          }
        </div>

        {/* Bulletin list */}
        <Card className={activeTab === "tracoma" ? "border-teal-100" : "border-blue-100"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Histórico</CardTitle>
            <CardDescription>
              Clique em um boletim para ler, imprimir ou copiar o conteúdo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BulletinList agravo={activeTab} onSelect={id => setSelectedId(id)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
