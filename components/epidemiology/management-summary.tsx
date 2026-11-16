"use client";

import { ArrowRight, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { QualityReadout } from "@/lib/management-reading";

export function PanelScope({ scope, source }: { scope: string; source: string }) {
  return <div className="border-b bg-muted/20 px-4 py-3 text-xs sm:px-6">
    <p><span className="font-semibold">Recorte em análise: </span>{scope}</p>
    <p className="mt-1 text-muted-foreground">{source}</p>
  </div>;
}

export function ManagementSummary({
  figure, territory, quality, nextAction, onReviewQuality, territoryHref
}: {
  figure: { value: string; detail: string };
  territory: { value: string; detail: string };
  quality: QualityReadout;
  nextAction: string;
  onReviewQuality?: () => void;
  territoryHref?: string;
}) {
  const item = "rounded-md border bg-background p-3";
  const label = "text-xs font-medium text-muted-foreground";
  const value = "mt-1 text-sm font-semibold leading-snug";
  const detail = "mt-1 text-xs text-muted-foreground";
  return <Card className="border-primary/20 bg-primary/5">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">Resumo para gestão</CardTitle>
      <CardDescription>O cenário, os dados que exigem conferência e o próximo passo.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={item}>
          <p className={label}>O que mostram os dados</p><p className={value}>{figure.value}</p><p className={detail}>{figure.detail}</p>
        </div>
        <div className={item}>
          <p className={label}>Onde olhar primeiro</p><p className={value}>{territory.value}</p><p className={detail}>{territory.detail}</p>
        </div>
        <div className={`${item} ${quality.tone === "attention" ? "border-amber-300 bg-amber-50" : ""}`}>
          <p className={label}>Qualidade dos dados</p><p className={value}>{quality.label}</p><p className={detail}>{quality.detail}</p>
        </div>
        <div className={item}>
          <p className={label}>Próximo passo</p><p className={value}>{nextAction}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {onReviewQuality && <Button size="sm" variant="outline" onClick={onReviewQuality}><ClipboardCheck className="h-4 w-4" />Ver pendências de qualidade</Button>}
        {territoryHref ? <Button size="sm" variant="outline" asChild><a href={territoryHref}>Ver municípios e indicadores<ArrowRight className="h-4 w-4" /></a></Button>
          : <p className="self-center text-xs text-muted-foreground">Análise territorial ainda indisponível para este recorte.</p>}
      </div>
    </CardContent>
  </Card>;
}
