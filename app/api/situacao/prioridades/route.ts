import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchCevespKpis } from "@/services/cevesp-kpis";
import { findInvalidRecords } from "@/services/cevesp-corrections";
import { buildSinanTracomaRates } from "@/services/population-rates";
import { auditarSinanTracoma } from "@/services/sinan-tracoma";

type PriorityLevel = "critica" | "alta" | "media";
type PrioritySource = "alerta" | "cevesp" | "sinan" | "qualidade";

type PriorityItem = {
  id: string;
  level: PriorityLevel;
  source: PrioritySource;
  agravo: "Conjuntivite" | "Tracoma" | "Dados";
  territorio: string;
  motivo: string;
  acao: string;
  prazo: string;
  evidenciaHref: string;
  score: number;
  detalhe?: string;
};

type AlertRow = {
  id?: string;
  gve?: string;
  se_epidemiologica?: number;
  ano?: number;
  cases_current?: number;
  cases_avg?: number;
  increase_pct?: number;
  severity?: "warning" | "critical";
  acknowledged?: boolean;
};

function priorityRank(level: PriorityLevel) {
  return level === "critica" ? 0 : level === "alta" ? 1 : 2;
}

function addPriority(items: PriorityItem[], item: PriorityItem) {
  const duplicate = items.find((current) => current.id === item.id);
  if (!duplicate) items.push(item);
}

async function loadAlerts(): Promise<AlertRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("epidemiological_alerts")
    .select("id,gve,se_epidemiologica,ano,cases_current,cases_avg,increase_pct,severity,acknowledged")
    .eq("acknowledged", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []) as AlertRow[];
}

