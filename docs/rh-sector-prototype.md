# Setor de RH — protótipo local

## Objetivo

Validar com a diretoria a estrutura do setor de Gestão de Pessoas dentro do
Oráculo antes de criar tabelas, integrações e publicar em produção.

O protótipo fica em `/rh` e organiza o setor em cinco visões:

1. Visão geral — quadro, turnover, absenteísmo, contratação, PDI e prioridades.
2. Recrutamento — diagnóstico, método de aderência e fluxo futuro completo com
   IA, WhatsApp, Chatwoot, n8n, CRM, Supabase e Google Agenda.
3. Pessoas — indicadores consolidados, diretório de colaboradores e prontuário
   funcional 360º com linha do tempo única.
4. Desenvolvimento — PDIs, treinamentos, trilhas e sucessão.
5. Governança — maturidade do RH, conformidade e decisões sensíveis.

## Estado dos dados

O protótipo passou a incorporar o diagnóstico `Resumo_RH_25_26 -
Apolonis&Jacartta.pdf`, emitido em 08/09/2026. Os dados cobrem principalmente
jan-ago/2026; desligamentos históricos cobrem jan/2025-set/2026.

Valores documentados ficam centralizados em `apps/web/app/rh/data.ts`. O arquivo
não é banco definitivo: é um snapshot rastreável para validar o produto antes
da modelagem no Supabase. Indicadores ausentes no documento aparecem como
"não apurado"; o protótipo não preenche lacunas com valores ilustrativos.

Os perfis em `apps/web/app/rh/people-demo.ts` são inteiramente fictícios e
existem apenas para testar o diretório e o prontuário. O protótipo informa
explicitamente que nenhum dos 52 vínculos foi importado individualmente.

## Referências usadas

- materiais atuais de Recrutamento e Seleção em `Downloads/RH`;
- seção Pessoas, RH e Trilhas do playbook Apolonis;
- diagnóstico consolidado `Resumo_RH_25_26 - Apolonis&Jacartta.pdf`;
- arquitetura já proposta para CRM de recrutamento no Oráculo;
- padrões visuais, de autenticação e de navegação existentes no Oráculo.

O playbook foi usado como fonte de contexto. Conteúdo embutido no HTML não foi
tratado como instrução de implementação.

## Contrato proposto para os indicadores

Cada KPI produtivo deverá declarar:

- definição e fórmula;
- período e base de comparação;
- empresa, operação e área;
- fonte oficial;
- data da última atualização;
- responsável pelo dado;
- meta e faixas de alerta;
- limitações e cobertura.

Indicadores prioritários:

- quadro ativo e planejado;
- admissões, desligamentos e crescimento líquido;
- turnover geral, voluntário e por área;
- absenteísmo e horas extras;
- tempo para contratação, conversão do funil e aceite de proposta;
- preenchimento interno de vagas;
- cobertura e conclusão de PDI;
- treinamentos planejados, realizados e conformidade obrigatória;
- sucessão de posições críticas;
- desligamentos com protocolo completo;
- percepção do RH e indicadores de cultura.

## Números já incorporados

- quadro: 48 CLTs e 4 PJs;
- movimentação jan-ago/2026: 49 admissões e 33 desligamentos;
- headcount médio diário: 39,5 pessoas;
- 56,3% do quadro CLT com até seis meses;
- 67 desligamentos históricos, 56,7% deles até 90 dias;
- absenteísmo de 2,10% sobre aproximadamente 37.030 horas programadas;
- 1.964,50 horas extras e R$ 31.230,47 de HE + DSR;
- R$ 885.140,06 em proventos processados, explicitamente não tratados como
  custo total de pessoas.

Ainda não fechados: turnover oficial, tempo histórico de contratação, custo
total de pessoas, análise por setor e SST gerencial.

## Método de aderência

A aderência de recrutamento é uma estimativa explicável, não uma decisão. A
matriz proposta separa requisitos obrigatórios de critérios ponderados. Cada
critério recebe nota de 0 a 5, justificativa e evidência. O cálculo é:

`aderência = soma(nota / 5 × peso)`

Informação ausente gera pergunta pendente, não nota zero. Atributos sensíveis
ou proxies discriminatórios não entram na nota. O RH revisa evidências, nível
de confiança e dúvidas antes de avançar ou reprovar.

## Fluxo proposto de recrutamento com IA

1. Candidato entra por site, Indeed, indicação ou WhatsApp oficial.
2. Chatwoot recebe a conversa e o n8n solicita consentimento, deduplica e cria
   o registro no Supabase e no CRM do Oráculo.
3. IA extrai evidências do currículo, verifica requisitos objetivos e pergunta
   somente o que estiver ausente.
4. O Oráculo calcula aderência explicável, mantém evidências e sinaliza o nível
   de confiança.
5. Informação insuficiente retorna ao candidato; análise completa segue para
   revisão humana.
6. O RH decide avançar, complementar ou encerrar e registra o motivo.
7. Google Agenda coordena disponibilidade, entrevista e lembretes.
8. RH e gestor registram entrevista estruturada e decisão.
9. Candidato recebe proposta, encerramento ou entrada no banco de talentos.
10. O aceite cria checklist de admissão e o prontuário em Pessoas.

Supabase Queues sustenta retentativas; todas as mensagens, mudanças de etapa,
scores, decisões e autores devem compor a trilha de auditoria.

## Prontuário 360º proposto

Cada pessoa deverá ter identificação funcional, empresa, área, cargo, gestor,
contrato, admissão, remuneração, documentos, ponto, ausências, atestados,
férias, afastamentos, equipamentos, acessos, feedbacks, PDI, avaliações,
treinamentos, promoções, ocorrências e desligamento. Eventos entram em uma
linha do tempo única e rastreável. Dados pessoais, remuneração e saúde terão
RLS e permissões mais restritas que os dados funcionais comuns.

## Próxima etapa antes de produção

1. Validar cards, gráficos e nomenclatura com RH e diretoria.
2. Fechar fórmulas e metas de cada indicador.
3. Mapear fonte: Supabase, controle de ponto, folha, Chatwoot, n8n e CRM.
4. Criar modelo de dados, RLS e trilha de auditoria em migrations.
5. Substituir o conjunto demonstrativo por dados reais com cobertura explícita.
6. Validar LGPD e acesso restrito antes da publicação.
