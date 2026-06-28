"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Map, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

export function TerritoriesView() {
  const [query, setQuery] = useState("");
  const [agravo, setAgravo] = useState<"todos" | "Conjuntivite" | "Tracoma" | "Dados">("todos");

  const priorities = useQuery<SituationPriorities>({
    queryKey: ["situacao-prioridades-territorios"],
    queryFn: async () => {
      const response = await fetch("/api/situacao/prioridades");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar territórios");
      return data;
    },
    retry: false,
    staleTime: 2 * 60 * 1000
  });

  const rows = useMemo(() => {
    const q = normalizeText(query);
    return [...(priorities.data?.priorities ?? [])]
      .filter((item) => agravo === "todos" || item.agravo === agravo)
      .filter((item) => {
        if (!q) return true;
        return normalizeText(`${item.territorio} ${item.motivo} ${item.acao} ${item.agravo}`).includes(q);
      })
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || b.score - a.score);
  }, [agravo, priorities.data?.priorities, query]);

  return (
    <div className="flex flex-col">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-primary/30 bg-primary/10 text-primary">Análises</Badge>
              <Badge className="bg-muted text-foreground">{rows.length.toLocaleString("pt-BR")} território(s)</Badge>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Territórios priorizados</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ranking operacional por município/GVE, agravo, evidência e ação recomendada.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => priorities.refetch()} disabled={priorities.isFetching}>
            <RefreshCw className={`h-4 w-4 ${priorities.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="space-y-5 p-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar território, agravo, evidência ou ação"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2 rounded-md border bg-card p-1">
            {(["todos", "Conjuntivite", "Tracoma", "Dados"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setAgravo(item)}
                className={`h-9 rounded px-3 text-sm font-medium transition-colors ${
                  agravo === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {item === "todos" ? "Todos" : item}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Críticos</p>
              <p className="mt-1 text-3xl font-bold text-red-600 tabular-nums">{priorities.data?.summary.critica ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Altos</p>
              <p className="mt-1 text-3xl font-bold text-amber-700 tabular-nums">{priorities.data?.summary.alta ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total filtrado</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{rows.length.toLocaleString("pt-BR")}</p>
            </CardContent>
          </Card>
        </div>

        {priorities.isLoading && (
          <div className="flex h-44 items-center justify-center rounded-md border bg-card text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Consolidando territórios...
          </div>
        )}

        {priorities.isError && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex gap-3 py-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                <p className="font-medium">Territórios indisponíveis nesta consulta</p>
                <p className="text-amber-800">{priorities.error.message}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!priorities.isLoading && !priorities.isError && rows.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mb-3 h-10 w-10 text-teal-600" />
              Nenhum território priorizado com os filtros atuais.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {rows.map((item, index) => (
            <Link
              key={item.id}
              href={item.evidenciaHref}
              className="group grid gap-3 rounded-md border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 lg:grid-cols-[44px_150px_1fr_240px_auto]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-sm font-semibold tabular-nums">
                {index + 1}
              </div>
              <div className="space-y-1">
                <Badge className={priorityStyle(item.level)}>{item.level}</Badge>
                <p className="text-xs text-muted-foreground">{item.agravo}</p>
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-semibold">
                  <Map className="h-4 w-4 text-primary" />
                  {item.territorio}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{item.motivo}</p>
                {item.detalhe && <p className="mt-1 text-xs text-muted-foreground">{item.detalhe}</p>}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ação recomendada</p>
                <p className="mt-1 text-sm leading-snug">{item.acao}</p>
              </div>
              <div className="flex items-center justify-between gap-3 lg:justify-end">
                <Badge className="bg-muted text-foreground">{item.prazo}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
