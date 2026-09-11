# Status do projeto — 11/09/2026

## Autorização Shopee concluída para a Giracasa

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

Os segredos internos de chamada e state, o redirect do n8n, o Live Partner ID
`2044231` e a Live Partner Key foram configurados. Em 11/09/2026 a loja
`984950642` autorizou o aplicativo e o callback gravou access token e refresh
token no schema `giracasa`. Nenhuma credencial de Uberlândia é usada como
fallback.

O canário direto da API usou a janela incremental padrão de 45 minutos e
concluiu com HTTP 200: 87 pedidos lidos, 87 gravados e 87 pacotes atualizados,
sem limite atingido. Giracasa permaneceu `enabled=false`, com zero usuários.

## Renovação automática do token

O callback OAuth é o único proprietário do refresh token da Giracasa. O job
`giracasa-shopee-token-refresh` roda no Supabase a cada duas horas, no minuto
`:15`, e só renova quando o access token vence em até três horas. Cada
renovação grava o novo access token e o novo refresh token na mesma operação;
sucessos e falhas ficam em `giracasa.shopee_sync_runs` com a origem
`shopee-token-refresh:984950642`.

A validação forçada respondeu HTTP 200, rotacionou o refresh token e estendeu o
access token por quatro horas. Uma única função controla a rotação; o relay n8n
não lê nem renova tokens.

O próximo passo é executar a carga inicial Shopee por loja em janelas
compatíveis com os limites da API. Giracasa permanece `enabled=false` e sem
usuários.

Runbook: `docs/giracasa-onboarding.md`.
