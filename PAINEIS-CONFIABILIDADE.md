# Confiabilidade dos painéis

Esta versão integra os ajustes de leitura e validação à versão atual da aplicação. Mantém a navegação, os gráficos e a auditoria por grupos, a abertura no ano atual, o pré-carregamento de períodos e os boletins determinísticos. Não reintroduz provedores ou chamadas de IA.

## Contratos

- O recorte global chega diretamente às consultas. Limpar a busca da auditoria mantém ano e território do painel. A explicação de ano declarado distingue registros com ano suspeito digitados no período.
- HTTP, rede e JSON inválidos permanecem erros. Cache retido após falha não é apresentado como dado atual. Exportações ficam bloqueadas durante atualização e dados ausentes não se tornam zero.
- Consultas guardam a pergunta e os filtros usados no envio. Respostas tardias de outro recorte não são apresentadas nem exportadas como resultado da consulta atual.
- Distribuições por sexo/idade exigem contagens válidas por registro e total coerente. A RPC fornece sex_invalid_rows e age_invalid_rows; sem esses campos a validação fica explicitamente indisponível. Métricos demográficos específicos recebem a mesma proteção.
- Datas e períodos futuros não estabelecem atualização da base nem incidência observada. Ausência, zero observado e valor inválido continuam distintos.
- A leitura semanal dos boletins exige todas as páginas e respeita exclusões. Uma falha ou resposta truncada interrompe a geração. Perfis incompletos são identificados e perfis incompatíveis não são interpretados.
- Os shapefiles respeitam a codificação declarada no arquivo CPG. Indicadores sem denominador válido não recebem taxa.

## Banco e permissões

As migrations de cache, papéis, revisão de correções e validação demográfica ficam em supabase/migrations. Na primeira transição da política antiga, propostas approved exigem nova revisão; itens applied são preservados. A reaplicação da política nova não desfaz revisões legítimas posteriores. Publicar o código na Vercel não executa migrations automaticamente.

O verificador HTTP não retorna notificações ou pacientes. Uma requisição bloqueada não comprova isoladamente metadados RLS, ledger ou todas as permissões. O script SQL de inspeção em supabase/tests/panel_access_deployment.readonly.sql consulta somente metadados. Os demais testes SQL usam fixtures e não devem ser executados no banco em produção.

Para rodar os testes SQL isolados, instale @electric-sql/pglite@0.5.8 e @electric-sql/pglite-pgtap@0.0.9 em uma pasta externa; aponte PANEL_ACCESS_SQL_RUNTIME para ela e execute npm run verify:panel-access:sql. Isso não lê .env nem se conecta ao banco remoto.

## Verificação da aplicação

Execute npm ci, npm run lint -- --max-warnings=0, npm run typecheck, npm test e npm run build. Os testes incluem transporte, cache/refetch, respostas tardias, calendário, perfis demográficos, exclusões, exportação, paginação e leitura dos mapas. As fixtures contêm dados sintéticos.

Reconciliação, inventário e benchmark são rotinas opcionais que exigem uma exportação autorizada em ambiente local. Nenhuma base, credencial, relatório de dados reais ou arquivo de conferência está incluído nesta publicação. Testes de software não substituem conferência técnica da origem ou teste de usabilidade com gestores.
