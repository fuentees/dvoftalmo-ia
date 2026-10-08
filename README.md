# Centro de Oftalmologia Sanitaria

Aplicacao de vigilancia em oftalmologia sanitaria com dashboards, chat com IA, boletins, qualidade de dados, sincronizacao CEVESP/SINAN e analises de tracoma.

## Stack

- Next.js, React 19 e TypeScript
- Tailwind CSS, TanStack Query e Recharts
- Supabase Auth, PostgreSQL, Storage, RLS e pgvector
- OpenAI, Anthropic ou Gemini para chat; OpenAI para embeddings
- Integrações CEVESP, SINAN/Tracoma, IBGE/SIDRA e MySQL local

## Como Rodar

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Configure `.env.local` com Supabase, chaves de IA e, quando necessário, credenciais MySQL/REDCap. Para desenvolvimento local, `DISABLE_AUTH=true` só funciona fora de produção.

## Variáveis Principais

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `NOTIFY_DB_HOST`, `NOTIFY_DB_PORT`, `NOTIFY_DB_NAME`, `NOTIFY_DB_USER`, `NOTIFY_DB_PASSWORD`, `NOTIFY_DB_TABLE`
- `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFY_EMAIL`
- `REDCAP_API_URL`, `REDCAP_API_TOKEN`, `REDCAP_TRACOMA_FORM`

## Permissões

- `admin`: gerencia usuários, configurações, sincronizações e relatórios.
- `coordenador`: gerencia configurações, sincronizações e relatórios.
- `supervisor`: executa sincronizações e rotinas de base.
- `usuario`: consulta dados e usa as áreas operacionais permitidas.

As rotas sensíveis fazem validação no servidor; a interface apenas espelha essas permissões.

## Rotinas

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Scripts úteis:

- `npm run sync-cevesp`
- `npm run sync-export`
- `npm run sync-import`
- `npm run sync-ibge-population`

## Banco

As migrations ficam em `supabase/migrations`.

```bash
supabase start
supabase db reset
```

Depois de criar/atualizar o banco, confira a tela de sincronização e a tela de configurações para validar permissões, modelos e status das tabelas.

## Confiabilidade dos indicadores

- REDCap não configurado gera indisponibilidade explícita, sem dados fictícios.
- Registros REDCap com contagens ou anos inválidos impedem a interpretação dos indicadores.
- Cobertura não informada e quantidade de doses sem dados de origem são retornadas como `null`.
- As proporções agregadas de TF/TT não comprovam eliminação. Os critérios OMS exigem denominadores etários específicos e outros requisitos: https://www.who.int/en/news-room/fact-sheets/detail/trachoma.
- A estimativa de azitromicina é uma simulação logística com hipóteses fixas. Não fornece prescrição individual nem cálculo pediátrico validado por peso.
- Prioridades informam `partial` e `unavailableSources` quando alguma consulta falha.
- Autorização no servidor valida o usuário via Supabase Auth; falhas de validação não concedem acesso.

Veja [REVISAO-PAINEIS.md](REVISAO-PAINEIS.md) para a revisão de tracoma/conjuntivite, testes e pendências da base real. [REVISAO.md](REVISAO.md) registra a primeira rodada de confiabilidade e integrações.
