# ADR-007: Full inbound é um fluxo próprio e orientado por revisões

## Status

Accepted

## Contexto

Reposições para Mercado Livre Full, Shopee FBS e Amazon Onsite começam antes da
remessa existir no marketplace. Elas exigem escolha do anúncio, confirmação do
produto físico, produção, negociação de coleta e depois acompanhamento externo.
O funil `/expedicao` resolve outro problema: pedidos vendidos saindo para o
cliente. A sugestão semanal antiga da Agenda tampouco registrava uma remessa
real ou suas aprovações.

## Decisão

- `/full` é a fonte de verdade do processo inbound; a Agenda só materializa
  prazos e trocas de responsabilidade.
- Fluxo, produção e estado externo são dimensões independentes.
- Cada alteração material cria uma revisão. A versão enviada à logística fica
  congelada, e anúncio, produto físico e expansão de kit são fotografados.
- O criador escolhe explicitamente o aprovador de cada Full. A logística propõe
  a data; o aprovador aceita ou solicita outra; o criador mantém a responsabilidade
  de criar e registrar a remessa no marketplace.
- A necessidade de produção é consolidada por SKU físico. Revisões preservam o
  progresso já registrado e mostram a necessidade atual.
- Coleta e recebimento avançam somente por evento de API associado ao código da
  remessa. Saldo agregado de estoque não é evidência.
- Escritas ficam em Server Actions com `service_role`; leitura usa RLS por
  participante e a permissão operacional `full_manager`.
- O bucket `full-documents` é privado. Uma rota autenticada valida a participação
  antes de emitir URL assinada por 60 segundos.
- A primeira implantação pertence apenas à operação Uberlândia. Giracasa não
  compartilha tabelas nem permissões desse módulo.

## Consequências

- O fluxo mantém auditoria integral mesmo quando uma data ou composição muda.
- Não existe botão manual para simular coleta ou recebimento.
- Os adapters dos marketplaces podem evoluir por trás de um contrato único sem
  alterar a máquina operacional.
- O catálogo habilitado libera o fluxo humano até o agendamento. A validação de
  detecção de coleta e recebimento por item controla apenas o monitoramento
  automático, depois de uma remessa real comprovada.
- O planejador semanal legado deixa de gerar tarefas, mas suas tabelas e runs
  continuam preservadas para auditoria.
