"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QualityBucket } from "@/lib/cevesp-quality-buckets";
import type { GroupMember, InvalidRecord } from "@/services/cevesp-corrections";

const fmt = (n: number) => n.toLocaleString("pt-BR");

const BUCKETS: Array<{
  id: QualityBucket;
  titulo: string;
  selo: string;
  descricao: string;
  tone: { border: string; badge: string };
  icon: typeof CheckCircle2;
}> = [
  {
    id: "pronta",
    titulo: "Com correção pronta",
    selo: "Revisar e aprovar",
    descricao: "Semana trocada, SE em branco ou futura e ano digitado errado, com o valor certo já calculado.",
    tone: { border: "border-border", badge: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
    icon: CheckCircle2
  },
  {
    id: "decisao",
    titulo: "Precisam de decisão",
    selo: "Uma por grupo",
    descricao: "A mesma unidade notificou a mesma semana mais de uma vez. Escolha qual registro vale.",
    tone: { border: "border-red-200 dark:border-red-900", badge: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" },
    icon: Users
  },
  {
    id: "unidade",
    titulo: "Voltar para a unidade",
    selo: "Só a origem corrige",
    descricao: "Faixa etária ou sexo que não somam o total, datas inválidas e semanas sem vaga livre.",
    tone: { border: "border-border", badge: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200" },
    icon: Send
  }
];

export function QualityBucketCards({
  counts,
  active,
  onSelect,
  onProposeReady,
  proposing
}: {
  counts: Record<QualityBucket, number>;
  active: QualityBucket | "";
  onSelect: (bucket: QualityBucket | "") => void;
  onProposeReady: () => void;
  proposing: boolean;
}) {
  return (
    <section aria-label="Pendências por quem resolve" className="grid gap-4 md:grid-cols-3">
      {BUCKETS.map((b) => {
        const selected = active === b.id;
        const Icon = b.icon;
        return (
          <div
            key={b.id}
            className={cn(
              "flex flex-col gap-3 rounded-xl border bg-card p-[18px] transition-shadow",
              b.tone.border,
              selected && "ring-2 ring-primary"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {b.titulo}
              </span>
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", b.tone.badge)}>{b.selo}</span>
            </div>
            <span className="num text-[32px] font-semibold leading-none">{fmt(counts[b.id] ?? 0)}</span>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{b.descricao}</p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button
                type="button"
                variant={selected ? "default" : "outline"}
                className="h-11 flex-1"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? "" : b.id)}
              >
                {selected ? "Mostrando na lista" : "Ver na lista"}
              </Button>
              {b.id === "pronta" && (counts.pronta ?? 0) > 0 && (
                <Button type="button" className="h-11 flex-1" disabled={proposing} onClick={onProposeReady}>
                  <ClipboardCheck className="mr-1.5 h-4 w-4" />
                  {proposing ? "Enviando..." : `Enviar ${fmt(counts.pronta)} para a fila`}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

const CAMPOS: Array<[string, string]> = [
  ["TotalCaso", "Total de casos"],
  ["FxMenorUmAno", "Menor de 1 ano"],
  ["FxUmQuatro", "1 a 4 anos"],
  ["FxCincoNove", "5 a 9 anos"],
  ["FxDezQuatorze", "10 a 14 anos"],
  ["FxQuizeOuMais", "15 anos ou mais"],
  ["SexMasc", "Masculino"],
  ["SexFem", "Feminino"]
];

function dataHora(value: string | null) {
  if (!value) return "—";
  const [d, h] = value.split(" ");
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}${h ? ` ${h.slice(0, 5)}` : ""}`;
}

/** Comparação lado a lado dos registros de um grupo de duplicidade e escolha de qual vale. */
export function DuplicateComparePanel({
  record,
  onDecide,
  deciding
}: {
  record: InvalidRecord | null;
  onDecide: (manter: string, excluir: string[]) => void;
  deciding: boolean;
}) {
  const members: GroupMember[] = useMemo(() => record?.groupMembers ?? [], [record]);
  const [manter, setManter] = useState<string>("");

  // Por padrão fica o mais recente (última versão enviada pela unidade)
  useEffect(() => {
    setManter(members.length ? members[members.length - 1].recordId : "");
  }, [members]);

  if (!record || members.length < 2) {
    return (
      <aside className="rounded-xl border border-dashed bg-card p-5 text-sm leading-relaxed text-muted-foreground">
        Escolha um grupo na lista para comparar os registros lado a lado.
      </aside>
    );
  }

  const diferentes = new Set(
    CAMPOS.map(([campo]) => campo).filter((campo) => new Set(members.map((m) => m.valores[campo] ?? null)).size > 1)
  );
  const excluir = members.map((m) => m.recordId).filter((id) => id !== manter);

  return (
    <aside aria-label="Comparação do grupo selecionado" className="flex flex-col gap-4 rounded-xl border bg-card p-[18px]">
      <div className="space-y-1">
        <span className="text-[13px] text-muted-foreground">Grupo selecionado</span>
        <h2 className="text-[17px] font-semibold leading-snug">{record.group}</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="p-1.5 font-semibold">Campo</th>
              {members.map((m) => <th key={m.recordId} className="num p-1.5 font-semibold">{m.recordId}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-1.5 text-muted-foreground">Digitado em</td>
              {members.map((m) => <td key={m.recordId} className="num p-1.5">{dataHora(m.createdAt)}</td>)}
            </tr>
            {CAMPOS.map(([campo, rotulo]) => (
              <tr key={campo} className="border-t">
                <td className="p-1.5 text-muted-foreground">{rotulo}</td>
                {members.map((m) => (
                  <td
                    key={m.recordId}
                    className={cn("num p-1.5", diferentes.has(campo) && "bg-red-50 font-semibold text-red-800 dark:bg-red-950 dark:text-red-200")}
                  >
                    {m.valores[campo] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t">
              <td className="p-1.5 text-muted-foreground">Notificante</td>
              {members.map((m) => <td key={m.recordId} className="p-1.5">{m.notificante ?? "—"}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {diferentes.size
          ? "Campos destacados são diferentes entre os envios."
          : "Os números são iguais nos envios: é uma cópia."}
      </p>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Qual registro vale?</legend>
        {members.map((m, i) => (
          <label
            key={m.recordId}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-sm",
              manter === m.recordId ? "border-primary bg-secondary" : "border-input"
            )}
          >
            <input type="radio" name="manter" checked={manter === m.recordId} onChange={() => setManter(m.recordId)} />
            Manter <span className="num">{m.recordId}</span>
            {i === members.length - 1 ? " (mais recente)" : i === 0 ? " (primeiro envio)" : ""}
          </label>
        ))}
      </fieldset>

      <Button type="button" className="h-11" disabled={!manter || deciding} onClick={() => onDecide(manter, excluir)}>
        {deciding ? "Enviando..." : `Propor exclusão de ${excluir.length} e ir para o próximo`}
      </Button>
      <p className="text-xs text-muted-foreground">A exclusão é uma proposta: só vale depois de aprovada em Correções.</p>
    </aside>
  );
}
