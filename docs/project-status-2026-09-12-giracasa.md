# Status da Giracasa — 12/09/2026

## Estado executivo

A infraestrutura isolada da Giracasa está operacional, mas a operação continua
`enabled=false`, sem usuários autorizados e sem exposição no frontend. O banco,
o OAuth Olist/Tiny, o OAuth Shopee e a renovação automática do token Shopee
estão funcionando. A ativação aguarda a validação financeira e de isolamento do
conjunto completo.

## Carga Olist/Tiny de 40 dias

O coordenador residente no Supabase concluiu em 11/09/2026 às 11h39 BRT a
janela fechada de 30/07/2026 a 07/09/2026, em três blocos de até 14 dias. O
controle terminou com `status=completed`, `phase=completed`, zero falhas
consecutivas, zero problemas de itens e cobertura informada até 07/09 para
pedidos e notas.

Volumes existentes no schema `giracasa` em 12/09:

| Conjunto | Linhas |
| --- | ---: |
| Pedidos Olist | 25.899 |
| Itens de pedido Olist | 23.003 |
| Notas Olist | 23.189 |
| Itens de nota Olist | 23.501 |
| Produtos Olist | 1.068 |

Os jobs temporários de carga e aceleração se removeram depois da conclusão. O
status `completed` confirma que o coordenador percorreu todas as fases; a
liberação ainda exige conferir totais fiscais, vínculos, custos e margens nos 40
dias.

## Shopee Giracasa

A loja `984950642`, no Partner ID `2044231`, está autorizada. Access token e
refresh token existem apenas no schema `giracasa`. O canário direto de 45
minutos respondeu HTTP 200 e gravou 87 pedidos, 87 itens e 87 pacotes, sem erro
ou limite atingido.

O job `giracasa-shopee-token-refresh` é o único renovador. Ele verifica o token
a cada hora no minuto `:15`, rotaciona quando restam até 2h30 e mantém uma nova
tentativa antes do vencimento. A renovação automática de 12/09 às 07h15 BRT
terminou com sucesso, atualizou os dois tokens e estendeu o access token por
quatro horas. A execução seguinte do cron também terminou com sucesso e pulou
corretamente o token ainda válido.

O n8n participa somente do retorno OAuth por HTTP 302. Ele não lê Partner Key,
access token ou refresh token.

## Jobs ativos

O único job `giracasa-*` ativo é `giracasa-shopee-token-refresh`. Jobs de
ingestão recorrente permanecem desligados enquanto a operação estiver em
validação.

## Próximos gates

1. Fechar a conferência dos 40 dias Olist: NF válida, receita, vínculos
   NF→pedido, cobertura de itens, custos, impostos, margem e ROI.
2. Planejar e executar a carga histórica Shopee por loja, respeitando janelas e
   paginação da API, sem somar a venda novamente à receita fiscal Olist.
3. Cadastrar credenciais e contratos próprios de Mercado Livre, TikTok e demais
   fontes; valores ausentes permanecem como pendência.
4. Validar todas as páginas e permissões em preview, inclusive URL direta,
   exportação, cache alternado e usuário sem acesso.
5. Somente depois criar os crons de ingestão, conceder usuários e ativar a
   Giracasa.

## Entrega

Branch `codex/giracasa-phase1`; PR em rascunho:
`https://github.com/Grupo-Jacartta/oraculo/pull/2`. O PR não possui checks
automáticos publicados no GitHub; a validação local permanece em 74 testes
aprovados e `git diff --check` limpo.
