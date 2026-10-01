# Auditoria da Separação — 01/10/2026, 07h

## Correção publicada após a auditoria

Em 01/10, o usuário confirmou que Full não pode entrar na contagem local.
Migration `20261001170138` aplicada nas RPCs públicas de seleção e hidratação,
sem reescrever a lista pronta ou enviar mensagens. Consulta às 14:31:53 BRT:
**210 pedidos / 804 unidades Full retirados** (724 Shopee + 80 Mercado Livre).
Restaram **937 pedidos / 2.577 unidades / 75 SKUs** no recálculo da janela
original. A base anterior nessa mesma consulta tinha 1.147 pedidos / 3.381
unidades, e difere do documento histórico das 7h (1.141 / 3.372).

Prévia revisada: [sem Full, com Grupo](exemplo-sem-full-com-grupos.md).
Pistola 110V passou de 13 para 1; panela 220V de 4 para 0; tapete
50×60/50un de 72 para 29 pacotes. As chaleiras continuam 103/55.
A exclusão está demonstrada; igualdade com o lote de etiquetas ainda não.
O enum Olist não foi alterado nesta correção e Grupo segue como prévia.

Reprodução: [validação SQL](validacao-sem-full.sql),
`validacao-sem-full.json` (local), `recalculo-sem-full.json` (local)
e `scripts/separation/tests/exclude-full.sql` (regressão com rollback).

Após o pedido de deploy, Grupo foi implantado como coluna congelada de novas
listas na migration `20261001175828`, na impressão/CSV e no workflow. A lista
corrigida da tarde recebeu exatamente os grupos do PDF aprovado. As prévias
abaixo registram as etapas anteriores; a conciliação com etiquetas permanece
pendente. JSONs e linhas detalhadas são artefatos locais de auditoria não
versionados; as queries SQL e os totais documentados permitem a reprodução.

## Escopo e pedido do usuário

A coluna Grupo foi aprovada como a categoria do cadastro Olist, ligada ao SKU físico após a expansão dos kits. A prévia completa está em [exemplo-grupos.md](exemplo-grupos.md), com 70 linhas classificadas e 9 sem categoria. Ainda não houve alteração do aplicativo ou publicação.

O usuário relatou divergências contra os pedidos/etiquetas impressos e entregues: chaleira branca 110V com 52 unidades a mais; pistola 110V 7; chaleira branca 220V 64; panela elétrica 220V 4; tapete 60×50 76. Apenas a primeira diferença teve sinal explícito. Está pendente confirmar se as demais são diferenças ou quantidades do lote, e qual é a fonte/lote da impressão.

## Fontes e limites

- Lista oficial `bc487592-ad7f-44e1-b629-43b5543c45b9`, slot `2026-10-01-0700`, em `public.logistica_picking_listas/itens`.
- Cursor real: 30/09 13:30:00.042 até 01/10 07:00:00.065 BRT. Cabeçalho impresso: 30/09 14h até 01/10 06h30 BRT. Esses intervalos são diferentes por construção do workflow.
- Documento persistido: 1.141 pedidos, 79 linhas, 3.372 unidades físicas, 87 caixas e 2.015 avulsas. Clique em Imprimir registrado em 01/10 às 07:08:43 BRT; não prova quais etiquetas foram impressas/entregues.
- Consulta atual da fonte feita às 13:22:03 BRT de 01/10: 1.147 pedidos, 80 linhas agregadas e 3.381 unidades. Não é uma reconstrução histórica exata do estado das 07h.
- RPC `olist_multichannel_separation_report`, expansão de kits do cadastro `olist_products`, detalhes `olist_orders`, API espelhada `shopee_orders/shopee_fulfillment_packages` e eventos `bip_fulfillment_events`.
- O Bip espelhado cobre somente Shopee. Bip Comercial é leitura/bip de etiqueta; não é comprovante universal de impressão. Ausência de bip não prova ausência de etiqueta. TikTok direto não está implantado.
- Os números de Olist/marketplace nos detalhes são identificadores operacionais. Não foram exportados compradores, CPF, endereço ou telefone.

## Achados confirmados

