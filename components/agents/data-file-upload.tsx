"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BarChart2, CheckCircle, Download, Upload } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DataAnalysisResult } from "@/lib/types";

const COLORS = ["#0f766e", "#ca8a04", "#2563eb", "#dc2626", "#7c3aed", "#059669"];

export function DataFileUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<DataAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const analyze = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/dados/analyze", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao analisar.");
      return data as DataAnalysisResult;
    },
    onSuccess: (data) => { setResult(data); setError(null); },
    onError: (err: Error) => setError(err.message)
  });

  async function handleExport() {
    if (!result) return;
    setExporting(true);
    try {
      const response = await fetch("/api/dados/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, title: `Analise — ${result.fileName}` })
      });
      if (!response.ok) throw new Error("Erro ao exportar.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analise_${result.fileName.replace(/\.[^.]+$/, "")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao exportar.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" />
            Analise de planilha
          </CardTitle>
          <CardDescription>
            Envie um arquivo .xlsx, .xls ou .csv para obter estatisticas descritivas, graficos e interpretacao automatica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setResult(null); analyze.mutate(f); }
              e.target.value = "";
            }}
          />
          <div className="flex gap-3">
            <Button onClick={() => fileRef.current?.click()} disabled={analyze.isPending}>
              {analyze.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Analisando...
                </span>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Selecionar arquivo
                </>
              )}
            </Button>
            {result && (
              <Button variant="outline" onClick={handleExport} disabled={exporting}>
                <Download className="h-4 w-4" />
                {exporting ? "Exportando..." : "Exportar DOCX"}
              </Button>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {analyze.isSuccess && result && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4" />
              {result.fileName} — {result.rows} linhas, {result.columns.length} variaveis
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Interpretação */}
          <Card>
            <CardHeader><CardTitle>Interpretacao automatica</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {result.interpretation.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </CardContent>
          </Card>

          {/* Gráficos */}
          {result.charts.filter((c) => c.data.length > 0).map((chart, i) => (
            <Card key={i}>
              <CardHeader><CardTitle className="text-base">{chart.title}</CardTitle></CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart.data} layout={chart.data.length > 8 ? "vertical" : "horizontal"}>
                    <CartesianGrid strokeDasharray="3 3" />
                    {chart.data.length > 8 ? (
                      <>
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis dataKey={chart.xKey} type="category" width={130} tick={{ fontSize: 10 }} />
                      </>
                    ) : (
                      <>
                        <XAxis dataKey={chart.xKey} tick={{ fontSize: 11 }} />
                        <YAxis />
                      </>
                    )}
                    <Tooltip />
                    <Bar dataKey={chart.yKeys[0]} radius={[4, 4, 0, 0]}>
                      {chart.data.map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ))}

          {/* Tabela de estatísticas */}
          <Card>
            <CardHeader><CardTitle>Estatisticas por variavel</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {["Variavel", "Tipo", "N", "Ausentes", "Media", "Mediana", "DP", "Min", "Max"].map((h) => (
                      <th key={h} className="py-2 pr-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.summary).map(([col, s]) => (
                    <tr key={col} className="border-b">
                      <td className="py-1.5 pr-3 font-medium">{col}</td>
                      <td className="pr-3">{s.type}</td>
                      <td className="pr-3">{s.count}</td>
                      <td className="pr-3">{s.missing}</td>
                      <td className="pr-3">{s.mean ?? "—"}</td>
                      <td className="pr-3">{s.median ?? "—"}</td>
                      <td className="pr-3">{s.stdDev ?? "—"}</td>
                      <td className="pr-3">{s.min ?? "—"}</td>
                      <td className="pr-3">{s.max ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
