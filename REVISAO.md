# Revisão de confiabilidade — 08/10/2026

## Correções

- Dependências: arquivo de lock corrigido para instalação reproduzível.
- CI: ESLint executado pelo comando atual, sem ignorar falhas; testes de dados incluídos.
- Autenticação: identidade validada por `getUser`, sem autorizar pela sessão extraída de cookies.
- REDCap: IDs enviados individualmente; respostas inválidas não viram listas vazias.
- Tracoma: sem dados fictícios na ausência de integração; anos e contagens validados; sem preenchimento automático de cobertura, doses ou ano atual.
- Chat: proporções agregadas não são rotuladas como eliminação de tracoma.
- Simulação de azitromicina: valores fora de faixa rejeitados, JSON inválido retorna 400 e cálculo não é apresentado como diretriz clínica validada.
- Indicadores: valores negativos, não finitos ou positivos acima de examinados não geram taxas plausíveis.
- Dashboard: ano mais recente identificado independentemente da ordem; sem mistura entre casos anuais e registros de todos os anos.
- Dashboard: falhas em alertas, canal e prioridades ficam explícitas; atualização inclui canal endêmico; falhas no reconhecimento de alertas são exibidas.
- Prioridades: fontes que falharam são informadas, preservando resultados disponíveis.

## Validação necessária com o ambiente real

Esta revisão não certifica toda a aplicação nem a exatidão da base original. Nenhuma alteração foi publicada ou migration aplicada a banco externo.

Sem credenciais, não é possível reconciliar os indicadores com CEVESP, SINAN, REDCap e Supabase, verificar políticas RLS em execução ou exercer todos os fluxos autenticados.

Antes de uso operacional, verificar contagens por período e território contra as fontes, duplicidades e exclusões, denominadores por faixa etária, atualização populacional, migrações e perfis de acesso. As correções no REDCap podem expor registros que anteriormente eram descartados ou preenchidos automaticamente; tais registros precisam de revisão na origem.

A simulação de comprimidos ainda usa hipóteses fixas de população infantil e comprimidos por pessoa. Substituí-la por um modelo aprovado com dados de peso, formulação e protocolo é necessário para qualquer uso clínico.

## Verificação local da primeira rodada

A revisão posterior dos painéis, com testes adicionais e inspeção visual, está registrada em [REVISAO-PAINEIS.md](REVISAO-PAINEIS.md).

- `npm test`: sete suítes existentes e duas novas suítes de REDCap/autenticação passaram.
- `npm run typecheck`: passou.
- ESLint com limite de zero avisos: passou.
- `npm run build`: compilação de produção e geração de páginas concluídas.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund`: passou após atualização do lock; não equivale a reinstalação completa em ambiente limpo.
- Não houve teste visual interativo nem validação de integrações em produção.
- O Node local 22.12 emitiu aviso de versão para uma dependência do ESLint. Usar Node 22.13 ou superior na linha 22 evita esse aviso.

## Referências

- Critérios de eliminação de tracoma: https://www.who.int/en/news-room/fact-sheets/detail/trachoma
- Validação de identidade no servidor: https://supabase.com/docs/guides/auth/server-side/creating-a-client
