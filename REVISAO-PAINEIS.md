# Revisão dos painéis de tracoma e conjuntivite

Revisão local em 08/10/2026. Abrange as três abas de cada agravo (situação, qualidade e consulta), os indicadores compartilhados, mapas, exportações e as consultas que os alimentam.

## Tracoma

- Padronização da identificação municipal por nome ou código IBGE com seis/sete dígitos e GVE pelo cadastro territorial.
- Filtros estruturados da tela transmitidos à consulta, qualidade, demografia e taxas.
- Identificação de NOTTRACONET antes de TRACONET; retirada de fallback silencioso para outro banco.
- Séries de formas clínicas baseadas nos registros individuais, sem somar o consolidado aos mesmos casos.
- Positivos/examinados desconhecidos ficam indisponíveis, sem preenchimento com zero; pares impossíveis são bloqueados antes da agregação.
- Positividade entre exames não é chamada de prevalência populacional nem de confirmação de eliminação. Exames repetidos não são apresentados como pessoas únicas.
- Taxas por população usam denominadores do território completo. Períodos, lacunas e anos da população usada são informados.
- Idade codificada SINAN decodificada segundo quantidade e unidade, preservando dias/meses legítimos e evitando classificá-los sempre como bebês.
- Auditoria informa inconsistências documentais; não comprova ausência de atendimento nem prescreve tratamento.
- Falha na integração retorna indisponibilidade em vez de um painel preenchido com zeros.

## Conjuntivite

- Filtro de ano final, município, GVE e semana aplicado nas consultas e na completude.
- Seleção de município exata; registros marcados como excluídos removidos das leituras operacionais.
- KPIs usam semana epidemiológica de domingo a sábado, semana anterior correta na virada de ano e comparação anual até a mesma semana.
- Sincronização da base distinguida do momento de geração do indicador.
- Canal histórico preserva a diferença entre zero informado e período sem registro. Anos não são excluídos automaticamente sem justificativa da fonte.
- Histórico insuficiente impede classificar a posição frente à faixa histórica. Os rótulos descrevem a faixa, sem declarar epidemia ou sucesso de controle.
- Método da faixa divulgado: média ± 2 desvios-padrão amostrais, dez anos anteriores e mínimo operacional de cinco anos observados por período. Este mínimo é uma escolha de implementação, não uma exigência clínica da OMS.
- Contagem ausente, negativa ou fracionária invalida o grupo antes da soma do canal; valores positivos não compensam valores inválidos. A tela e a exportação informam os grupos descartados.
- Denominador regional inclui o território completo; população incompleta impede calcular a taxa correspondente.
- Ano efetivo da população substituta informado por território e na exportação. Uma análise de 2017 com população de 2024 não é rotulada como população de 2017.
- Datas MySQL preservadas como texto de origem, evitando alterações por fuso horário na interpretação de datas civis.
- Auditoria verifica todo o recorte paginado, sem pré-filtro que esconda divergências de sexo ou faixa etária; inconsistências são contadas separadamente de registros únicos.
- Exportação CSV da qualidade preserva o ano final; comparações de KPIs distinguem semana sem notificações de zero informado.
- Consultas de meses e semanas relativos respeitam as datas civis de São Paulo e a virada anual, sem ampliar a janela para o ano inteiro.

## Mapas, tabelas e estados da interface

- Valor ausente/inválido não colore o território como zero.
- Uma taxa municipal não é reutilizada como valor de outro município através do nome da GVE.
- Legendas mostram os intervalos numéricos realmente utilizados; as faixas são visuais e descritivas.
- Falha na camada geográfica fica explícita, mantendo a tabela para consulta.
- Ordenação de tabela acessível por teclado e valores ausentes ao final; tabela vazia mostra zero registros.
- Exportações de auditoria ficam indisponíveis durante atualização, erro ou recorte vazio.
- Filtros e abas ajustados para telas estreitas.

## Banco e privacidade

A migration `supabase/migrations/20261008000002_sinan_tracoma_cache_access.sql` ativa RLS e revoga acesso direto de `anon`/`authenticated` aos caches individuais, sequências e RPCs relacionadas. Os leitores e importadores continuam no servidor com `service_role`.

A migration foi preparada e validada em PostgreSQL isolado, com 31 verificações pgTAP, incluindo a preservação da importação e consulta por `service_role`. Não foi aplicada ao Supabase do projeto. O teste SQL está em `supabase/tests/sinan_tracoma_cache_access.test.sql`.

## Verificação local

- `npm test`: 15 suítes passaram, incluindo os casos de contagem ausente/inválida, datas na virada semanal/anual, filtros, população incompleta/substituta, separação de fontes e contratos dos KPIs.
- `npm run typecheck`: passou.
- ESLint com limite de zero avisos: passou; arquivos ajustados depois receberam nova verificação focada.
- `npm run build`: compilação de produção, verificação TypeScript e geração de páginas concluídas.
- Navegador local: situação e qualidade de ambos os agravos e consulta do tracoma; estados de integração indisponível, intervalo invertido e layout em 390 px e 1280 px. Os painéis não ficaram preenchidos com zeros quando as integrações falharam.
- APIs: cinco cenários de ano inválido, intervalo invertido e granularidade inválida retornaram HTTP 400 antes de consultar a base.
- Banco isolado: 31 verificações pgTAP da migration de acesso passaram.

## Limites

As alterações são locais, na branch `codex/data-reliability`, sem publicação e sem alteração de bases externas. Não há credenciais para comparar resultados com CEVESP, SINAN, REDCap ou executar os perfis reais do sistema. Testes com dados construídos validam os comportamentos corrigidos, mas não certificam os registros da fonte.

Os indicadores alterados precisam ser reconciliados com a base real antes de uso operacional. A simulação de azitromicina ainda depende de hipóteses fixas e permanece imprópria para prescrição individual. Campos agregados ambíguos exigem o dicionário da exportação real antes de serem aceitos como examinados.

Auditoria e canal agora validam registros originais em páginas, porque as RPCs antigas ocultam valores inválidos através da soma. Medir o custo dessas leituras em uma base grande e otimizar a agregação no banco, preservando as mesmas regras, depende do ambiente real. A inspeção visual cobriu estados vazios/de erro; gráficos preenchidos e perfis autenticados ainda precisam ser exercitados com dados autorizados.

## Fontes

- Dicionário oficial SINAN NET, quantidade e unidade de idade: https://portalsinan.saude.gov.br/images/documentos/Agravos/Notificacao_Individual/DIC_DADOS_NET---Notificao-Individual_rev.pdf
- Critérios OMS para eliminação: https://www.who.int/en/news-room/fact-sheets/detail/trachoma
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Permissões de funções PostgreSQL no Supabase: https://supabase.com/docs/guides/database/functions
