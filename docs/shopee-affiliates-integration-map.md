# Mapa técnico — Shopee Afiliados

Data do levantamento: 2026-07-27  
Escopo: Sprint 1 do projeto Mozão Pet  
Modo de investigação: somente leitura

## Resumo executivo

O Oráculo possui uma integração Shopee madura para quatro lojas: Donacor,
Espaço De Bicho, Jacartta e Oliverhome. A integração atual cobre:

- pedidos e itens;
- dados financeiros de escrow;
- produtos e variações;
- estoque local;
- estoque FBS/SBS;
- séries diárias e agregados de produto;
- jobs e histórico de sincronização.

O banco contém 90.864 pedidos, 92.312 linhas de item e 35.064 registros de
escrow no retrato consultado em 2026-07-27. O período de pedidos encontrado vai
de 2026-05-31 a 2026-07-27.

Entretanto, a integração atual não consulta o módulo Shopee AMS e não armazena
identidade de afiliado, username, perfil, conteúdo, live, vídeo, clique,
conversão ou atribuição. Por isso, os dados atuais não permitem calcular
performance, recorrência ou ranking por afiliado.

Uma sonda real e mínima de `get_conversion_report` foi executada em 2026-07-27
para cada uma das quatro lojas. Todos os partner apps responderam HTTP 403,
`error_api_permission`, com a mensagem de que o tipo do app não possui
permissão para a API. Nenhum registro AMS foi retornado.

Os payloads reais de escrow contêm campos AMS financeiros
(`order_ams_commission_fee`, `ams_commission_fee`, `activity_id` e
`activity_type`). Foram encontrados 7.151 pedidos com comissão AMS diferente
de zero, somando R$ 25.629,91. Esses campos identificam custo/atividade AMS por
pedido e item, mas não identificam o afiliado. `activity_type` apareceu como
tipos promocionais, principalmente `flash_sale`, e não deve ser tratado como
tipo de afiliado.

Existe outro projeto local, `/Users/julianocalil/shopee-afiliados-fiscal`
(Afiliou), que documenta o módulo oficial AMS e possui um gerador de URL
assinada, mas a integração real ainda não foi ativada. A documentação local
indica a permissão `Affiliate Marketing Solution Management`. A sonda desta
sprint confirmou que os partner apps atuais do Oráculo não podem usar o
endpoint.

## Regras de segurança observadas

- Nenhuma credencial foi exibida ou alterada.
- Nenhum token foi renovado manualmente.
- Nenhuma chamada à API Shopee foi feita durante o mapeamento.
- Após o relatório inicial, foram feitas quatro sondas AMS de uma página e uma
  linha, uma por partner app, exclusivamente para validar permissão.
- Nenhuma tabela foi modificada.
- Nenhum fluxo, job ou arquivo existente foi alterado.
- Nenhum dado foi enviado a serviço externo.
- Identificadores internos das lojas não são registrados neste documento.

## Lojas configuradas

| Loja | Ativa | Partner app próprio | Token presente | Pedidos | Período de pedidos | Escrow | Produtos/modelos |
|---|---:|---:|---:|---:|---|---:|---:|
| Donacor | sim | sim | sim | 39.262 | 2026-06-01 a 2026-07-27 | 9.184 | 1.067 |
| Espaço De Bicho | sim | sim | sim | 14.604 | 2026-06-06 a 2026-07-27 | 9.674 | 1.306 |
| Jacartta | sim | sim | sim | 15.553 | 2026-05-31 a 2026-07-27 | 7.743 | 1.185 |
| Oliverhome | sim | sim | sim | 21.445 | 2026-06-08 a 2026-07-27 | 8.463 | 330 |

Cada loja usa seu próprio partner app e deve assinar as requisições com a chave
correspondente. A mistura entre app e loja pode resultar em
`invalid_access_token`, mesmo quando o token ainda é válido.

## Configuração e autenticação

### Variáveis locais encontradas

