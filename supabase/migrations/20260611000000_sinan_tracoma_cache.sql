create table if not exists public.sinan_tracoma_rows (
  id bigserial primary key,
  row_key text unique not null,
  source_bank text not null check (source_bank in ('traconet', 'nottraconet')),
  agravo text,
  ano int,
  dt_notificacao date,
  municipio text,
  ibge text,
  gve text,
  drs text,
  unidade text,
  classificacao text,
  criterio text,
  evolucao text,
  tratamento text,
  conclusao text,
  raw jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

create index if not exists idx_sinan_tracoma_bank on public.sinan_tracoma_rows (source_bank);
create index if not exists idx_sinan_tracoma_agravo on public.sinan_tracoma_rows (agravo);
create index if not exists idx_sinan_tracoma_ano on public.sinan_tracoma_rows (ano);
create index if not exists idx_sinan_tracoma_dt on public.sinan_tracoma_rows (dt_notificacao);
create index if not exists idx_sinan_tracoma_munic on public.sinan_tracoma_rows (municipio);
create index if not exists idx_sinan_tracoma_gve on public.sinan_tracoma_rows (gve);
create index if not exists idx_sinan_tracoma_drs on public.sinan_tracoma_rows (drs);
create index if not exists idx_sinan_tracoma_raw_gin on public.sinan_tracoma_rows using gin (raw);

alter table public.sinan_tracoma_rows disable row level security;

create table if not exists public.sinan_tracoma_import_log (
  id bigserial primary key,
  import_id text,
  source_bank text not null check (source_bank in ('traconet', 'nottraconet')),
  rows_upserted int not null default 0,
  imported_at timestamptz not null default now(),
  notes text
);

alter table public.sinan_tracoma_import_log disable row level security;
