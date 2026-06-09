"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, ChevronRight, Calendar } from "lucide-react";

interface BulletinSummary {
  id: string;
  se: number;
  ano: number;
  title: string;
  created_at: string;
}

interface BulletinDetail extends BulletinSummary {
  content: string;
}

function BulletinDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, isLoading } = useQuery<BulletinDetail>({
    queryKey: ["bulletin", id],
    queryFn:  () => fetch(`/api/boletins/${id}`).then(r => r.json())
  });

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={onBack}
        className="flex items-center gap-1 text-sm text-teal-600 hover:text-teal-700 mb-6 font-medium">
        ← Voltar aos boletins
      </button>
      {isLoading && <div className="text-center py-12 text-gray-500">Carregando boletim...</div>}
      {data && (
        <article className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Calendar className="w-4 h-4" />
            <span>SE {data.se}/{data.ano} · {new Date(data.created_at).toLocaleDateString("pt-BR")}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">{data.title}</h1>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-gray-700 dark:text-gray-300 leading-relaxed">
            {data.content}
          </div>
        </article>
      )}
    </div>
  );
}

export function BulletinsView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: bulletins = [], isLoading } = useQuery<BulletinSummary[]>({
    queryKey: ["bulletins"],
    queryFn:  () => fetch("/api/boletins").then(r => r.json())
  });

  if (selectedId) {
    return (
      <div className="p-6">
        <BulletinDetail id={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Newspaper className="w-6 h-6 text-teal-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Boletins Epidemiológicos</h1>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Boletins semanais gerados automaticamente toda segunda-feira com análise das conjuntivites no estado de SP.
      </p>

      {isLoading && <div className="text-center py-12 text-gray-500">Carregando boletins...</div>}

      {!isLoading && bulletins.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Newspaper className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Nenhum boletim publicado ainda.</p>
          <p className="text-xs mt-1">Os boletins são gerados automaticamente toda segunda-feira.</p>
        </div>
      )}

      <div className="space-y-2">
        {bulletins.map(b => (
          <button key={b.id} onClick={() => setSelectedId(b.id)}
            className="w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-sm transition-all flex items-center gap-4">
            <div className="bg-teal-50 dark:bg-teal-900/30 rounded-lg p-2.5 text-teal-700 dark:text-teal-400 text-center min-w-[52px]">
              <div className="text-xs font-medium">SE</div>
              <div className="text-lg font-bold leading-tight">{b.se}</div>
              <div className="text-xs opacity-70">{b.ano}</div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{b.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{new Date(b.created_at).toLocaleDateString("pt-BR")}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
