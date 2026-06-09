create table if not exists public.correction_queue (
  id uuid primary key default uuid_generate_v4(),
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  table_name text not null,
  record_id text not null,
  field_name text not null,
  old_value text,
  new_value text not null,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'applied')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_correction_queue_status
  on public.correction_queue(status, created_at desc);

alter table public.correction_queue enable row level security;

-- Qualquer autenticado pode propor
create policy "corrections_insert" on public.correction_queue
  for insert to authenticated
  with check (proposed_by = auth.uid());

-- Todos autenticados podem ver a fila
create policy "corrections_read" on public.correction_queue
  for select to authenticated
  using (true);

-- Só coordenador/admin pode aprovar/rejeitar/aplicar
create policy "corrections_update" on public.correction_queue
  for update to authenticated
  using (public.current_role() in ('admin', 'coordenador'))
  with check (public.current_role() in ('admin', 'coordenador'));
