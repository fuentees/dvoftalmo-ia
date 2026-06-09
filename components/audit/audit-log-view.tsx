"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, ChevronDown } from "lucide-react";

interface AuditEntry {
  id: string;
  correction_id: string;
  action: string;
  applied_by: string;
  applied_at: string;
  applier?: { full_name: string } | null;
}

const ACTION_LABELS: Record<string, string> = {
  applied:   "Aplicada",
  reviewed:  "Revisada",
  approved:  "Aprovada",
  rejected:  "Rejeitada",
  created:   "Criada"
};

const ACTION_COLORS: Record<string, string> = {
  applied:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  reviewed: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  created:  "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
};

const PAGE_SIZE = 50;

export function AuditLogView() {
  const [skip, setSkip]       = useState(0);
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  const { isFetching, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log", skip],
    queryFn:  async () => {
      const res  = await fetch(`/api/auditoria?skip=${skip}&limit=${PAGE_SIZE}`);
      const data = await res.json() as AuditEntry[];
      setEntries(prev => skip === 0 ? data : [...prev, ...data]);
      return data;
    }
  });

  const hasMore = entries.length > 0 && entries.length % PAGE_SIZE === 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="w-6 h-6 text-teal-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Log de Auditoria</h1>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Registro de todas as ações realizadas nas correções do CEVESP.
      </p>

      {isLoading && <div className="text-center py-12 text-gray-500">Carregando registros...</div>}

      {!isLoading && entries.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Nenhum registro de auditoria encontrado.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Ação</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Correção</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Usuário</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Data/Hora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[e.action] ?? ACTION_COLORS.created}`}>
                      {ACTION_LABELS[e.action] ?? e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {e.correction_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {e.applier?.full_name ?? e.applied_by?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(e.applied_at).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="text-center">
          <button onClick={() => setSkip(s => s + PAGE_SIZE)} disabled={isFetching}
            className="flex items-center gap-2 mx-auto px-4 py-2 text-sm text-teal-600 hover:text-teal-700 font-medium disabled:opacity-50">
            <ChevronDown className="w-4 h-4" />
            {isFetching ? "Carregando..." : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
