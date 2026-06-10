"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle, Database, Download, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { EpidemicCharts, EndemicChannelChart } from "@/components/notifications/epidemic-charts";

export function NotificationsReportView() {
  const [question, setQuestion] = useState("Total de casos por GVE dos ultimos 5 anos por mes");
  const [showEndemic, setShowEndemic] = useState(false);

  const report = useQuery({
    queryKey: ["notifications-report"],
    queryFn: async () => {
      const response = await fetch("/api/notificacoes/relatorio");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao gerar relatorio");
      return data;
    },
    enabled: false
  });

  const endemic = useQuery({
    queryKey: ["canal-endemico"],
    queryFn: async () => {
      const response = await fetch("/api/cevesp/canal-endemico");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao calcular canal endemico");
      return data;
    },
    enabled: showEndemic
  });

  const ask = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/notificacoes/pergunta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erro ao consultar banco");
      return data;
    }
  });

  function downloadBoletim() {
    window.open("/api/cevesp/boletim", "_blank");
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b bg-card px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Notificações CEVESP</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Análise em tempo real do banco externo MariaDB — modo leitura.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setShowEndemic(true); }}>
            <FileText className="h-4 w-4" />
            Canal endêmico
          </Button>
          <Button variant="outline" onClick={downloadBoletim}>
            <Download className="h-4 w-4" />
            Boletim Word
          </Button>
          <Button onClick={() => report.refetch()} disabled={report.isFetching}>
            <RefreshCw className="h-4 w-4" />
            Gerar relatório
          </Button>
        </div>
      </div>

      <div className="space-y-6 p-6">
      {/* ── Consulta em linguagem natural ───────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Perguntar ao banco CEVESP</CardTitle>
          <CardDescription>
            Faça perguntas livres. O agente converte em consulta segura usando apenas campos e métricas permitidos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ex.: Total de casos por GVE dos ultimos 5 anos por mes"
            className="min-h-[90px]"
          />
          <Button onClick={() => ask.mutate()} disabled={ask.isPending}>
            Consultar banco
          </Button>
          {ask.isError && (
            <p className="text-sm text-destructive">{(ask.error as Error).message}</p>
          )}
          {ask.data && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{ask.data.metricLabel}</Badge>
                <Badge className="border-primary/50 text-primary">{ask.data.timeLabel}</Badge>
                {(ask.data.analysis?.dimensions ?? []).map((item: string) => (
                  <Badge key={item} className="bg-muted text-foreground">{item}</Badge>
                ))}
              </div>
              <div className="rounded-md border p-4">
                <h3 className="mb-2 text-sm font-semibold">Interpretação epidemiológica</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {ask.data.interpretation.map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              {ask.data.weeklyReport && (
                <div className="space-y-4">
                  <div className="rounded-md border p-4">
                    <h3 className="mb-3 text-sm font-semibold">Metodologia</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {ask.data.weeklyReport.methodology.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Card>
                      <CardHeader><CardTitle>Total geral</CardTitle></CardHeader>
                      <CardContent className="text-2xl font-semibold">{ask.data.weeklyReport.totalCases}</CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>Anos no período</CardTitle></CardHeader>
                      <CardContent className="text-2xl font-semibold">{ask.data.weeklyReport.yearTotals.length}</CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>Semanas com dados</CardTitle></CardHeader>
                      <CardContent className="text-2xl font-semibold">{ask.data.weeklyReport.pivotRows.length - 1}</CardContent>
                    </Card>
                  </div>
                  <div className="grid gap-2 md:grid-cols-4">
                    {ask.data.weeklyReport.yearTotals.map((item: { year: string; total: number }) => (
                      <div key={item.year} className="flex justify-between rounded-md border p-2 text-sm">
                        <span className="font-medium">{item.year}</span>
                        <strong>{item.total}</strong>
                      </div>
                    ))}
                  </div>
                  <ResultTable
                    title={ask.data.weeklyReport.title}
                    columns={ask.data.weeklyReport.columns}
                    rows={ask.data.weeklyReport.pivotRows}
                  />
                </div>
              )}
              {ask.data.monthlyReport && (
                <div className="space-y-4">
                  <div className="rounded-md border p-4">
                    <h3 className="mb-3 text-sm font-semibold">Metodologia</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {ask.data.monthlyReport.methodology.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Card>
                      <CardHeader><CardTitle>Total geral</CardTitle></CardHeader>
                      <CardContent className="text-2xl font-semibold">{ask.data.monthlyReport.totalCases}</CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>GVEs analisados</CardTitle></CardHeader>
                      <CardContent className="text-2xl font-semibold">{ask.data.monthlyReport.gveSections.length}</CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>Anos no período</CardTitle></CardHeader>
                      <CardContent className="text-2xl font-semibold">{ask.data.monthlyReport.yearTotals.length}</CardContent>
                    </Card>
                  </div>
                  <ResultTable
                    title="Consolidado estadual — total de casos por mês"
                    columns={ask.data.columns}
                    rows={ask.data.monthlyReport.statewideRows}
                  />
                  <Card>
                    <CardHeader><CardTitle>GVEs com maior acumulado no período</CardTitle></CardHeader>
                    <CardContent className="grid gap-2 md:grid-cols-2">
                      {ask.data.monthlyReport.topGves.map((item: { gve: string; total: number }) => (
                        <div key={item.gve} className="flex justify-between rounded-md border p-2 text-sm">
                          <span>{item.gve}</span>
                          <strong>{item.total}</strong>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  {ask.data.monthlyReport.gveSections.map((section: { gve: string; rows: Array<Record<string, unknown>> }) => (
                    <ResultTable
                      key={section.gve}
                      title={`GVE: ${section.gve}`}
                      columns={ask.data.columns}
                      rows={section.rows}
                    />
                  ))}
                </div>
              )}
              {!ask.data.monthlyReport && !ask.data.weeklyReport && (
                <ResultTable
                  columns={ask.data.columns ?? Object.keys(ask.data.rows[0] ?? {})}
                  rows={ask.data.rows}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Canal endêmico ──────────────────────────────────── */}
      {showEndemic && (
        <div className="space-y-2">
          {endemic.isError && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Erro no canal endêmico
                </CardTitle>
                <CardDescription>{(endemic.error as Error).message}</CardDescription>
              </CardHeader>
            </Card>
          )}
          {endemic.isFetching && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                Calculando canal endêmico...
              </CardContent>
            </Card>
          )}
          {endemic.data && endemic.data.length > 0 && (
            <EndemicChannelChart data={endemic.data} />
          )}
        </div>
      )}

      {/* ── Erros do relatório ──────────────────────────────── */}
      {report.isError && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Falha ao conectar
            </CardTitle>
            <CardDescription>{(report.error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!report.data && !report.isError && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Banco externo configurado
            </CardTitle>
            <CardDescription>Clique em "Gerar relatório" para consultar a tabela e montar os indicadores epidemiológicos.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* ── Relatório completo ──────────────────────────────── */}
      {report.data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Total no banco</CardTitle></CardHeader>
              <CardContent className="text-3xl font-semibold">{report.data.totalRowsInDatabase}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Amostra analisada</CardTitle></CardHeader>
              <CardContent className="text-3xl font-semibold">{report.data.sampledRows}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Total de casos</CardTitle></CardHeader>
              <CardContent className="text-3xl font-semibold">{report.data.indicators.totalCases}</CardContent>
            </Card>
          </div>

          {/* Interpretação */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Interpretação epidemiológica
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {report.data.interpretation.map((item: string, i: number) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Gráficos */}
          <EpidemicCharts
            weeklySeries={report.data.indicators.weeklySeries ?? []}
            ageDistribution={report.data.indicators.ageDistribution ?? []}
            sexDistribution={report.data.indicators.sexDistribution ?? []}
            topMunicipalities={report.data.indicators.topMunicipalities ?? []}
            topGves={report.data.indicators.topGves ?? []}
          />

          {/* Investigação e medidas */}
          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Distribuição por sexo</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {report.data.indicators.sexDistribution.map((item: { label: string; total: number }) => (
                  <div key={item.label} className="flex justify-between text-sm">
                    <span>{item.label}</span>
                    <strong>{item.total}</strong>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Faixa etária</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {report.data.indicators.ageDistribution.map((item: { label: string; total: number }) => (
                  <div key={item.label} className="flex justify-between text-sm">
                    <span>{item.label}</span>
                    <strong>{item.total}</strong>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Investigação e medidas</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Notificações com surto</span><strong>{report.data.indicators.outbreakNotifications}</strong></div>
                <div className="flex justify-between"><span>Total de surtos</span><strong>{report.data.indicators.outbreakTotal}</strong></div>
                <div className="flex justify-between"><span>Coletas biológicas</span><strong>{report.data.indicators.biologicalCollectionTotal}</strong></div>
                <div className="flex justify-between"><span>Ações educativas</span><strong>{report.data.indicators.educationalActions}</strong></div>
                <div className="flex justify-between"><span>Treinamentos</span><strong>{report.data.indicators.trainings}</strong></div>
                <div className="flex justify-between"><span>Afastamentos</span><strong>{report.data.indicators.symptomaticStaffRemoval}</strong></div>
                <div className="flex justify-between"><span>Encaminhamentos</span><strong>{report.data.indicators.specializedReferrals}</strong></div>
              </CardContent>
            </Card>
          </div>

          {/* Alertas */}
          {report.data.alerts.length > 0 && (
            <Card className="border-yellow-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  Alertas epidemiológicos
                </CardTitle>
                <CardDescription>Situações que merecem investigação pela vigilância.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.data.alerts.map((alert: { title: string; severity: string; description: string }) => (
                  <div key={alert.title} className="rounded-md border p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge className={alert.severity === "alta" ? "border-red-400 bg-red-50 text-red-700" : "border-yellow-400 bg-yellow-50 text-yellow-700"}>
                        {alert.severity}
                      </Badge>
                      <strong className="text-sm">{alert.title}</strong>
                    </div>
                    <p className="text-sm text-muted-foreground">{alert.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Recomendações */}
          <Card>
            <CardHeader><CardTitle>Recomendações para boletim</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {report.data.bulletinSections.recomendacoes.map((item: string, i: number) => (
                <p key={i}>{item}</p>
              ))}
            </CardContent>
          </Card>

          {/* Resumo estrutural */}
          <Card>
            <CardHeader>
              <CardTitle>Resumo por coluna</CardTitle>
              <CardDescription>Primeira leitura estrutural para orientar o relatório epidemiológico.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2">Coluna</th>
                    <th>Tipo</th>
                    <th>Ausentes</th>
                    <th>Valores frequentes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.columns.map((column: { name: string; type: string; missing: number; topValues: Array<{ value: string; count: number }> }) => (
                    <tr key={column.name} className="border-b">
                      <td className="py-2 font-medium">{column.name}</td>
                      <td>{column.type}</td>
                      <td>{column.missing}</td>
                      <td className="max-w-[520px] truncate">
                        {column.topValues.map((item) => `${item.value} (${item.count})`).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
      </div>
    </div>
  );
}

function ResultTable({
  title,
  columns,
  rows
}: {
  title?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}) {
  return (
    <div className="space-y-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-muted text-left">
              {columns.map((key) => (
                <th key={key} className="px-3 py-2">{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                className={`border-b ${row.Mes === "Total" ? "bg-muted/50 font-semibold" : ""}`}
              >
                {columns.map((key) => (
                  <td key={key} className="px-3 py-2">{String(row[key] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
