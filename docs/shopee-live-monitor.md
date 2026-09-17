# Monitor de vendas Shopee por API

Implementado em 17/09/2026 na rota `/shopee/ao-vivo`. O objetivo é reunir as
lojas ativas da Shopee em uma tela equivalente ao monitor operacional da
Central do Vendedor, usando somente a Shopee Open Platform.

## O que a tela mede

- faturamento do dia por `total_amount`;
- pedidos pagos/operacionais, excluindo `UNPAID`, `CANCELLED` e `IN_CANCEL`;
- unidades dos itens;
- compradores únicos por `buyer_user_id`, com `buyer_username` como fallback;
- faturamento por hora de hoje comparado ao dia anterior;
- top produtos por valor dos itens e unidades;
- totais consolidados e quebra por loja.

O período usa `America/Sao_Paulo`. O valor por produto soma
`model_discounted_price × model_quantity_purchased`; frete e ajustes que só
existem no total do pedido não são rateados para o ranking.

## Limite honesto da API

`order.get_order_list` e `order.get_order_detail` não devolvem visitantes
gerais, cliques gerais por produto nem a taxa de conversão do Business
Insights. A API de Ads traz cliques de anúncios, que é outra população. A tela
mantém esses três cards como indisponíveis em vez de misturar métricas ou usar
endpoints internos da Central do Vendedor.

Não há scraping, cookie de navegador, extensão ou automação da sessão do
Seller Center.

## Arquitetura

```text
Shopee Open Platform
        ↓ uma loja por invocação
Edge Function shopee-live-monitor
        ↓ snapshot sem PII
shopee_live_monitor_snapshots
        ↓ leitura server-side com service role
Oráculo /shopee/ao-vivo
```

- Cada loja tem partner app próprio; a assinatura usa a `partner_key`
  correspondente ao `partner_id` da loja.
- O n8n `Zeptn7GL4bOOsGKj` continua sendo o único renovador dos tokens. A nova
  função apenas lê o token replicado e adia/falha quando ele está perto de
  expirar.
- A função pagina até 5.000 pedidos entre o início de ontem e o momento atual,
  detalha em lotes de 50 e agrega antes de persistir.
- Há quatro crons `shopee-live-monitor-<shop_id>`, a cada cinco minutos e
  escalonados em minutos diferentes.
- A página atualiza sua leitura a cada minuto, mas não chama a Shopee em cada
  acesso. Usuários simultâneos leem o mesmo snapshot.

## Segurança e integridade

- A tabela é RLS + `service_role` only; não há grant para `anon` ou
  `authenticated`.
- Tokens, partner keys, compradores e payloads de pedido não entram no
  snapshot nem chegam ao browser.
- O Edge endpoint exige `x-sync-secret` do Vault.
- Falha de uma coleta preserva o último snapshot bom da loja, marca o status
  como falha e registra uma execução em `shopee_sync_runs` com source
  `shopee-live-monitor:<shop_id>`.
- Um snapshot com mais de 12 minutos ou de outra data BRT não entra nos
  totais. A tela declara cobertura parcial e identifica a loja atrasada.
- Se o teto de 5.000 pedidos for atingido, o snapshot é marcado `partial`; não
  recebe aparência de dado completo.

## Arquivos

- Edge Function: `supabase/functions/shopee-live-monitor/index.ts`
- Agregador puro e testado: `supabase/functions/_shared/shopee-live-monitor.js`
- Banco e crons: migration `20260917112317_shopee_live_monitor.sql`
- Página: `apps/web/app/shopee/ao-vivo/`
- Navegação: `apps/web/app/shopee/tabs.tsx`

## Implantação e validação

1. Aplicar a migration com `npx supabase db query --linked --file ...`.
2. Publicar `shopee-live-monitor` com `--no-verify-jwt`, pois a chamada vem do
   `pg_net`, mantendo a validação obrigatória de `x-sync-secret` dentro da
   própria função.
3. Enfileirar uma coleta por loja com
   `select private.invoke_shopee_live_monitor(<shop_id>);`.
4. Confirmar quatro snapshots do dia, `is_complete=true`, status `success` e
   uma execução bem-sucedida por source em `shopee_sync_runs`.
5. Comparar faturamento, pedidos, unidades e compradores de uma loja com o
   monitor oficial no mesmo minuto e filtro `Produto Pago`.
6. Só então publicar o web app.

### Validação em produção — 17/09/2026

- Edge Function `shopee-live-monitor` ativa e republicada, protegida por
  `x-sync-secret` e sem renovação concorrente de token.
- Quatro jobs ativos, com uma coleta por loja a cada cinco minutos.
- Quatro lojas com `status=success`, `is_complete=true` e data BRT correta.
- Às 08:38 BRT, o snapshot consolidado registrava R$ 12.723,90, 186 pedidos,
  195 unidades e 184 compradores. Esses valores são apenas um ponto de
  controle e continuam variando durante o dia.
- A rota publicada responde em
  `https://oraculo.oliverhome.com.br/shopee/ao-vivo` e preserva o redirecionamento
  obrigatório para login quando acessada sem sessão.
- Publicação final: Vercel `dpl_FoMk7g27SqjoyAriQFSRdh8BmWGU`, estado `Ready`,
  criada em 17/09/2026 às 08:51 BRT e associada ao domínio oficial.
- Validações locais: 85 testes, typecheck e build de produção aprovados.
- Validação pós-deploy às 08:53 BRT: quatro de quatro lojas saudáveis, snapshot
  mais recente às 08:51 BRT, R$ 14.194,95 e 197 pedidos no consolidado.

## Recuperação

1. Ver a tabela por loja no próprio monitor e `/status`/`shopee_sync_runs`.
2. Em erro de token, corrigir o renovador primário do n8n; nunca iniciar um
   segundo renovador.
3. Em `error_too_many_requests`, aumentar o intervalo dos quatro crons antes de
   elevar paralelismo.
4. Em `partial`, medir o volume e reduzir a janela/persistir incrementalmente;
   não aumentar o teto sem verificar o tempo máximo da Edge Function.
