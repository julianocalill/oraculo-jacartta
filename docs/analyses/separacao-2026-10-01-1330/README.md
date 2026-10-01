# Lista da tarde — 01/10/2026, 13h30

Usuário pediu a lista pronta com dados desta tarde, mantendo Full excluído e
Grupo conforme categoria do SKU físico Olist. Foi usada a janela do fechamento
official de 13h30 (07:00:00.065–13:30:00.050 BRT).

- Lista original: `9bf2b733-f228-4de6-b9b5-705b946866f3`, preservada.
- Nova lista personalizada pronta: `46ddb552-791a-4b50-a7e3-a6c11784f115`.
- Worker existente, `sync_orders=false`, `advance_cursor=false`,
  `send_whatsapp=false`; geração em 01/10 às 14:42:56 BRT.
- Total: **537 pedidos, 1.518 unidades a separar, 57 linhas, 29 caixas e
  960 unidades avulsas**; zero pedidos sem itens.
- Consulta independente às 14:45:49 BRT: fonte sem filtro Full tinha
  636 pedidos / 1.693 unidades; 99 pedidos / 175 unidades Full excluídos,
  restando os mesmos 537 / 1.518. Nenhum Full identificado pela logística
  Shopee/canal ML escapou do predicado. A fonte atual difere do documento
  original das 13h30 (633 pedidos / 1.685 unidades).
- PDF entregue: `output/pdf/lista-separacao-2026-10-01-tarde-sem-full-grupos.pdf`.
  Grupo foi consultado por SKU + operação e congelado neste PDF/JSON local;
  após o pedido de deploy, os mesmos 57 grupos foram gravados em product_group
  na lista existente; as quantidades foram preservadas. A migration passa a
  congelar o grupo das novas listas, e impressão/CSV leem esse campo.
- Snapshot usado no PDF:
  `output/pdf/separacao-2026-10-01-tarde-dados.json` (sem compradores/endereços).
- PDF A4 com duas páginas: todos os SKUs presentes, soma das linhas conferida
  com o cabeçalho, duas páginas renderizadas e inspecionadas visualmente.

A seleção continua pela entrada do pedido no ERP. Não foi demonstrada igualdade
com o lote de etiquetas entregue, e o enum de cancelamento Olist permanece
pendente conforme a auditoria da manhã. Essa limitação está no PDF. Artefatos
locais em output/ são ignorados pelo Git; a lista pronta permanece no banco.