1. **Regra de seleção inadequada ao lote impresso:** a RPC seleciona por `first_seen_at` (entrada na base), não por impressão/entrega da etiqueta. No cabeçalho usa outro intervalo. Datas Olist sem hora não podem substituir esse evento.
2. **Full incluído:** na consulta atual, 724 unidades ligadas a pacotes Shopee com `shipping_carrier='Full'` e 80 unidades no canal Mercado Livre Fulfillment, atingindo 16 SKUs. O depósito do pedido Olist confirma Full Shopee/Full ML nos exemplos. Esses pedidos são despachados nos marketplaces; não devem ser contados como separação local de pedidos.
3. **Enum Olist errado:** `dim_order_status` marca 8 como cancelado e 2 como não cancelado. A [documentação oficial API v3](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos) define **2 = Cancelada**, **8 = Dados Incompletos**, 0 = Aberta, 1 = Faturada, 7 = Pronto Envio, 5 = Enviada. A RPC herda o erro e não exclui cancelados 2. Na consulta atual há 41 pedidos/412 unidades de código 2 dentro da seleção. Não se conhece o status histórico desses pedidos às 07h.
4. **Não pagos Shopee:** a consulta atual contém 222 unidades com `UNPAID`, além de 316 com `CANCELLED/IN_CANCEL`. Parte se sobrepõe a Full e cancelamentos Olist; não somar essas categorias para calcular o excesso.
5. **Fonte mutável:** cinco SKUs diferem do documento congelado no recálculo atual. A lista não persiste IDs de pedidos/linhas incluídos nem estados de elegibilidade; portanto igualdade entre tela/CSV/WhatsApp garante igualdade de apresentação, não conciliação com o lote de etiquetas.

## Produtos informados

Os números de Full e cancelamento abaixo vêm da consulta atual vinculada à janela original; as quantidades no papel são congeladas.

| SKU | Produto | No papel (unidades) | Full Shopee | Canceladas Olist hoje |
|---|---|---:|---:|---:|
| 213859 | Chaleira branca 110V | 103 | 0 | 6 |
| 214028 | Pistola 110V | 13 | 12 | 0 |
| 213861 | Chaleira branca 220V | 55 | 0 | 1 |
| 214163 | Panela elétrica 220V | 4 | 4 | 1 |
| 213169 | Tapete Espaço de Bicho 50×60, pacote 50 un | 72 | 43 | 1 |

O tapete 50×60 também existe em pacote de 30 unidades, SKU `213168`, com 15 pacotes no papel. Confirmar qual variação o usuário comparou.

As quatro panelas são Full. Doze das treze pistolas são Full. As chaleiras não foram explicadas por Full; retirar cancelamentos conhecidos ainda não demonstra a diferença relatada de 52. O documento contém 55 chaleiras 220V e 72 pacotes de tapete 50×60/50un, portanto os números relatados de 64 e 76 precisam de definição antes de concluir excessos.

## O que precisa mudar para a conciliação ficar demonstrável

- Usar o lote real de etiquetas/pedidos entregue ao depósito como conjunto de entrada, com identificador de lote e deduplicação de pedido/pacote. Pagamento e venda não equivalem a impressão.
- Excluir expedição externa Full e corrigir os estados da API v3 dentro do contrato operacional. Auditar o impacto global do enum antes de alterar a dimensão compartilhada por métricas fiscais.
- Persistir a linhagem por pedido/item/SKU físico, multiplicador do kit e elegibilidade na mesma fotografia do documento.
- Congelar Grupo por SKU físico na geração; mostrar Sem grupo no cadastro quando não houver correspondência inequívoca.
- Conferir a igualdade por SKU físico e número de pedido entre lote, lista e etiquetas; só então publicar a nova regra.
- Preservar listas prontas/cursor/WhatsApp. A auditoria foi somente leitura, sem reenvio, recálculo persistido ou correção arbitrária por subtração.

## Arquivos de reprodução

- [audit.sql](audit.sql): query somente leitura, derivada da regra de kits publicada; resultados dependem do estado atual.
- `snapshot-original.json` (local): 79 linhas congeladas, com categorias atuais apenas para a prévia.
- `source-lines.json` (local): 1.317 linhas físicas da consulta atual, 1.147 pedidos.
- `sku-summary.json` (local): agregações e categorias sobrepostas.
- [exemplo-grupos.md](exemplo-grupos.md): prévia das 79 linhas com Grupo; não é documento operacional corrigido.