Somente os nomes foram inspecionados:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_ANON_KEY`

As credenciais Shopee não ficam no `.env` do Oráculo. Elas estão em tabelas
protegidas do Supabase:

- `shopee_app_config`
- `shopee_shops`
- `shopee_tokens`

Essas tabelas são acessíveis apenas por `service_role`, com exceção da leitura
controlada dos nomes das lojas por usuários autenticados.

### Assinatura

O código existente usa HMAC-SHA256.

Assinatura pública para obter/renovar token:

```text
partner_id + path + timestamp
```

Assinatura de endpoint de loja:

```text
partner_id + path + timestamp + access_token + shop_id
```

### Regra crítica de token

`shopee-sync` é o único renovador do token. As funções de escrow, produtos e
SBS apenas leem o token e adiam a execução quando ele está perto de expirar.
Qualquer extrator de afiliados deve seguir a mesma regra e nunca renovar o
token.

## Arquivos encontrados

### Integração principal

- `supabase/functions/shopee-sync/index.ts`
  - renovação exclusiva de token;
  - pedidos e detalhes;
  - paginação por cursor;
  - upsert idempotente de pedidos e itens.
- `supabase/functions/shopee-escrow-sync/index.ts`
  - escrow financeiro por pedido concluído;
  - comissão da plataforma, taxas, vouchers, líquido e itens;
  - não renova token.
- `supabase/functions/shopee-sync-products/index.ts`
  - produtos, detalhes, modelos e estoque local;
  - paginação por offset;
  - não renova token.
- `supabase/functions/shopee-sync-sbs/index.ts`
  - inventário FBS/SBS;
  - paginação por número de página;
  - não renova token.
- `scripts/import-shopee-donacor.js`
  - integração histórica via n8n;
  - criação/invocação de workflows de produtos e pedidos;
  - não é o caminho canônico atual.
- `tmp/export-shopee-active-promotions.mjs`
  - exportador temporário de promoções ativas e metadados de produto;
  - lê `video_info` do anúncio, não desempenho de vídeo ou afiliado.
- `tmp/probe-shopee-fbs.mjs`
  - sonda de disponibilidade FBS/SBS.

### Aplicação

- `apps/web/app/shopee/data.ts`
- `apps/web/app/shopee/page.tsx`
- `apps/web/app/shopee/estoque/build-estoque.ts`
- `apps/web/app/shopee/reposicao/build-suggestions.ts`
- rotas de exportação em `apps/web/app/shopee/**/export/route.ts`

### Documentação

- `docs/runbooks/shopee-sync-oraculo.md`
- `docs/deployment-map.md`
- `docs/project-status-2026-07-17.md`
- `vault/05-integrations/shopee.md`
- `vault/04-data/canonical-data-model.md`

### Migrations Shopee

- `20260619174642_create_shopee_donacor_sync.sql`
- `20260713140000_create_shopee_credentials.sql`
- `20260713160000_schedule_shopee_sync.sql`
- `20260713200000_create_shopee_order_escrow.sql`
- `20260713203000_shopee_brt_bucketing_and_coverage.sql`
- `20260713205000_schedule_shopee_escrow_sync.sql`
- `20260713210000_shopee_take_rate_views.sql`
- `20260716220000_create_shopee_analytics.sql`
- `20260716230000_schedule_shopee_analytics.sql`
- `20260716250000_shopee_shops_authenticated_read.sql`
- `20260721140000_shopee_take_rate_timeout_fix.sql`
- `20260722120000_shopee_take_rate_cache.sql`

### Postman, OpenAPI e testes

- Não foi encontrada coleção Postman da Shopee.
- Não foi encontrado arquivo OpenAPI/Swagger da Shopee.
- Não foram encontrados testes automatizados específicos da integração Shopee.
- O comando geral `pnpm test` cobre atualmente apenas o domínio fiscal.

## Endpoints realmente implementados no Oráculo

| Endpoint | Uso | Paginação/limite observado |
|---|---|---|
| `/api/v2/auth/access_token/get` | renovação exclusiva pelo `shopee-sync` | por loja |
| `/api/v2/order/get_order_list` | lista pedidos por `update_time` | cursor, página 50 |
| `/api/v2/order/get_order_detail` | detalhe de pedidos | lote de até 50 |
| `/api/v2/payment/get_escrow_detail` | financeiro por pedido concluído | uma chamada por pedido, lote lógico 80 |
| `/api/v2/product/get_item_list` | lista produtos | offset, página 100 |
| `/api/v2/product/get_item_base_info` | detalhe de produto | lote de 50 |
| `/api/v2/product/get_model_list` | variações | uma chamada por item com modelo |
| `/api/v2/product/get_item_promotion` | promoção ativa, script temporário | lotes locais |
| `/api/v2/product/get_category` | categorias, script temporário | consulta de catálogo |
| `/api/v2/sbs/get_current_inventory` | inventário FBS | página 100, teto local 50 páginas |
| `/api/v2/fbs/query_br_shop_enrollment_status` | sonda de adesão FBS | sonda local |
| `/api/v2/sbs/get_bound_whs_info` | armazéns FBS vinculados | sonda local |

Nenhum endpoint `/api/v2/ams/*` é chamado pelo Oráculo.

## Endpoints AMS documentados localmente

Fonte local: `/Users/julianocalil/shopee-afiliados-fiscal/docs/02-api-shopee-ams.md`.

- `/api/v2/ams/get_conversion_report`
- `/api/v2/ams/get_affiliate_performance`
- `/api/v2/ams/get_product_performance`
- `/api/v2/ams/get_shop_performance`
- `/api/v2/ams/get_managed_affiliate_list`
- `/api/v2/ams/get_recommended_affiliate_list`
- `/api/v2/ams/query_affiliate_list`
- `/api/v2/ams/get_performance_data_update_time`

### Validação real de permissão

| Loja | Endpoint | Resultado |
|---|---|---|
| Donacor | `get_conversion_report` | HTTP 403 — `error_api_permission` |
| Espaço De Bicho | `get_conversion_report` | HTTP 403 — `error_api_permission` |
| Jacartta | `get_conversion_report` | HTTP 403 — `error_api_permission` |
| Oliverhome | `get_conversion_report` | HTTP 403 — `error_api_permission` |

Condições da sonda:

- uma chamada por loja;
- janela de uma hora;
- página 1;
- `page_size=1`;
- token apenas lido do Supabase;
- nenhuma renovação;
- URL assinada, token, chave e identificadores não foram registrados.

Como o endpoint principal está bloqueado pelo tipo/permissão dos quatro apps,
os endpoints AMS auxiliares também devem permanecer classificados como não
confirmados e não devem ser chamados em volume.

Limites registrados na documentação local para `get_conversion_report`:

- `page_size` máximo de 500;
- `page_no * page_size` menor ou igual a 10.000;
- janela máxima de consulta de três meses.

Não há limite de requisições por segundo documentado no repositório.

## Paginação, retentativas e limites atuais

### Pedidos

- página de 50;
- cursor fornecido pela API;
- teto de 800 pedidos por execução;
- janela incremental padrão de 45 minutos no código;
- jobs usam janela com sobreposição.

### Produtos

- página de 100 por offset;
- lote de 50 no detalhe;
- teto de 1.500 itens por execução.

### SBS/FBS

- página de 100;
- teto de 50 páginas.

### Escrow

- até 80 pedidos por execução;
- um pedido por requisição;
- pedidos com erro podem voltar à fila por até cinco tentativas.

### Lacunas

- Os clientes Shopee atuais não implementam backoff exponencial para HTTP 429
  ou erros 5xx.
- Não há checkpoint de arquivo para exportações.
- A idempotência atual está no banco, por chaves determinísticas e upsert.
- O extrator AMS deverá implementar retry com jitter, checkpoint e deduplicação
  antes de qualquer carga ampla.

## Jobs ativos

- `shopee-sync-*`: a cada 15 minutos, escalonado por loja.
- `shopee-escrow-*`: a cada 30 minutos, escalonado por loja.
- `shopee-sbs-hourly`: de hora em hora.
- `shopee-products-*`: a cada seis horas, escalonado por loja.
- `oraculo-shopee-take-rate-cache`: duas vezes por hora.

As últimas execuções canônicas consultadas estavam com sucesso. Os erros
registrados pertencem aos importadores históricos anteriores ao caminho atual.

## Banco de dados

### Tabelas principais

`shopee_orders`

- pedido, status e datas;
- total, moeda e frete;
- comprador e endereço;
- payload bruto;
- 90.864 registros;
- período de criação: 2026-05-31 a 2026-07-27.

`shopee_order_items`

- item, modelo, SKU, quantidade;
- preço original e descontado no payload bruto;
- quantidades canceladas, devolvidas e solicitadas no payload bruto;
- promoção e tipo de promoção no payload bruto;
- 92.312 registros.

`shopee_order_escrow`

- bruto pago pelo comprador;
- líquido do vendedor;
- taxas, vouchers, frete e ajustes;
- itens detalhados em JSON;
- campos financeiros AMS no payload bruto;
- 35.064 registros, todos com status de ingestão `success`.

`shopee_products`

- item/modelo, SKU, status, categoria, marca, preço e estoque;
- `video_info` do cadastro do anúncio, sem métricas de conteúdo;
- 3.888 registros.

`shopee_sales_daily`

- quantidade e receita por loja, item, modelo e dia;
- 6.163 registros;
- período encontrado: 2026-05-31 a 2026-07-16;
- última atualização encontrada: 2026-07-16, portanto está defasada em relação
  aos pedidos e não deve ser a fonte única desta sprint.

`shopee_sbs_inventory`

- inventário FBS corrente;
- velocidade e vendas de 7/15/30/60/90 dias por SKU/armazém;
- 21 registros no retrato consultado.

`shopee_product_snapshots` e `shopee_sbs_snapshots`

- histórico diário iniciado em 2026-07-16.

`shopee_sync_runs`

- histórico de execução, progresso e erros;
- 8.659 registros.

### Status de pedido encontrados

| Status real | Registros | Classificação preliminar |
|---|---:|---|
| `COMPLETED` | 51.317 | concluído |
| `TO_CONFIRM_RECEIVE` | 14.018 | enviado/aguardando recebimento |
| `SHIPPED` | 12.075 | enviado |
| `CANCELLED` | 7.861 | cancelado |
| `PROCESSED` | 3.799 | processado |
| `READY_TO_SHIP` | 747 | pronto para envio |
| `TO_RETURN` | 597 | devolução em andamento |
| `UNPAID` | 450 | não pago |

A regra de venda válida ainda precisa ser definida com cuidado. Para uma base
financeira conservadora, `COMPLETED` com escrow de sucesso é o conjunto mais
seguro. Estados enviados ou processados podem entrar em uma visão operacional,
mas não devem ser tratados como receita final sem validação.

### Campos AMS encontrados no escrow

| Loja | Pedidos com AMS | Linhas com AMS | Atividades distintas | Comissão AMS |
|---|---:|---:|---:|---:|
| Donacor | 1.516 | 1.554 | 16 | R$ 4.461,25 |
| Espaço De Bicho | 2.094 | 2.118 | 32 | R$ 6.111,96 |
| Jacartta | 1.579 | 1.592 | 31 | R$ 4.060,63 |
| Oliverhome | 1.962 | 1.982 | 35 | R$ 10.996,07 |
| **Total** | **7.151** | **7.246** | **75 no total** | **R$ 25.629,91** |

O período desses pedidos com comissão AMS vai de 2026-07-01 a 2026-07-24.

Os tipos de atividade com comissão AMS foram:

- `flash_sale`;
- vazio/não informado;
- `bundle_deal`;
- `add_on_deal`.

Nenhum campo de identidade de afiliado foi encontrado nesses itens.

## Disponibilidade dos dados solicitados

Legenda:

- **API atual**: endpoint já implementado e payload real validado.
- **Banco**: persistido no Supabase atual.
- **API indisponível nos apps atuais**: o endpoint principal foi testado e
  recusado por falta de permissão.
- **Disponibilidade não confirmada**: campo ou endpoint auxiliar não validado
  por resposta real.
- **Parcial**: existe informação relacionada, mas não cumpre todo o requisito.

| Dado | Classificação | Observação |
|---|---|---|
| ID/nome/username do afiliado | API indisponível nos apps atuais | ausente no banco atual |
| Status/data de entrada do afiliado | API indisponível nos apps atuais | ausente no banco atual |
| Seguidores | disponibilidade não confirmada | não documentado localmente |
| Tipo de afiliado/criador | disponibilidade não confirmada | não documentado localmente |
| Loja | banco | nome disponível; identificadores não exportados neste mapa |
| ID de vídeo/live | não disponível no banco | `video_info` é do anúncio, não conteúdo do afiliado |
| Data e métricas de conteúdo | disponibilidade não confirmada | nenhuma implementação |
| Cliques, visualizações e engajamento | disponibilidade não confirmada | nenhuma implementação |
| Pedido e status | API atual + banco | completo para a janela existente |
| Data/hora do pedido | API atual + banco | `create_time`, `pay_time`, `update_time` |
| Item/modelo/SKU/nome/quantidade | API atual + banco | preços no payload bruto/escrow |
| Valor bruto/pago/líquido | API atual + banco | pedido + escrow |
| Comissão do afiliado | parcial | custo AMS existe, mas sem identidade do afiliado |
| Taxa percentual do afiliado | API indisponível nos apps atuais | não persistida |
| Cancelamento | API atual + banco | status e quantidades por item |
| Devolução | parcial | `TO_RETURN`, quantidades e retorno no escrow |
| Reembolso | parcial | ajustes financeiros e `refund_amount` exigem normalização |
| Data de conclusão | parcial | status existe; timestamp específico não foi persistido |
| Produtos e variações | API atual + banco | catálogo completo atual |
| Quantidade/faturamento por produto | banco derivado | série diária está defasada; pode ser recalculada dos pedidos |
| Afiliados que venderam o produto | API indisponível nos apps atuais | impossível no banco atual |
| Primeira/última venda do afiliado | não disponível | depende de identidade |
| Meses/semanas ativos do afiliado | não disponível | depende de identidade |

## Dados já utilizáveis sem nova chamada Shopee

- pedidos por loja, período e status;
- itens, SKUs, modelos, quantidades e preços;
- totais pagos e líquidos dos pedidos concluídos com escrow;
- taxas e comissão de plataforma;
- custo AMS por pedido/item, sem afiliado;
- cancelamentos e devoluções em andamento;
- catálogo de produto e estoque;
- períodos de 30/60 dias e parte do período de 90 dias.

Esses dados podem apoiar uma auditoria de volume AMS anônimo, mas não atendem ao
objetivo principal de analisar afiliados individualmente.

## Dados que ainda precisam da API AMS ou de relatório

- identidade do afiliado;
- nome e username;
- canal e campanha;
- pedido atribuído ao afiliado;
- comissão paga ao afiliado por pedido/item;
- status de verificação/dedução;
- primeira e última conversão por afiliado;
- performance agregada por afiliado;
- conteúdo, vídeo, live, clique, visualização e engajamento, se a Shopee os
  disponibilizar.

## Bloqueio confirmado e decisão de continuação

O extrator completo, as exportações e a análise por afiliado não serão criados
enquanto o bloqueio permanecer. Fazer isso com o escrow produziria atribuições
falsas.

Há duas formas válidas de desbloquear a sprint:

1. habilitar, para cada partner app necessário, a permissão
   `Affiliate Marketing Solution Management` e repetir a sonda mínima; ou
2. fornecer o relatório de conversões do Programa de Afiliados do Vendedor,
   exportado do Seller Center.

O arquivo alternativo precisa conter, no mínimo:

- identificador, nome e username do afiliado;
- pedido e status;
- item, modelo, SKU e nome do produto;
- quantidade e valor da compra;
- data do pedido e da conclusão/conversão;
- valor e percentual da comissão do afiliado;
- reembolso/devolução;
- canal, campanha ou conteúdo, quando disponíveis.

O projeto local não documenta o rótulo exato do botão nem o caminho de menus do
Seller Center. O artefato tecnicamente necessário é o equivalente exportável
do `get_conversion_report`, e não um relatório agregado de loja ou produto.

## Conclusão

O Oráculo já tem autenticação e dados Shopee suficientes para reutilização, mas
os quatro partner apps atuais não têm acesso ao endpoint de conversões de
afiliados. O caminho correto não é construir uma segunda autenticação: após a
permissão ser concedida, deve ser criado um leitor AMS que consuma as
credenciais existentes e respeite o renovador único.

Até essa validação, não é tecnicamente correto gerar:

- `shopee_affiliates.csv`;
- ranking ou performance por afiliado;
- recorrência de afiliados;
- metas ou tamanho de campanha baseados em afiliados.
