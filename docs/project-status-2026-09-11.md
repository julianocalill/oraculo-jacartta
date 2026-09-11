# Status do projeto — 11/09/2026

## Autorização Shopee preparada para a Giracasa

O aplicativo Shopee da Giracasa foi aprovado. A Edge Function
`giracasa-shopee-oauth-callback` foi criada e publicada para concluir a
autorização sem expor Partner Key ou tokens no navegador, SQL Editor ou Git.

A Shopee aprovou o aplicativo com o domínio de retorno do n8n. Para preservar
essa configuração, a URL registrada no fluxo é:

```text
https://n8n.oliverhome.com.br/webhook/d544ac83-a9a2-4d11-acbb-1e85b52c154d/giracasa-shopee-oauth/<state>
```

O workflow `Giracasa - OAuth Shopee para Supabase` (`QnWQtiRcTguhXnGh`)
responde com HTTP 302 e encaminha somente `code`, `shop_id`, `state`, `error` e
`message` para a Edge Function. Como a Shopee acrescenta apenas `code` e
`shop_id` à URL de retorno, o state assinado viaja em um segmento do caminho do
webhook. O n8n não recebe Partner Key nem armazena os tokens. O relay foi
validado em produção contra o callback do Supabase.

O início do fluxo acontece por
`oraculo_private.invoke_giracasa_shopee_oauth_start()`. Essa função lê do Vault
um segredo exclusivo, chama a Edge Function e recebe um link Shopee assinado
com validade de 15 minutos. O retorno valida um state assinado, troca `code` e
`shop_id` por tokens e grava `shopee_app_config`, `shopee_shops` e
`shopee_tokens` somente no schema `giracasa`.

Os segredos internos de chamada e state, o redirect do n8n e o Live Partner ID
`2044231` já foram configurados. Nenhuma credencial de Uberlândia é usada como
fallback.

## Próximo passo

No painel de Secrets do projeto Supabase, cadastrar diretamente a Live API
Partner Key do aplicativo aprovado em `GIRACASA_SHOPEE_PARTNER_KEY`.

Depois disso, gerar o link curto pelo helper, autorizar somente a loja
Giracasa e conferir a identidade retornada antes de criar qualquer cron de
sincronização. Giracasa permanece `enabled=false` e sem usuários.

Runbook: `docs/giracasa-onboarding.md`.
