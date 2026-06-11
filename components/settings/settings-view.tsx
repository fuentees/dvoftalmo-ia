"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Eye, EyeOff, Loader2, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Provider = "openai" | "anthropic" | "gemini";

interface Settings {
  ai_provider: Provider;
  openai_model: string;
  anthropic_model: string;
  gemini_model: string;
  openai_key_set: boolean;
  anthropic_key_set: boolean;
  gemini_key_set: boolean;
  openai_key_hint: string;
  anthropic_key_hint: string;
  gemini_key_hint: string;
}

const PROVIDERS: Array<{
  id: Provider;
  name: string;
  description: string;
  models: string[];
  color: string;
  note?: string;
}> = [
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4.1-mini — rápido e econômico. Requer créditos em platform.openai.com.",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini"],
    color: "border-green-500 bg-green-50"
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    description: "Claude Haiku/Sonnet — excelente em português técnico. Cadastro em console.anthropic.com.",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"],
    color: "border-orange-500 bg-orange-50",
    note: "Melhor qualidade em PT-BR"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Gemini 2.0 Flash — plano gratuito generoso (1.500 req/dia). Chave em aistudio.google.com.",
    models: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-pro"],
    color: "border-blue-500 bg-blue-50",
    note: "Plano gratuito disponível"
  }
];

