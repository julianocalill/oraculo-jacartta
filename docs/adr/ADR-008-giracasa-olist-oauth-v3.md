# ADR-008: Giracasa usa aplicativo API OAuth da Olist

## Status

Accepted — 08/09/2026.

## Contexto

A tela real de cadastro da conta Giracasa confirmou que a integração escolhida
é **Aplicativo API**, com URL de redirecionamento, Client ID, Client Secret e
permissões por módulo. Esse é o contrato OAuth da API V3 já usado pelo Oráculo.
O relato inicial de “token” foi interpretado como a extensão Token API V2, mas
as evidências da configuração corrigiram essa premissa antes da carga.

## Decisão

- Giracasa usa a API V3 em um aplicativo e uma autorização próprios.
- O callback exclusivo é
  `https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/giracasa-olist-oauth-callback`.
- Client ID, Client Secret, state, refresh token e segredo do job usam somente
  variáveis `GIRACASA_*`; não existe fallback para a conta de Uberlândia.
- O callback escreve tokens apenas no schema `giracasa`.
- As permissões do aplicativo seguem privilégio mínimo de leitura para os
  módulos necessários: vendas/pedidos, produtos, notas fiscais e estoque.
- A autorização será validada antes de qualquer carga; o primeiro gate de dados
  continua sendo uma janela fechada de um dia, seguida pela carga de 40 dias.

## Consequências

O conector V3 existente pode ser reutilizado com contexto isolado da operação,
sem criar um adaptador V2 paralelo. A troca do código por tokens, a renovação e
as rotinas de sincronização permanecem independentes entre Uberlândia e
Giracasa. A identificação da empresa será conferida pelos dados retornados pela
conta antes da ativação da operação.
