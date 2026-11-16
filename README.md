# Centro de Oftalmologia Sanitaria

Aplicacao de vigilancia em oftalmologia sanitaria com dashboards, boletins, qualidade de dados, sincronizacao CEVESP/SINAN e analises de tracoma.

## Stack

- Next.js, React 19 e TypeScript
- Tailwind CSS, TanStack Query e Recharts
- Supabase Auth, PostgreSQL, Storage, RLS e pgvector
- Integrações CEVESP, SINAN/Tracoma, IBGE/SIDRA e MySQL local

## Como Rodar

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Configure `.env.local` com Supabase e, quando necessário, credenciais MySQL/REDCap. Para desenvolvimento local, `DISABLE_AUTH=true` só funciona fora de produção.

## Variáveis Principais

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
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
- `npm run verify:panel-access` — verifica requisições sem retornar registros.
- `npm run verify:panel-access:sql` — executa fixtures PostgreSQL isoladas, com runtime externo indicado no documento técnico.

No Windows, `npm run dev:windows` inicia o servidor somente em `127.0.0.1` e usa as raízes já confiáveis do Windows para validar TLS no Node, sem desativar certificados.

## Banco

As migrations ficam em `supabase/migrations`.

```bash
supabase start
supabase db reset
```

Depois de criar/atualizar o banco, confira a tela de sincronização para validar permissões e o status das tabelas.

## Confiabilidade dos indicadores

- REDCap não configurado gera indisponibilidade explícita, sem dados fictícios.
- Registros REDCap com contagens ou anos inválidos impedem a interpretação dos indicadores.
- Cobertura não informada e quantidade de doses sem dados de origem são retornadas como `null`.
- As proporções agregadas de TF/TT não comprovam eliminação. Os critérios OMS exigem denominadores etários específicos e outros requisitos: https://www.who.int/en/news-room/fact-sheets/detail/trachoma.
- A estimativa de azitromicina é uma simulação logística com hipóteses fixas. Não fornece prescrição individual nem cálculo pediátrico validado por peso.
- Prioridades informam `partial` e `unavailableSources` quando alguma consulta falha.
- Autorização no servidor valida o usuário via Supabase Auth; falhas de validação não concedem acesso.

Veja [PAINEIS-CONFIABILIDADE.md](PAINEIS-CONFIABILIDADE.md) para os contratos e a verificação técnica dos painéis. Relatórios locais de conferência das bases não fazem parte desta publicação.
