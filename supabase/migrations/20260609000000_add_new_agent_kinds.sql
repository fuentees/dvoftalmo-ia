-- Extend agent_kind enum with new values
alter type public.agent_kind add value if not exists 'tracoma';
alter type public.agent_kind add value if not exists 'dados';
alter type public.agent_kind add value if not exists 'cos';

-- Table for Victor's personal writing-style corpus
create table if not exists public.victor_style_documents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  content text not null,
  document_type text not null default 'geral',
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists idx_victor_style_user
  on public.victor_style_documents(user_id, created_at desc);

create index if not exists idx_victor_style_embedding
  on public.victor_style_documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

alter table public.victor_style_documents enable row level security;

drop policy if exists "victor_style_owner_all" on public.victor_style_documents;
create policy "victor_style_owner_all"
  on public.victor_style_documents
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- RPC: semantic search over Victor's style examples
create or replace function public.match_victor_style(
  query_embedding vector(1536),
  match_count int,
  current_user_id uuid
)
returns table (
  id uuid,
  title text,
  content text,
  document_type text,
  similarity float
)
language sql
stable
as $$
  select
    vsd.id,
    vsd.title,
    vsd.content,
    vsd.document_type,
    1 - (vsd.embedding <=> query_embedding) as similarity
  from public.victor_style_documents vsd
  where vsd.user_id = current_user_id
    and vsd.embedding is not null
  order by vsd.embedding <=> query_embedding
  limit match_count;
$$;
