"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ClipboardList, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";

interface AuditEntry {
  id: string;
  correction_id: string;
  action: string;
  applied_by: string;
  applied_at: string;
  table_name?: string | null;
  record_id?: string | null;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  applier?: { full_name: string } | null;
}

const ACTION_VERBS: Record<string, string> = {
  applied: "aplicou a correção",
  rolled_back: "desfez a correção"
};

const ACTION_DOTS: Record<string, string> = {
  applied: "bg-teal-600",
  rolled_back: "bg-amber-500"
};

const PERIODOS = [
  { id: "7", label: "Últimos 7 dias" },
  { id: "30", label: "Últimos 30 dias" },
  { id: "90", label: "Últimos 90 dias" },
  { id: "todos", label: "Todo o período" }
] as const;

const PAGE_SIZE = 50;

function pessoa(entry: AuditEntry) {
  return entry.applier?.full_name ?? "Usuário " + (entry.applied_by?.slice(0, 8) ?? "?");
}

function downloadCsv(entries: AuditEntry[]) {
  const headers = ["Quando", "Pessoa", "Ação", "Tabela", "Registro", "Campo", "Antes", "Depois"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = entries.map((entry) =>
    [
      new Date(entry.applied_at).toLocaleString("pt-BR"),
      pessoa(entry),
      entry.action === "applied" ? "Aplicada" : entry.action === "rolled_back" ? "Desfeita" : entry.action,
      entry.table_name,
      entry.record_id,
      entry.field_name,
      entry.old_value,
      entry.new_value
    ].map(escape).join(";")
  );
  const blob = new Blob([[headers.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function AuditLogView() {
  const [skip, setSkip] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]["id"]>("30");
  const [acao, setAcao] = useState("");
  const [quem, setQuem] = useState("");
  const [registro, setRegistro] = useState("");

  const { isFetching, isLoading, isError, error } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log", skip],
    queryFn: async () => {
      const res = await fetch(`/api/auditoria?skip=${skip}&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar a auditoria.");
      setEntries((prev) => (skip === 0 ? data : [...prev, ...data]));
      return data as AuditEntry[];
    }
  });

  const hasMore = entries.length > 0 && entries.length % PAGE_SIZE === 0;
  const pessoas = useMemo(() => Array.from(new Set(entries.map(pessoa))).sort(), [entries]);

  const visiveis = useMemo(() => {
    const limite = periodo === "todos" ? 0 : Date.now() - Number(periodo) * 86_400_000;
    const busca = registro.trim();
    return entries.filter((entry) => {
      if (limite && new Date(entry.applied_at).getTime() < limite) return false;
      if (acao && entry.action !== acao) return false;
      if (quem && pessoa(entry) !== quem) return false;
      if (busca && !String(entry.record_id ?? "").includes(busca)) return false;
      return true;
    });
  }, [entries, periodo, acao, quem, registro]);

  const filtrosAtivos = periodo !== "30" || acao || quem || registro;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 md:p-7">
      <PageHeader
        title="Auditoria"
        description="Quem fez o quê, quando e com qual valor antes e depois."
        action={
          <Button variant="outline" className="h-11" onClick={() => downloadCsv(visiveis)} disabled={!visiveis.length}>
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Período
          <select value={periodo} onChange={(event) => setPeriodo(event.target.value as typeof periodo)} className="h-10 rounded-lg border bg-background px-2.5 text-sm text-foreground">
            {PERIODOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Pessoa
          <select value={quem} onChange={(event) => setQuem(event.target.value)} className="h-10 min-w-44 rounded-lg border bg-background px-2.5 text-sm text-foreground">
            <option value="">Todas</option>
            {pessoas.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Ação
          <select value={acao} onChange={(event) => setAcao(event.target.value)} className="h-10 rounded-lg border bg-background px-2.5 text-sm text-foreground">
            <option value="">Todas</option>
            <option value="applied">Correção aplicada</option>
            <option value="rolled_back">Correção desfeita</option>
          </select>
        </label>
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px] text-muted-foreground">
          Registro (ID)
          <span className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
            <Input value={registro} onChange={(event) => setRegistro(event.target.value)} inputMode="numeric" placeholder="Ex.: 195520" className="h-10 pl-9" />
          </span>
        </label>
        {filtrosAtivos && (
          <Button variant="ghost" className="h-10" onClick={() => { setPeriodo("30"); setAcao(""); setQuem(""); setRegistro(""); }}>
            Limpar
          </Button>
        )}
      </div>

      {isError && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          {(error as Error).message}
        </p>
      )}

      <section className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Linha do tempo</h2>
          <span className="num text-[13px] text-muted-foreground">
            {visiveis.length.toLocaleString("pt-BR")} de {entries.length.toLocaleString("pt-BR")} carregados
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : visiveis.length === 0 ? (
          <p className="flex flex-col items-center py-12 text-center text-sm text-muted-foreground">
            <ClipboardList className="mb-3 h-10 w-10 opacity-40" aria-hidden="true" />
            {entries.length === 0 ? "Nenhum registro de auditoria ainda." : "Nada encontrado com esses filtros."}
          </p>
        ) : (
          <ol className="relative ml-1.5 border-l">
            {visiveis.map((entry) => {
              const data = new Date(entry.applied_at);
              return (
                <li key={entry.id} className="relative pb-5 pl-6 last:pb-0">
                  <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${ACTION_DOTS[entry.action] ?? "bg-slate-400"}`} aria-hidden="true" />
                  <p className="num text-xs text-muted-foreground">
                    {data.toLocaleDateString("pt-BR")} · {data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="mt-0.5 text-sm">
                    <span className="font-semibold">{pessoa(entry)}</span>{" "}
                    {ACTION_VERBS[entry.action] ?? entry.action}
                    {entry.record_id && <> do registro <span className="num font-semibold">{entry.record_id}</span></>}
                  </p>
                  {entry.field_name && (
                    <p className="num mt-1 text-[13px] text-muted-foreground">
                      {entry.field_name} <span className="text-red-700 line-through">{entry.old_value ?? "vazio"}</span>
                      {" → "}
                      <span className="font-semibold text-teal-700">{entry.new_value ?? "vazio"}</span>
                      {entry.table_name && <span className="ml-2 text-xs">· {entry.table_name}</span>}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {hasMore && (
          <div className="mt-4 text-center">
            <Button variant="outline" className="h-10" onClick={() => setSkip((value) => value + PAGE_SIZE)} disabled={isFetching}>
              <ChevronDown className="h-4 w-4" />
              {isFetching ? "Carregando..." : "Carregar mais"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
