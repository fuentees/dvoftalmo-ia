# DvOftalmo IA

Agente inteligente independente para documentos, treinamentos, trabalho de campo, base de conhecimento e vigilancia epidemiologica.

## Stack

- Next.js 15, React 19 e TypeScript
- Tailwind CSS e componentes no estilo Shadcn/UI
- Supabase Auth, Storage, PostgreSQL, RLS e pgvector
- OpenAI API para chat, embeddings e RAG
- React Hook Form, Zod, TanStack Query e Recharts

## Modulos implementados

- Autenticacao: login, cadastro e recuperacao de senha com Supabase Auth.
- Perfis e permissoes: administrador, coordenador, supervisor e usuario.
- Dashboard: cards, graficos e atividades recentes.
- Chat IA: conversas salvas, busca, historico, agentes e respostas com fontes.
- Base de conhecimento: upload, categorias, tags, indexacao e busca semantica por pgvector.
- Agentes especializados: documentos, e-mail, treinamentos, campo e epidemiologico.
- Biblioteca documental: pesquisa, filtros, versionamento, favoritos e metadados.
- Templates: criar, listar, duplicar, copiar e usar como modelo.
- Exportacao: PDF, DOCX e TXT via rota REST.
- Banco: migrations completas com tabelas, RLS, buckets e seeds.
- Futuras integracoes: contratos preparados para sistema de gestao, Google Drive, Gmail, Calendar, REDCap e Supabase externo.

## Como rodar

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure `.env.local` com as chaves do Supabase e OpenAI.

## Banco de dados

As migrations estao em `supabase/migrations`.

Para ambiente local com Supabase CLI:

```bash
supabase start
supabase db reset
```

A migration cria:

- `profiles`
- `conversations`
- `messages`
- `documents`
- `document_versions`
- `document_chunks`
- `categories`
- `templates`
- `trainings`
- `reports`
- `files`
- `settings`
- `audit_logs`

Tambem ativa RLS e cria a RPC `match_document_chunks` para RAG.

## RAG

O fluxo de RAG fica em `services/ai`:

1. Upload em `/api/documents/upload`.
2. Extracao de texto em `document-parser.ts`.
3. Quebra em chunks.
4. Embeddings com OpenAI.
5. Armazenamento em `document_chunks`.
6. Consulta por similaridade via `match_document_chunks`.
7. Resposta no chat com fontes.

Para producao, recomenda-se mover parsing pesado de PDF/DOCX/OCR para worker assíncrono.

## Deploy Vercel

O projeto inclui `vercel.json`. Configure as variaveis:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`

## Observacoes de arquitetura

O sistema foi criado como aplicacao independente. Nenhuma integracao com sistema principal foi implementada agora. A pasta `lib/api/future-integrations.ts` deixa os adaptadores planejados para a futura camada de integracao.
