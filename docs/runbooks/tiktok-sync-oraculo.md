# Runbook — Sync TikTok Shop (Donacor) dentro do Oráculo

Integração direta com o TikTok Shop no mesmo desenho da Shopee direta:
credenciais em tabelas service_role-only, edge functions no projeto Oráculo
(`bbtiipnmdxfxnxbemgjr`), pg_cron para agendamento.

Papel da fonte (mesma decisão da Shopee, 2026-07-13): **Olist segue sendo a
verdade da receita**; o TikTok direto é double-check + camada de SKU/financeiro.
Não somar por cima nos consolidados sem verificar duplicação com o Olist.

## Formulário do Partner Center (Criar app e serviço)

| Campo | Valor |
|---|---|
| Tipo | **Serviço personalizado** (não listado publicamente) |
| Categoria de serviço | Escolhida: Catálogo / Anúncio de produtos (não pode mudar; os dados que acessamos são controlados pelos **escopos de API**, não pela categoria) |
| Nome padrão | Catálogo - Oraculo |
| Logotipo | opcional — pular |
| Mercado-alvo | Brasil |
| Tipo de vendedor | Vendedores locais |
| Habilitar API | ON |
| URL de redirecionamento | `https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/tiktok-oauth-callback` |

**Escopos de API**: marcar tudo de leitura de Pedidos (Order), Financeiro
(Finance/Settlement), Produtos (Product) e Devoluções (Return/Refund) já na
criação — adicionar escopo depois exige reautorização do seller.

## Componentes

- **Tabelas** (migration `20260728120000`): `tiktok_app_config` (app_key,
  app_secret, service_id), `tiktok_tokens` (por open_id do seller),
  `tiktok_shops` (com o `cipher`, obrigatório em toda chamada de loja),
  `tiktok_orders`, `tiktok_order_items`, `tiktok_sync_runs`. RLS, só
  `service_role`.
- **Edge function `tiktok-oauth-callback`** (pública, `--no-verify-jwt`):
  recebe `?code=`, troca por tokens em `auth.tiktok-shops.com`, lista lojas
  autorizadas (`/authorization/202309/shops`) e grava tokens + lojas.
- **Edge function `tiktok-sync`** (protegida por `x-sync-secret`, env
  `TIKTOK_SYNC_SECRET`): renova access_token (validade ~7 dias, renova quando
  faltar <12h), busca pedidos por `update_time` via
  `POST /order/202309/orders/search` (retorno já traz line_items — sem chamada
  de detalhe), upsert idempotente (`id = shop_id-order_id`), log em
  `tiktok_sync_runs`. Janela padrão 45 min, teto 500 pedidos/run.
- **Itens**: no TikTok cada `line_item` é 1 unidade; o sync agrega por SKU
  (`quantity` = contagem de line_items do SKU no pedido).

## ⚠️ Regra de ouro — renovador único de token

Como na Shopee: **só o `tiktok-sync` renova o access_token**. Nenhum outro
sistema (n8n, scripts) pode usar o refresh_token desta autorização.

## Sequência de go-live (ordem importa)

1. **[Partner Center]** Criar o app com os campos da tabela acima; anotar
   `app_key`, `app_secret` e `service_id`.
2. **[Repo]** Aplicar a migration `20260728120000` (db push ou SQL editor).
3. **[Supabase]** Inserir credenciais (SQL editor, service_role; não colar em
   chat/log durável):
   ```sql
   insert into tiktok_app_config (app_key, app_secret, service_id)
   values ('<app_key>', '<app_secret>', '<service_id>');
   ```
4. **[Supabase]** Deploy das duas functions **sem verify_jwt** (sem CLI/Docker:
   Management API multipart com `User-Agent: curl/8.4.0`, ver
   `docs/mercadolivre-integration.md` / memória de deploy). Setar env
   `TIKTOK_SYNC_SECRET` (e vault `oraculo_tiktok_sync_job_secret` com o mesmo
   valor).
5. **[Seller]** Autorizar: abrir logado como Donacor
   `https://services.tiktokshop.com/open/authorize?service_id=<service_id>`.
   O callback confirma na tela e grava `tiktok_tokens` + `tiktok_shops`.
6. **[Supabase]** Teste manual:
   `POST /functions/v1/tiktok-sync?minutes=1440` com header `x-sync-secret` —
   conferir `tiktok_sync_runs` (`status=success`) e linhas em `tiktok_orders`.
7. **[Supabase]** Agendar pg_cron (15 min, janela 45 → sobreposição segura):
   ```sql
   create or replace function private.invoke_tiktok_sync(
     p_minutes integer default 45, p_timeout_ms integer default 120000
   ) returns bigint language plpgsql security invoker as $$
   declare project_url text; sync_secret text;
   begin
     select decrypted_secret into project_url from vault.decrypted_secrets where name = 'oraculo_project_url' limit 1;
     select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'oraculo_tiktok_sync_job_secret' limit 1;
     if project_url is null or sync_secret is null then
       raise exception 'Missing Vault secrets';
     end if;
     return net.http_post(
       url := project_url || '/functions/v1/tiktok-sync?minutes=' || p_minutes,
       headers := jsonb_build_object('Content-Type','application/json','x-sync-secret',sync_secret),
       body := '{}'::jsonb, timeout_milliseconds := p_timeout_ms);
   end; $$;

   select cron.schedule('tiktok-sync-donacor', '12-59/15 * * * *',
     $$ select private.invoke_tiktok_sync(45); $$);
   ```
   (minuto 12 evita colisão com os crons Shopee: 0/3/6/9 + escrow 11/13/17/19.)
8. **[BI]** Decidir a exposição no dashboard (aba SKU/Mais Vendidos) — sem
   somar nos consolidados até reconciliar com o Olist (mesmo racional Shopee).

## Monitoramento

- `tiktok_sync_runs` com `source='tiktok-sync:<shop_id>'`.
- Access token ~7 dias / refresh token de longa duração — se o sync ficar >7
  dias sem rodar com sucesso, o access_token expira e o próximo run renova via
  refresh_token; se o refresh_token expirar, é preciso reautorizar (passo 5).

## Status

- 2026-07-28: scaffold criado (migration + 2 edge functions + runbook). App no
  Partner Center em criação; aguardando `app_key`/`app_secret`/`service_id`
  para os passos 3–5.
