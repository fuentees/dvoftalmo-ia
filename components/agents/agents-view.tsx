"use client";

import { useState } from "react";
import {
  BarChart2, Bot, ClipboardCopy, Download, Eye, Mail,
  Map, NotebookText, Stethoscope, Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { DataFileUpload } from "@/components/agents/data-file-upload";
import type { AgentKind } from "@/lib/types";

const agents: Array<{
  id: AgentKind;
  title: string;
  description: string;
  icon: React.ElementType;
  deliverables: string[];
  placeholder: string;
}> = [
  {
    id: "documentos",
    title: "Agente Documentos",
    description: "Oficios, despachos, memorandos, relatorios e solicitacoes institucionais.",
    icon: NotebookText,
    deliverables: ["DOCX", "PDF", "TXT"],
    placeholder: "Descreva o documento. Ex.: Oficio solicitando transporte para visita de campo em Itapetininga na semana de 23/06."
  },
  {
    id: "email",
    title: "Agente E-mail",
    description: "Convites, cobrancas, solicitacoes e comunicacoes institucionais.",
    icon: Mail,
    deliverables: ["Copiar", "TXT"],
    placeholder: "Descreva o e-mail. Ex.: Convite para capacitacao de vigilancia das conjuntivites para as UVIS da DRS de Campinas."
  },
  {
    id: "treinamentos",
    title: "Agente Treinamentos",
    description: "Cronogramas, listas, checklists, materiais e logistica de capacitacoes.",
    icon: Users,
    deliverables: ["DOCX", "TXT"],
    placeholder: "Descreva o treinamento. Ex.: Curso de 8h sobre vigilancia das conjuntivites para 30 participantes em Sao Paulo."
  },
  {
    id: "campo",
    title: "Agente Campo",
    description: "Transporte, hospedagem, alimentacao, equipes e relatorios de visitas.",
    icon: Map,
    deliverables: ["DOCX", "TXT"],
    placeholder: "Descreva a acao de campo. Ex.: Visita a 5 municipios da DRS de Aracatuba para supervisao das notificacoes de tracoma."
  },
  {
    id: "epidemiologico",
    title: "Agente Epidemiologico",
    description: "Relatorios tecnicos, boletins, indicadores e analises do banco CEVESP.",
    icon: Stethoscope,
    deliverables: ["DOCX", "PDF", "TXT"],
    placeholder: "Descreva o relatorio. Ex.: Relatorio epidemiologico das conjuntivites da SE 20 a 24 de 2026, com dados por GVE."
  },
  {
    id: "tracoma",
    title: "Agente Tracoma",
    description: "Prevalencia TF/TT, criterios OMS de eliminacao, estimativa de doses de azitromicina, relatorios de campo.",
    icon: Eye,
    deliverables: ["DOCX", "PDF", "TXT"],
    placeholder: "Ex.: Calcule a prevalencia de TF no municipio de Presidente Prudente com base nos dados do REDCap de 2025 e estime as doses de azitromicina necessarias."
  },
  {
    id: "dados",
    title: "Agente de Dados",
    description: "Analise estatistica de planilhas Excel/CSV — media, mediana, frequencias, tabelas cruzadas, graficos.",
    icon: BarChart2,
    deliverables: ["DOCX", "TXT"],
    placeholder: "Envie uma planilha acima ou descreva a analise. Ex.: Calcule frequencia de casos por GVE e faixa etaria."
  },
  {
    id: "cos",
    title: "Agente COS",
    description: "Agente com ferramentas reais: consulta CEVESP, tracoma REDCap, documentos e calcula doses de azitromicina.",
    icon: Bot,
    deliverables: ["TXT", "Copiar"],
    placeholder: "Use o Chat com o Agente COS para perguntas que precisam de dados reais. Ex.: total de casos por GVE nas últimas 5 SE com análise de tendência."
  }
];

export function AgentsView() {
  const [active, setActive] = useState<AgentKind>("documentos");
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const selected = agents.find((a) => a.id === active)!;
  const showFileUpload = active === "dados";
  const showCosInfo = active === "cos";

  async function exportText(format: "pdf" | "docx" | "txt") {
    if (!prompt.trim()) { setExportError("Descreva o que deseja gerar antes de exportar."); return; }
    setExportError(null);
    setExporting(format);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: selected.title, prompt, agent: active, format })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: "Erro ao exportar." }));
        throw new Error(data.error ?? "Erro ao exportar.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selected.title}.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Erro ao exportar.");
    } finally {
      setExporting(null);
    }
  }

  async function copyPrompt() {
    if (!prompt.trim()) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Agentes especializados</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Oito agentes para documentos, e-mails, treinamentos, campo, epidemiologia, tracoma, dados e o Agente COS.</p>
        </div>
      </div>
    <div className="space-y-6 p-6">
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Lista de agentes */}
        <div className="grid gap-2">
          {agents.map((agent) => {
            const Icon = agent.icon;
            return (
              <button
                key={agent.id}
                onClick={() => { setActive(agent.id); setExportError(null); setPrompt(""); }}
                className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
                  active === agent.id ? "border-primary bg-primary/5" : "bg-card"
                }`}
              >
                <div className="mb-0.5 flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-primary" />
                  {agent.title}
                </div>
                <p className="text-xs text-muted-foreground">{agent.description}</p>
              </button>
            );
          })}
        </div>

        {/* Área de composição */}
        <div className="space-y-4">
          {showFileUpload && <DataFileUpload />}
          {showCosInfo && (
            <div className="rounded-lg border bg-primary/5 p-4 text-sm">
              <p className="mb-2 font-medium text-primary">Ferramentas disponíveis no Agente COS</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>• <strong>consultar_cevesp</strong> — dados de notificações por SE, GVE, DRS, município</li>
                <li>• <strong>consultar_tracoma</strong> — inquéritos REDCap, prevalência TF/TT, status OMS</li>
                <li>• <strong>estimar_azitromicina</strong> — doses por faixa de peso (protocolo OMS/OPAS)</li>
                <li>• <strong>buscar_documentos</strong> — normas, manuais e documentos indexados</li>
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">O agente decide automaticamente quais ferramentas usar e pode encadeá-las em múltiplos passos antes de responder. Use no <strong>Chat</strong> selecionando "Agente COS".</p>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{selected.title}</CardTitle>
              <CardDescription>{selected.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {selected.deliverables.map((item) => (
                  <span key={item} className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">{item}</span>
                ))}
              </div>

              <Textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setExportError(null); }}
                placeholder={selected.placeholder}
                className="min-h-[200px]"
              />

              {exportError && (
                <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{exportError}</p>
              )}

              <div className="flex flex-wrap gap-2">
                {(selected.deliverables.includes("Copiar") || selected.id === "email") && (
                  <Button variant="outline" onClick={copyPrompt} disabled={!prompt.trim()}>
                    <ClipboardCopy className="h-4 w-4" />
                    {copied ? "Copiado!" : "Copiar"}
                  </Button>
                )}
                {selected.deliverables.includes("DOCX") && (
                  <Button variant="outline" onClick={() => exportText("docx")} disabled={!!exporting}>
                    <Download className="h-4 w-4" />
                    {exporting === "docx" ? "Gerando..." : "DOCX"}
                  </Button>
                )}
                {selected.deliverables.includes("PDF") && (
                  <Button variant="outline" onClick={() => exportText("pdf")} disabled={!!exporting}>
                    <Download className="h-4 w-4" />
                    {exporting === "pdf" ? "Gerando..." : "PDF"}
                  </Button>
                )}
                {selected.deliverables.includes("TXT") && (
                  <Button onClick={() => exportText("txt")} disabled={!!exporting}>
                    <Download className="h-4 w-4" />
                    {exporting === "txt" ? "Gerando..." : "TXT"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}
