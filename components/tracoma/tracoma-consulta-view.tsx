"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Database, Download, MessageSquareText, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { listarGvesSp, listarMunicipiosPorGve } from "@/lib/municipios-sp";

type AskData = {
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
  "Total de casos por ano no TRACONET",
  "Total de positivos por município no NOTTRACONET",
  "Casos por GVE entre 2020 e 2026",
  "Registros individuais por município e ano",
  "Casos com forma clínica por ano",
  "Qualidade dos registros individuais por município"
];

function buildQuestion(question: string, filters: { gve: string; municipio: string; yearStart: string; yearEnd: string }) {
  const parts = [question.trim()];
  if (filters.yearStart && filters.yearEnd) parts.push(`entre ${filters.yearStart} e ${filters.yearEnd}`);
  else if (filters.yearStart) parts.push(`ano ${filters.yearStart}`);
  else if (filters.yearEnd) parts.push(`até ${filters.yearEnd}`);
  if (filters.gve) parts.push(`GVE ${filters.gve}`);
  if (filters.municipio) parts.push(`município ${filters.municipio}`);
  return parts.filter(Boolean).join(" ");
}

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

export function TracomaConsultaView() {
  const [question, setQuestion] = useState("Total de casos por ano no TRACONET");
  const [gve, setGve] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");

  const gveOptions = useMemo(() => listarGvesSp(), []);
  const municipioOptions = useMemo(() => listarMunicipiosPorGve(gve), [gve]);

  const ask = useMutation<AskData>({
    mutationFn: async () => {
      const response = await fetch("/api/sinan-tracoma/pergunta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: buildQuestion(question, { gve, municipio, yearStart, yearEnd }) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao consultar banco SINAN Tracoma");
      return data as AskData;
    }
  });

  const rows = ask.data?.rows ?? [];
  const columns = ask.data?.columns ?? Object.keys(rows[0] ?? {});

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Consulta ao banco Tracoma
          </CardTitle>
          <CardDescription>
            Use para montar tabelas por ano, GVE, município, banco, forma clínica, qualidade ou período.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <select
              value={gve}
              onChange={(event) => { setGve(event.target.value); setMunicipio(""); }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos os GVEs</option>
              {gveOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select
              value={municipio}
              onChange={(event) => setMunicipio(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos os municípios</option>
              {municipioOptions.map((item) => <option key={item.codigo} value={item.nome}>{item.nome}</option>)}
            </select>
            <input
              type="number"
              placeholder="Ano início"
              value={yearStart}
              onChange={(event) => setYearStart(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
            <input
              type="number"
              placeholder="Ano fim"
              value={yearEnd}
              onChange={(event) => setYearEnd(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
          </div>

          <Textarea
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
            <Button onClick={() => ask.mutate()} disabled={ask.isPending}>
              {ask.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Consultar banco
            </Button>
            {rows.length > 0 && (
              <Button variant="outline" onClick={() => downloadCsv(columns, rows)}>
                <Download className="h-4 w-4" />
                Exportar CSV
              </Button>
            )}
          </div>

          {(gve || municipio || yearStart || yearEnd) && (
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

      {ask.data && (
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
            <ResultTable columns={columns} rows={rows} />
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
