create table if not exists public.app_config (
  key   text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Somente admin e coordenador podem ler e escrever configuracoes
drop policy if exists "app_config_admin" on public.app_config;
create policy "app_config_admin" on public.app_config
  for all to authenticated
  using  (public.current_role() in ('admin', 'coordenador'))
  with check (public.current_role() in ('admin', 'coordenador'));

-- Valores padrao
insert into public.app_config (key, value) values
  ('ai_provider',       'openai'),
  ('openai_model',      'gpt-4.1-mini'),
  ('anthropic_model',   'claude-haiku-4-5-20251001'),
  ('gemini_model',      'gemini-3.5-flash')
on conflict (key) do nothing;
