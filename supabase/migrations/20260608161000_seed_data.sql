insert into public.templates (title, category, content, is_public)
values
  ('Oficio de solicitacao de apoio logistico', 'oficio', 'Assunto: Solicitacao de apoio logistico\n\nSenhor(a),\n\nSolicitamos apoio para a realizacao de atividade de campo referente a {{atividade}}, no periodo de {{periodo}}, no municipio de {{municipio}}.\n\nAtenciosamente,\n{{responsavel}}', true),
  ('Convite para treinamento', 'convite', 'Prezados(as),\n\nConvidamos para o treinamento {{tema}}, a ser realizado em {{data}}, no local {{local}}.\n\nPublico-alvo: {{publico}}.\n\nConfirmar presenca ate {{prazo}}.', true),
  ('Relatorio epidemiologico sintetico', 'relatorio', '1. Contexto\n2. Objetivo\n3. Metodologia\n4. Resultados\n5. Analise epidemiologica\n6. Recomendacoes\n7. Encaminhamentos', true),
  ('E-mail de cobranca institucional', 'email', 'Assunto: Pendencia de envio - {{documento}}\n\nPrezados(as),\n\nReforcamos a necessidade de envio de {{documento}} ate {{prazo}}, para continuidade das atividades de vigilancia.\n\nAtenciosamente,', true);