async function buildPriorities() {
  const items: PriorityItem[] = [];

  const [alerts, kpisResult, qualityResult, sinanResult, ratesResult] = await Promise.allSettled([
    loadAlerts(),
    fetchCevespKpis(),
    findInvalidRecords(300),
    auditarSinanTracoma(),
    buildSinanTracomaRates()
  ]);

  if (alerts.status === "fulfilled") {
    for (const alert of alerts.value) {
      const level: PriorityLevel = alert.severity === "critical" ? "critica" : "alta";
      addPriority(items, {
        id: `alerta-${alert.id ?? `${alert.gve}-${alert.ano}-${alert.se_epidemiologica}`}`,
        level,
        source: "alerta",
        agravo: "Conjuntivite",
        territorio: alert.gve || "GVE nao informada",
        motivo: `Alerta epidemiologico SE ${alert.se_epidemiologica ?? "-"} / ${alert.ano ?? "-"}`,
        acao: "Validar aumento com a GVE, investigar surto e registrar retorno.",
        prazo: level === "critica" ? "Hoje" : "24-48h",
        evidenciaHref: "/alertas",
        score: (alert.severity === "critical" ? 90 : 70) + Math.min(Number(alert.increase_pct ?? 0), 80),
        detalhe: `${Number(alert.cases_current ?? 0).toLocaleString("pt-BR")} casos; aumento ${Number(alert.increase_pct ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`
      });
    }
  }

  if (kpisResult.status === "fulfilled") {
    const kpis = kpisResult.value;
    const shouldAct = (kpis.weekDelta ?? 0) >= 10 || kpis.outbreaksCurrentYear > 0;
    if (shouldAct) {
      const top = kpis.topMunicipalitiesCurrentWeek[0];
      addPriority(items, {
        id: "cevesp-tendencia-semana",
        level: (kpis.weekDelta ?? 0) >= 30 || kpis.outbreaksCurrentYear > 0 ? "alta" : "media",
        source: "cevesp",
        agravo: "Conjuntivite",
        territorio: top?.name ?? "Estado de Sao Paulo",
        motivo: kpis.outbreaksCurrentYear > 0
          ? `${kpis.outbreaksCurrentYear.toLocaleString("pt-BR")} surto(s) CEVESP no ano`
          : `Aumento semanal de ${kpis.weekDelta?.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
        acao: "Abrir analise CEVESP, confirmar territorios de maior carga e preparar devolutiva.",
        prazo: "24-48h",
        evidenciaHref: "/conjuntivite",
        score: 60 + Math.max(kpis.outbreaksCurrentYear * 8, kpis.weekDelta ?? 0),
        detalhe: top ? `${top.cases.toLocaleString("pt-BR")} casos em ${top.name} na semana atual` : undefined
      });
    }
  }

  if (qualityResult.status === "fulfilled") {
    const invalid = qualityResult.value;
    const byGve = new Map<string, number>();
    const critical = invalid.filter((record) => (
      record.issue.includes("Ano imposs") ||
      record.issue.includes("SE inv") ||
      record.issue.includes("Munic") ||
      record.issue.includes("GVE ausente") ||
      record.issue.includes("negativo")
    ));
    for (const record of invalid) {
      const gve = record.gve || "GVE nao informada";
      byGve.set(gve, (byGve.get(gve) ?? 0) + 1);
    }
    const topGve = Array.from(byGve.entries()).sort((a, b) => b[1] - a[1])[0];
    if (invalid.length > 0) {
      addPriority(items, {
        id: "qualidade-cevesp",
        level: critical.length > 0 ? "alta" : "media",
        source: "qualidade",
        agravo: "Dados",
        territorio: topGve?.[0] ?? "CEVESP",
        motivo: `${invalid.length.toLocaleString("pt-BR")} inconsistencias CEVESP na amostra`,
        acao: "Priorizar saneamento antes de usar ranking territorial como evidência final.",
        prazo: critical.length > 0 ? "24-48h" : "Nesta semana",
        evidenciaHref: "/qualidade-dados",
        score: 50 + critical.length * 3 + invalid.length / 10,
        detalhe: critical.length > 0 ? `${critical.length.toLocaleString("pt-BR")} critica(s) por data, SE ou territorio` : undefined
      });
    }
  }

  if (sinanResult.status === "fulfilled") {
    const sinan = sinanResult.value;
    const clinical =
      (sinan.tfSemTratamento ?? 0) +
      (sinan.ttSemCircurgia ?? 0) +
      (sinan.ttSemTs ?? 0) +
      (sinan.semConclusao ?? 0);
    const divergences = sinan.crossBankDivergences?.filter((item) => item.risco === "alto") ?? [];
    if (clinical > 0) {
      addPriority(items, {
        id: "sinan-clinico",
        level: "critica",
        source: "sinan",
        agravo: "Tracoma",
        territorio: "TRACONET",
        motivo: `${clinical.toLocaleString("pt-BR")} pendencia(s) clinicas de tracoma`,
        acao: "Revisar tratamento, cirurgia/TS e encerramento dos casos prioritarios.",
        prazo: "Hoje",
        evidenciaHref: "/tracoma?tab=qualidade",
        score: 95 + clinical,
        detalhe: "Impacta acompanhamento de casos e metas de eliminacao."
      });
    }
    if (divergences.length > 0) {
      const first = divergences[0];
      addPriority(items, {
        id: "sinan-divergencias-bancos",
        level: "alta",
        source: "sinan",
        agravo: "Tracoma",
        territorio: first?.gve || first?.municipioNome || "SINAN Tracoma",
        motivo: `${divergences.length.toLocaleString("pt-BR")} divergencia(s) alto risco entre bancos`,
        acao: "Comparar TRACONET e NOTTRACONET por municipio/ano antes do boletim.",
        prazo: "24-48h",
        evidenciaHref: "/tracoma?tab=qualidade",
        score: 75 + divergences.length * 4,
        detalhe: first ? `${first.municipioNome || first.municipio}: diferenca ${first.diff}` : undefined
      });
    }
  }

  if (ratesResult.status === "fulfilled" && !ratesResult.value.missingPopulation) {
    const hotspots = [...(ratesResult.value.byMunicipality ?? [])]
      .filter((row) => Number(row.prevalencia ?? 0) >= 5)
      .sort((a, b) => Number(b.prevalencia ?? 0) - Number(a.prevalencia ?? 0))
      .slice(0, 3);
    for (const row of hotspots) {
      addPriority(items, {
        id: `tracoma-hotspot-${row.codigoIbge ?? row.municipio}`,
        level: Number(row.prevalencia ?? 0) >= 10 ? "critica" : "alta",
        source: "sinan",
        agravo: "Tracoma",
        territorio: `${row.municipio ?? "Municipio"} / ${row.gve ?? "GVE"}`,
        motivo: `Prevalencia ${Number(row.prevalencia ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
        acao: "Avaliar cobertura de exame, positivos e necessidade de acao territorial.",
        prazo: Number(row.prevalencia ?? 0) >= 10 ? "Hoje" : "24-48h",
        evidenciaHref: "/tracoma",
        score: 70 + Number(row.prevalencia ?? 0) * 5,
        detalhe: `${Number(row.positivos ?? 0).toLocaleString("pt-BR")} positivos em ${Number(row.examinados ?? 0).toLocaleString("pt-BR")} examinados`
      });
    }
  }

  return items
    .sort((a, b) => priorityRank(a.level) - priorityRank(b.level) || b.score - a.score)
    .slice(0, 12);
}

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const priorities = await buildPriorities();
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    priorities,
    summary: {
      total: priorities.length,
      critica: priorities.filter((item) => item.level === "critica").length,
      alta: priorities.filter((item) => item.level === "alta").length,
      media: priorities.filter((item) => item.level === "media").length
    }
  });
}
