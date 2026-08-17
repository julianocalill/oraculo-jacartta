# Estado do projeto — 13/08/2026

Este documento complementa e substitui, como ponto inicial, o snapshot de
12/08/2026. Para o estado geral das demais frentes, ler
`docs/project-status-2026-08-12.md`.

## Relatório Shopee de separação em caixas

O workflow `GJHOwusnuXgaxVaT` foi atualizado em produção e permanece ativo com
o nome `Shopee API Direta - Separação em Caixas WhatsApp 07h e 13h30`.

As janelas são fixas no fuso de São Paulo:

- `07:00`: dia anterior `14:00` → dia atual `06:30`;
- `13:30`: dia atual `08:00` → `13:00`.

Os intervalos `06:30–08:00` e `13:00–14:00` ficam fora dos relatórios por
decisão operacional.

O fluxo continua independente dos dados do Oráculo:

```text
Shopee Open Platform → n8n + catálogo operacional → Evolution → WhatsApp
```

Agora cada variação vinculada é convertida em caixas completas e unidades
avulsas. O vínculo usa `shop_id + item_id + model_id`; `units_per_sale` converte
anúncios de kits em unidades físicas. Itens sem vínculo continuam visíveis em
unidades com aviso de cubagem ausente.

Depois das mensagens, o workflow gera e envia um CSV UTF-8 com unidades
físicas vendidas, caixas completas, avulsos e todas as chaves necessárias para
mapear os itens pendentes. O slot somente é concluído depois do anexo.

Perfis `DESTAMPADO` possuem componentes explícitos no catálogo. Cada caixa e
cada sobra de pote gera a mesma quantidade da tampa correspondente. O perfil
370 + 640 gera quatro linhas; o perfil 370 + 640 + 1040 gera seis. Produtos
`TAMPADO` permanecem uma linha. A expansão somente é aplicada depois de um
vínculo inequívoco da variação Shopee ao perfil correto.

## Catálogo e cobertura

A planilha `/Users/julianocalil/Downloads/CUBAGEM - PRODUTOS.xlsx` foi lida sem
alteração. As 77 linhas tinham `QTD/CX` válido e positivo.

O banco operacional recebeu:

- 77 perfis em `shopee_box_profiles`;
- 10 componentes em `shopee_box_profile_components`;
- 440 vínculos determinísticos em `shopee_box_mappings`.

O catálogo Shopee analisado tinha 3.954 variações: 440 mapeadas, seis ambíguas
e 3.508 sem vínculo. Nenhuma das ambiguidades foi aplicada automaticamente.
Revisar e ampliar essa cobertura é uma pendência operacional; não bloqueia o
relatório porque o fallback conserva as vendas em unidades.

O relatório de reconciliação fica em
`/Users/julianocalil/espacodebicho-integracoes/tmp/shopee-box-reconciliation.csv`.

## Validação em produção

Previews reais, sem chamada à Evolution, concluídos em 13/08/2026:

- slot `07:00`: 2.180 pedidos, 2.317 unidades vendidas, 194 caixas, 1.506
  unidades avulsas, 139 grupos sem cubagem e seis partes;
- slot `13:30`: 1.011 pedidos, 1.085 unidades vendidas, 95 caixas, 779 unidades
  avulsas, 116 grupos sem cubagem e cinco partes.

Todas as mensagens ficaram abaixo de 3.400 caracteres. Esses números são
evidência histórica de validação, não indicadores atuais.

Uma prévia posterior validou o CSV do slot `13:30` com 136 linhas, das quais
116 pendentes de cubagem, sem envio de documento ao WhatsApp.

Durante a atualização, o n8n 2.18.5 precisou recarregar o community node da
Evolution API. Editor, webhook e worker foram reiniciados e voltaram saudáveis;
depois disso a ativação e os dois previews passaram.

## Código operacional

Em `/Users/julianocalil/espacodebicho-integracoes`:

- `src/workflows/shopee-sales-whatsapp.js`;
- `src/workflows/shopee-sales-whatsapp.test.js`;
- `scripts/setup-shopee-box-catalog.js`;
- `scripts/reconcile-shopee-box-mappings.js`;
- `scripts/setup-n8n-shopee-sales-direct-whatsapp.js`;
- `scripts/run-n8n-shopee-sales-whatsapp-test.js`.

Documentação detalhada:
`docs/shopee-sales-whatsapp-report.md` e
`docs/adr/ADR-003-shopee-direct-sales-whatsapp.md`.

## Estado de publicação

Catálogo, vínculos determinísticos e workflow foram aplicados em produção em
13/08/2026. Nenhuma mensagem foi enviada nos previews. As alterações locais de
código e documentação não receberam commit ou push nesta sessão.
