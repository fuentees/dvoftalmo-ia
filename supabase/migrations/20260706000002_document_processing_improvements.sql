-- Processing status tracks async pipeline state
alter table public.documents
  add column if not exists processing_status text not null default 'done'
  check (processing_status in ('pending', 'indexing', 'done', 'failed'));

alter table public.documents
  add column if not exists processing_error text;

-- BTree index for document_id lookups (cascading deletes, per-doc queries)
create index if not exists idx_chunks_document
  on public.document_chunks (document_id);

-- Replace IVFFlat with HNSW — better recall/speed tradeoff, no cold-start issue
drop index if exists idx_chunks_embedding;
create index if not exists idx_chunks_embedding_hnsw
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
