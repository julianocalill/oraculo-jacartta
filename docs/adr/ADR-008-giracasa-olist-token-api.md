# ADR-008: Giracasa usa o aplicativo Token API da Olist

## Status

Accepted — 08/09/2026.

## Contexto

A conta Giracasa disponibilizou o token gerado pelo aplicativo **Token API** do
ERP Olist/Tiny. Esse mecanismo pertence à API V2: o token identifica a empresa
e é enviado no corpo da requisição. O conector atual de Uberlândia usa a API V3
com Bearer/OAuth e não pode interpretar o token V2 corretamente.

## Decisão

- Uberlândia permanece no conector V3 atual.
- Giracasa terá um adaptador V2 no mesmo código de ingestão canônica.
- O secret será `GIRACASA_OLIST_API_V2_TOKEN`; ele nunca será enviado no header
  Bearer, gravado no banco de negócio ou exposto ao navegador.
- A URL base será `https://api.tiny.com.br/api2/` e as chamadas usarão `POST`
  com `token`, `formato=JSON` e paginação `pagina`.
- A primeira chamada será `info.php`. Razão social, CNPJ e UF serão conferidos
  antes de qualquer escrita para provar que o token pertence à Giracasa/SP.
- Pedidos, notas, produtos, detalhes e estoque serão normalizados para as mesmas
  tabelas canônicas do schema `giracasa`; a versão da API não altera o contrato
  financeiro.
- A amostra de um dia e a carga de 40 dias só começam depois que os adaptadores
  necessários estiverem cobertos por testes de payload e implantados.

## Consequências

A API V2 continua funcional, mas não recebe recursos novos. A Giracasa pode
iniciar com o token que já possui sem mudar o conector de Uberlândia. Se a Olist
exigir migração futura, somente o adaptador de origem será substituído; dados e
cálculos permanecem no mesmo contrato canônico.
