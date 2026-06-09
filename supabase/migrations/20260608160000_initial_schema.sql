create extension if not exists "uuid-ossp";
create extension if not exists vector;

create type public.user_role as enum ('admin', 'coordenador', 'supervisor', 'usuario');
create type public.document_category as enum (
  'tracoma',
  'conjuntivite',
  'treinamentos',
  'relatorios',
  'manuais',
  'oficios',
  'despachos',
  'legislacao',
  'outros'
);
create type public.agent_kind as enum ('documentos', 'email', 'treinamentos', 'campo', 'epidemiologico', 'geral');
create type public.template_category as enum ('oficio', 'despacho', 'relatorio', 'email', 'convite', 'memorando');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.user_role not null default 'usuario',
  department text,
  phone text,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  slug text not null unique,
  kind public.document_category not null,
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Nova conversa',
  agent public.agent_kind not null default 'geral',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category public.document_category not null default 'outros',
  description text,
  tags text[] not null default '{}',
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  version integer not null default 1,
  favorite boolean not null default false,
  indexed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_versions (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version integer not null,
  file_path text,
  change_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(document_id, version)
);

create table public.document_chunks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  token_count integer,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  file_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  extracted_text text,
  created_at timestamptz not null default now()
);

create table public.templates (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid references public.profiles(id) on delete set null,
  title text not null,
  category public.template_category not null,
  content text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trainings (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  participants jsonb not null default '[]'::jsonb,
  materials jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  status text not null default 'planejado',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  type text not null,
  content text not null,
  indicators jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.settings (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_conversations_user on public.conversations(user_id, updated_at desc);
create index idx_messages_conversation on public.messages(conversation_id, created_at);
create index idx_documents_owner on public.documents(owner_id, updated_at desc);
create index idx_documents_category on public.documents(category);
create index idx_documents_tags on public.documents using gin(tags);
create index idx_chunks_embedding on public.document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'usuario')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.current_role()
returns public.user_role
language sql
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_count int,
  min_similarity float,
  current_user_id uuid
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  category public.document_category,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    dc.id,
    d.id,
    d.title,
    d.category,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where dc.embedding is not null
    and (dc.owner_id = current_user_id or public.current_role() in ('admin', 'coordenador', 'supervisor'))
    and 1 - (dc.embedding <=> query_embedding) >= min_similarity
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.files enable row level security;
alter table public.templates enable row level security;
alter table public.trainings enable row level security;
alter table public.reports enable row level security;
alter table public.settings enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_self_read" on public.profiles for select using (id = auth.uid() or public.current_role() = 'admin');
create policy "profiles_self_update" on public.profiles for update using (id = auth.uid() or public.current_role() = 'admin');

create policy "categories_authenticated_read" on public.categories for select to authenticated using (true);
create policy "categories_admin_write" on public.categories for all to authenticated using (public.current_role() = 'admin');

create policy "conversations_owner_all" on public.conversations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "messages_owner_all" on public.messages for all to authenticated using (
  exists(select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
) with check (
  exists(select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
);

create policy "documents_owner_or_staff_read" on public.documents for select to authenticated using (
  owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador', 'supervisor')
);
create policy "documents_owner_insert" on public.documents for insert to authenticated with check (owner_id = auth.uid());
create policy "documents_owner_or_staff_update" on public.documents for update to authenticated using (
  owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador', 'supervisor')
);
create policy "documents_owner_or_admin_delete" on public.documents for delete to authenticated using (
  owner_id = auth.uid() or public.current_role() = 'admin'
);

create policy "chunks_read" on public.document_chunks for select to authenticated using (
  owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador', 'supervisor')
);
create policy "chunks_owner_all" on public.document_chunks for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "versions_document_read" on public.document_versions for select to authenticated using (
  exists(select 1 from public.documents d where d.id = document_id and (d.owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador', 'supervisor')))
);

create policy "files_owner_all" on public.files for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "templates_read" on public.templates for select to authenticated using (is_public or owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador'));
create policy "templates_owner_all" on public.templates for all to authenticated using (owner_id = auth.uid() or public.current_role() = 'admin') with check (owner_id = auth.uid() or public.current_role() = 'admin');
create policy "trainings_staff_all" on public.trainings for all to authenticated using (owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador', 'supervisor')) with check (owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador', 'supervisor'));
create policy "reports_owner_or_staff" on public.reports for all to authenticated using (owner_id = auth.uid() or public.current_role() in ('admin', 'coordenador', 'supervisor')) with check (owner_id = auth.uid());
create policy "settings_admin_all" on public.settings for all to authenticated using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create policy "logs_admin_read" on public.audit_logs for select to authenticated using (public.current_role() = 'admin');

insert into public.categories (name, slug, kind) values
  ('Tracoma', 'tracoma', 'tracoma'),
  ('Conjuntivite', 'conjuntivite', 'conjuntivite'),
  ('Treinamentos', 'treinamentos', 'treinamentos'),
  ('Relatorios', 'relatorios', 'relatorios'),
  ('Manuais', 'manuais', 'manuais'),
  ('Oficios', 'oficios', 'oficios'),
  ('Despachos', 'despachos', 'despachos'),
  ('Legislacao', 'legislacao', 'legislacao'),
  ('Outros', 'outros', 'outros')
on conflict do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 52428800, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg'
  ])
on conflict (id) do nothing;