export function SettingsView() {
  const queryClient = useQueryClient();
  const [showKeys, setShowKeys] = useState<Record<Provider, boolean>>({
    openai: false, anthropic: false, gemini: false
  });
  const [keys, setKeys] = useState<Record<Provider, string>>({
    openai: "", anthropic: "", gemini: ""
  });
  const [saved, setSaved] = useState(false);

  const settings = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Erro ao carregar configurações.");
      return res.json();
    }
  });

  const [form, setForm] = useState<Partial<Settings>>({});
  const current = { ...settings.data, ...form } as Settings;

  const save = useMutation({
    mutationFn: async () => {
      // Always send all current values so the payload is never empty
      const payload: Record<string, string> = {
        ai_provider:     current.ai_provider     ?? "openai",
        openai_model:    current.openai_model    ?? "gpt-4.1-mini",
        anthropic_model: current.anthropic_model ?? "claude-haiku-4-5-20251001",
        gemini_model:    current.gemini_model    ?? "gemini-3.5-flash"
      };
      if (keys.openai)     payload.openai_api_key    = keys.openai;
      if (keys.anthropic)  payload.anthropic_api_key = keys.anthropic;
      if (keys.gemini)     payload.gemini_api_key    = keys.gemini;

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao salvar.");
      }
    },
    onSuccess: () => {
      setSaved(true);
      setKeys({ openai: "", anthropic: "", gemini: "" });
      setForm({});
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setTimeout(() => setSaved(false), 3000);
    }
  });

  if (settings.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando configurações...
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Configurações de IA</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Escolha o provedor de inteligência artificial e gerencie as chaves de API.
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</>
          ) : saved ? (
            <><Check className="h-4 w-4" />Salvo!</>
          ) : (
            "Salvar configurações"
          )}
        </Button>
      </div>

      <div className="space-y-6 p-6">
        {settings.data && !(settings.data as Settings & { table_ready?: boolean }).table_ready && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <p className="font-semibold">Migration pendente</p>
            <p className="mt-1">Execute o SQL abaixo no <strong>Supabase SQL Editor</strong> para ativar o salvamento de configurações. Enquanto isso, as configurações do <code>.env.local</code> estão ativas.</p>
            <pre className="mt-2 overflow-x-auto rounded bg-yellow-100 p-2 text-xs font-mono">
              {`-- Cole no Supabase SQL Editor:
create table if not exists public.app_config (
  key text primary key, value text,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists "app_config_admin" on public.app_config;
create policy "app_config_admin" on public.app_config
  for all to authenticated
  using (public.current_role() in ('admin','coordenador'))
  with check (public.current_role() in ('admin','coordenador'));
insert into public.app_config (key,value) values
  ('ai_provider','gemini'),('openai_model','gpt-4.1-mini'),
  ('anthropic_model','claude-haiku-4-5-20251001'),('gemini_model','gemini-3.5-flash')
on conflict (key) do nothing;`}
            </pre>
          </div>
        )}

        {save.isError && (
          <p className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
            {(save.error as Error).message}
          </p>
        )}

        {/* Seletor de provedor */}
        <div>
          <h2 className="mb-3 text-sm font-semibold">Provedor ativo</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {PROVIDERS.map((provider) => {
              const isActive = (current.ai_provider ?? "openai") === provider.id;
              const keyIsSet =
                provider.id === "openai"    ? current.openai_key_set :
                provider.id === "anthropic" ? current.anthropic_key_set :
                current.gemini_key_set;

              return (
                <button
                  key={provider.id}
                  onClick={() => setForm((prev) => ({ ...prev, ai_provider: provider.id }))}
                  className={`rounded-xl border-2 p-4 text-left transition-all ${
                    isActive
                      ? provider.color + " ring-2 ring-offset-1 ring-primary/40"
                      : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold text-sm">{provider.name}</span>
                    {isActive && (
                      <span className="flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                        <Zap className="h-3 w-3" />
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{provider.description}</p>
                  {provider.note && (
                    <span className="mt-2 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      {provider.note}
                    </span>
                  )}
                  <div className="mt-3 flex items-center gap-1.5 text-xs">
                    <span className={`h-2 w-2 rounded-full ${keyIsSet ? "bg-green-500" : "bg-red-400"}`} />
                    <span className="text-muted-foreground">
                      {keyIsSet ? "Chave configurada" : "Chave não configurada"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Configuração por provedor */}
        <div className="grid gap-4 md:grid-cols-3">
          {PROVIDERS.map((provider) => {
            const keyHint =
              provider.id === "openai"    ? current.openai_key_hint :
              provider.id === "anthropic" ? current.anthropic_key_hint :
              current.gemini_key_hint;

            const modelKey = `${provider.id}_model` as keyof Settings;
            const currentModel = (current[modelKey] as string) ?? provider.models[0];

            return (
              <Card key={provider.id} className={`${(current.ai_provider ?? "openai") === provider.id ? "ring-2 ring-primary/30" : ""}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Bot className="h-4 w-4 text-primary" />
                    {provider.name}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {provider.id === "gemini"
                      ? "Obtenha grátis em aistudio.google.com"
                      : provider.id === "anthropic"
                      ? "Obtenha em console.anthropic.com"
                      : "Obtenha em platform.openai.com"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Chave de API</Label>
                    <div className="flex gap-1.5">
                      <Input
                        type={showKeys[provider.id] ? "text" : "password"}
                        value={keys[provider.id]}
                        onChange={(e) => setKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                        placeholder={keyHint || "Cole a chave aqui..."}
                        className="h-8 text-xs font-mono"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setShowKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                        type="button"
                      >
                        {showKeys[provider.id]
                          ? <EyeOff className="h-3.5 w-3.5" />
                          : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    {keyHint && !keys[provider.id] && (
                      <p className="text-xs text-muted-foreground">Atual: {keyHint}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Modelo</Label>
                    <select
                      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                      value={currentModel}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, [modelKey]: e.target.value }))
                      }
                    >
                      {provider.models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Info adicional */}
        <Card className="bg-muted/40">
          <CardContent className="py-4">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• As chaves de API são armazenadas de forma segura no Supabase e nunca expostas ao navegador.</li>
              <li>• Embeddings (busca semântica de documentos) sempre usam a OpenAI — mantenha a chave OpenAI mesmo usando outro provedor para chat.</li>
              <li>• O Agente COS com ferramentas (CEVESP, tracoma) funciona com OpenAI e Anthropic. No Gemini, usa modo texto sem ferramentas.</li>
              <li>• Alterações entram em vigor imediatamente após salvar (cache de 60s).</li>
              <li>• Para sincronizar os bancos CEVESP e SINAN, acesse <a href="/sincronizacao" className="underline hover:text-foreground">Sincronização</a>.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
