# Status do projeto — 11/09/2026

## Autorização Shopee preparada para a Giracasa

O aplicativo Shopee da Giracasa foi aprovado. A Edge Function
`giracasa-shopee-oauth-callback` foi criada e publicada para concluir a
autorização sem expor Partner Key ou tokens no navegador, SQL Editor ou Git.

A URL de retorno é:

```text
https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/giracasa-shopee-oauth-callback
```

O início do fluxo acontece por
`oraculo_private.invoke_giracasa_shopee_oauth_start()`. Essa função lê do Vault
um segredo exclusivo, chama a Edge Function e recebe um link Shopee assinado
com validade de 15 minutos. O retorno valida um state assinado, troca `code` e
`shop_id` por tokens e grava `shopee_app_config`, `shopee_shops` e
`shopee_tokens` somente no schema `giracasa`.

Os segredos internos de chamada e state já foram configurados. O teste remoto
chegou ao callback e parou exatamente na ausência de
`GIRACASA_SHOPEE_PARTNER_ID`, comprovando que nenhuma credencial de Uberlândia
é usada como fallback.

## Próximo passo

No painel de Secrets do projeto Supabase, cadastrar diretamente os valores
obtidos na tela do aplicativo aprovado:

- `GIRACASA_SHOPEE_PARTNER_ID`
- `GIRACASA_SHOPEE_PARTNER_KEY`

Depois disso, gerar o link curto pelo helper, autorizar somente a loja
Giracasa e conferir a identidade retornada antes de criar qualquer cron de
sincronização. Giracasa permanece `enabled=false` e sem usuários.

Runbook: `docs/giracasa-onboarding.md`.
