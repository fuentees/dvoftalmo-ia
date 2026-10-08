"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Database, Download, MessageSquareText, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";
import { AnalysisChart } from "@/components/analysis-chart";
import { validateTracomaFilters } from "@/lib/tracoma-data";

type AskData = {
  querySignature?: string;
  question?: string;
  parsed?: Record<string, unknown>;
  metricLabel?: string;
  timeLabel?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  interpretation?: string[];
  quality?: {
    missing?: Record<string, number>;
    recommendations?: string[];
  };
};

const guidedQuestions = [
  "Total de casos por GVE no TRACONET dos últimos 5 anos separado por ano",
  "Total de casos por município no NOTTRACONET dos últimos 5 anos separado por ano",
  "Total de casos por ano no TRACONET",
  "Total de positivos por município no NOTTRACONET"
];

const banks = [
  { value: "TRACONET", label: "TRACONET individual" },
  { value: "NOTTRACONET", label: "NOTTRACONET consolidado" }
];

const dimensions = [
  { value: "por GVE", label: "GVE" },
  { value: "por município", label: "Município" },
  { value: "por ano", label: "Ano" }
];

const periods = [
  { value: "últimos 5 anos", label: "Últimos 5 anos" },
  { value: "últimos 3 anos", label: "Últimos 3 anos" },
  { value: "últimos 10 anos", label: "Últimos 10 anos" },
  { value: "este ano", label: "Este ano" },
  { value: "ano passado", label: "Ano passado" },
];

const spatialDimensions = new Set(["por GVE", "por município"]);

function downloadCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [
    columns.map(escape).join(";"),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(";"))
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tracoma-consulta-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ResultTable({ columns, rows }: { columns: string[]; rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            {columns.map((column) => <th key={column} className="px-3 py-2 font-medium">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isTotal = Object.values(row).some((value) => String(value).toLowerCase() === "total");
            return (
              <tr key={index} className={`border-b last:border-0 ${isTotal ? "bg-muted/40 font-semibold" : ""}`}>
                {columns.map((column) => <td key={column} className="px-3 py-2">{String(row[column] ?? "")}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type TracomaConsultaViewProps = {
  externalFilters?: {
    yearStart?: string;
    yearEnd?: string;
    gve?: string;
    municipio?: string;
  };
  hideFilters?: boolean;
};

export function TracomaConsultaView({ externalFilters, hideFilters = false }: TracomaConsultaViewProps = {}) {
  const [question, setQuestion] = useState("Total de casos por GVE no TRACONET dos últimos 5 anos separado por ano");
  const [bank, setBank] = useState("TRACONET");
  const [dimension, setDimension] = useState("por GVE");
  const [period, setPeriod] = useState("últimos 5 anos");
  const [localGve, setGve] = useState("");
  const [localMunicipio, setMunicipio] = useState("");
  const [localYearStart, setYearStart] = useState("");
  const [localYearEnd, setYearEnd] = useState("");
  const gve = externalFilters?.gve ?? localGve;
  const municipio = externalFilters?.municipio ?? localMunicipio;
  const yearStart = externalFilters?.yearStart ?? localYearStart;
  const yearEnd = externalFilters?.yearEnd ?? localYearEnd;
  const filters = { gve, municipio, yearStart, yearEnd };
  const signature = JSON.stringify({ question: question.trim(), filters });
  let filterError = "";
  try { validateTracomaFilters(filters); } catch (error) { filterError = (error as Error).message; }

  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gve), [gve]);

  function applyStructuredQuestion() {
    const indicator = bank === "TRACONET" ? "Registros individuais" : "Total de positivos";
    const isSpatial = spatialDimensions.has(dimension);
    const isMultiYear = period.startsWith("últimos");
    if (isSpatial && isMultiYear) {
      setQuestion(`${indicator} ${dimension} no ${bank} dos ${period} separado por ano`);
    } else if (isSpatial) {
      setQuestion(`${indicator} ${dimension} no ${bank} ${period}`);
    } else {
      setQuestion(`${indicator} ${dimension} no ${bank} dos ${period}`);
    }
  }

  const ask = useMutation<AskData, Error, { question: string; filters: typeof filters; signature: string }>({
    mutationFn: async (snapshot) => {
      const response = await fetch("/api/sinan-tracoma/pergunta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: snapshot.question, filters: snapshot.filters })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao consultar banco SINAN Tracoma");
      return { ...data, querySignature: snapshot.signature } as AskData;
    }
  });

  const matchesCurrentQuery = ask.data?.querySignature === signature;
  const rows = matchesCurrentQuery ? ask.data?.rows ?? [] : [];
  const columns = ask.data?.columns ?? Object.keys(rows[0] ?? {});

  return (
    <div className="min-w-0 space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Consulta ao banco Tracoma
          </CardTitle>
          <CardDescription>
            Monte contagens de registros individuais do TRACONET ou positivos consolidados do NOTTRACONET por ano, GVE ou município. Os filtros do painel prevalecem sobre o período escrito na pergunta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hideFilters && <div className="grid gap-3 md:grid-cols-4">
            <select
              value={gve}
              aria-label="GVE da consulta de tracoma"
              onChange={(event) => { setGve(event.target.value); setMunicipio(""); }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos os GVEs</option>
              {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select
              value={municipio}
              aria-label="Município da consulta de tracoma"
              onChange={(event) => setMunicipio(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos os municípios</option>
              {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
            </select>
            <input
              type="number"
              placeholder="Ano início"
              aria-label="Ano inicial da consulta"
              min={1975}
              max={new Date().getFullYear()}
              value={yearStart}
              onChange={(event) => setYearStart(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
            <input
              type="number"
              placeholder="Ano fim"
              aria-label="Ano final da consulta"
              min={1975}
              max={new Date().getFullYear()}
              value={yearEnd}
              onChange={(event) => setYearEnd(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
          </div>}

          <div className="grid min-w-0 gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            <select
              value={bank}
              aria-label="Banco da consulta"
              onChange={(event) => setBank(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {banks.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select
              value={dimension}
              aria-label="Agrupamento da consulta"
              onChange={(event) => setDimension(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {dimensions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select
              value={period}
              aria-label="Período da consulta"
              disabled={Boolean(yearStart || yearEnd)}
              onChange={(event) => setPeriod(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={applyStructuredQuestion}>
              Montar pergunta
            </Button>
          </div>

          <Textarea
            aria-label="Pergunta sobre os registros de tracoma"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ex.: Total de casos por município no TRACONET"
            className="min-h-[90px]"
          />

          <div className="flex flex-wrap gap-2">
            {guidedQuestions.map((item) => (
              <Button
                key={item}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-8 whitespace-normal text-left text-xs"
                onClick={() => setQuestion(item)}
              >
                {item}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => ask.mutate({ question, filters, signature })} disabled={ask.isPending || Boolean(filterError) || !question.trim()}>
              {ask.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Consultar banco
            </Button>
            {rows.length > 0 && (
              <Button variant="outline" disabled={ask.isPending} onClick={() => downloadCsv(columns, rows)}>
                <Download className="h-4 w-4" />
                Exportar CSV
              </Button>
            )}
          </div>
          {filterError && <p role="alert" className="text-sm text-destructive">{filterError}</p>}
          {ask.data && !matchesCurrentQuery && <p role="status" className="text-sm text-muted-foreground">Os filtros ou a pergunta mudaram. Consulte novamente para atualizar os resultados.</p>}

          {!hideFilters && (gve || municipio || yearStart || yearEnd) && (
            <div className="flex flex-wrap gap-2">
              {gve && <Badge className="bg-muted text-foreground">GVE: {gve}</Badge>}
              {municipio && <Badge className="bg-muted text-foreground">Município: {municipio}</Badge>}
              {yearStart && <Badge className="bg-muted text-foreground">De: {yearStart}</Badge>}
              {yearEnd && <Badge className="bg-muted text-foreground">Até: {yearEnd}</Badge>}
            </div>
          )}
        </CardContent>
      </Card>

      {ask.isError && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Consulta indisponível</CardTitle>
            <CardDescription className="text-amber-800">{(ask.error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {ask.data && matchesCurrentQuery && !ask.isPending && !ask.isError && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {ask.data.metricLabel && <Badge>{ask.data.metricLabel}</Badge>}
            {ask.data.timeLabel && <Badge className="border-primary/50 text-primary">{ask.data.timeLabel}</Badge>}
          </div>
          {(ask.data.interpretation ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <MessageSquareText className="h-4 w-4" />
                  Interpretação
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {(ask.data.interpretation ?? []).map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}
          {rows.length > 0 ? (
            <div className="space-y-6">
              <AnalysisChart columns={columns} rows={rows} title="Série histórica / distribuição" />
              <ResultTable columns={columns} rows={rows} />
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma linha retornada para a consulta.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
