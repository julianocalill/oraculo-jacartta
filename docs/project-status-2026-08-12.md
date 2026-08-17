# Estado do projeto — 12/08/2026

Este documento complementa e substitui, como ponto inicial, o snapshot de
10/08/2026. Para o estado geral anterior, ler
`docs/project-status-2026-08-10.md`.

## Relatório de vendas Shopee no WhatsApp

O relatório operacional foi desacoplado por completo dos dados do Oráculo.

```text
Shopee Open Platform → n8n → Evolution API → WhatsApp
```

- Workflow: `Shopee API Direta - Todos os Produtos WhatsApp 06h30 e 12h30`
  (`GJHOwusnuXgaxVaT`), ativo.
- `06:30`: dia anterior completo.
- `12:30`: dia atual até o instante da execução.
- Consolida quatro lojas e variações pelo produto, sem separar por loja.
- Lista todos os produtos vendidos em ordem decrescente.
- Divide listas extensas em partes numeradas de até 3.400 caracteres.
- Exclui `UNPAID`, `CANCELLED` e `IN_CANCEL`.
- Falha de qualquer loja interrompe o run para não enviar parcial.
- Preview consulta dados reais, mas não envia mensagem.

O relatório não lê `shopee_orders`, `shopee_order_items`, RPCs, views ou caches
do Oráculo. A RPC temporária criada para a primeira versão foi removida pela
migration `20260811150000_drop_shopee_sales_whatsapp_report.sql`.

Documentação completa e diagnóstico:
`docs/shopee-sales-whatsapp-report.md`.

## Ownership dos tokens Shopee

O n8n voltou a ser o único proprietário da renovação dos tokens rotativos:

- workflow `Shopee - Renovar Tokens (n8n primário)`;
- ID `Zeptn7GL4bOOsGKj`;
- execução a cada duas horas;
- gravação primária no banco operacional do n8n;
- réplica ao Oráculo não bloqueante.

O `shopee-sync` do Oráculo foi publicado como consumidor: valida a duração do
access token, mas nunca usa ou gira o refresh token. Todas as demais Edge
Functions Shopee mantêm o mesmo contrato de somente leitura.

O workflow legado `Dc6cFKsiWmI2kDJk` deve continuar desativado. Nunca podem
existir dois renovadores, pois a Shopee rotaciona o refresh token.

## Validação registrada

Em 11/08/2026, o preview direto da lista completa retornou:

- 1.362 pedidos;
- 1.450 unidades;
- 103 produtos;
- quatro mensagens, com itens numerados de 1 a 103.

Esses totais são evidência histórica da execução, não indicadores atuais.

## RPA de afiliados Shopee

Nova aba `/rpa`, entregue nesta data. Desde 01/07/2026 a Shopee repassa a
comissão do Programa de Afiliados do Vendedor como mera intermediação: paga o
valor bruto, não retém tributo na fonte, e a emissão do Recibo de Pagamento a
Autônomo para o afiliado pessoa física passou a ser obrigação do vendedor.

O caminho é upload de `.csv`, não integração: os quatro partner apps continuam
recebendo HTTP 403 `error_api_permission` em `get_conversion_report`, medição de
27/07/2026 registrada em `docs/shopee-affiliates-integration-map.md`.

Fluxo: cadastro do tomador → upload do Relatório Mensal → consolidado com as
retenções → aprovação → ZIP com um PDF por CPF.

Três decisões que valem retenção:

- as tabelas `oraculo_rpa_issuers`, `_batches` e `_items` são `service_role`-only,
  sem `grant select` para `authenticated`, porque guardam CPF, data de
  nascimento e endereço de centenas de pessoas físicas;
- entrou biblioteca de PDF (`pdf-lib` + `fflate`), desvio consciente da política
  adotada na etiqueta de palete, porque o entregável é um recibo por pessoa
  dentro de um ZIP e não um arquivo único de N páginas;
- o app passou a consumir `@oraculo/domain` de verdade, para não existirem duas
  implementações do mesmo cálculo de dinheiro.

Verificação sobre o arquivo real de Jul/2026: 772 afiliados, bruto
R$ 26.045,08, INSS R$ 2.864,99, IRRF R$ 0,00, líquido R$ 23.180,09, ZIP de
2,31 MB gerado em 4,9 segundos.

Pendências com a contabilidade, registradas no doc da feature: confirmar os
coeficientes da tabela do IRRF de 2026 e decidir o tratamento da ausência de
PIS/NIT no relatório da Shopee.

Documentação completa: `docs/rpa-afiliados-shopee.md`.

## Arquivos principais

- `docs/shopee-sales-whatsapp-report.md`
- `docs/adr/ADR-003-shopee-direct-sales-whatsapp.md`
- `docs/rpa-afiliados-shopee.md`
- `docs/runbooks/shopee-sync-oraculo.md`
- `docs/deployment-map.md`
- `supabase/functions/shopee-sync/index.ts`
- projeto operacional: `/Users/julianocalil/espacodebicho-integracoes`

## Estado de publicação

As mudanças operacionais no n8n e na Edge Function foram aplicadas em produção
em 11/08/2026. As alterações de código e documentação locais não receberam
commit ou push nesta sessão.
