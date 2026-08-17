# ADR-003 — Relatório Shopee direto para WhatsApp

- Status: aceito
- Data: 2026-08-11
- Emenda: 2026-08-13

## Contexto

O primeiro formato do relatório de vendas lia pedidos sincronizados no banco do
Oráculo. Uma falha, atraso ou divergência nessa sincronização poderia produzir
um relatório incompleto e afetar uma informação operacional sensível.

O requisito do negócio é que o relatório seja independente do Oráculo e siga o
caminho mais curto possível entre a origem e o destinatário.

## Decisão

O relatório passa a usar a arquitetura:

```text
Shopee Open Platform → n8n → Evolution API → WhatsApp
```

O n8n consulta pedidos e detalhes diretamente nas quatro lojas, consolida todos
os produtos e envia o resultado. O Oráculo não é fonte nem etapa obrigatória.

Em 13/08/2026, a saída deixou de ser uma lista bruta de unidades e passou a ser
uma lista de separação em caixas. O banco operacional do n8n passou a guardar o
catálogo de cubagem e os vínculos explícitos `shop_id + item_id + model_id`.
Esse uso não reintroduz dependência do banco do Oráculo no caminho de execução.

As janelas também foram redefinidas como intervalos fixos:

- envio às `07:00`: dia anterior `14:00` até o dia atual `06:30`;
- envio às `13:30`: dia atual `08:00` até `13:00`.

Os intervalos entre as janelas ficam deliberadamente fora do relatório.

Produtos sem vínculo inequívoco continuam na saída em unidades, com alerta,
em vez de serem omitidos ou associados por aproximação. Perfis `Destampado`
possuem componentes explícitos: cada caixa ou sobra de pote gera a mesma
quantidade da respectiva tampa. Perfis `TAMPADO` não são expandidos.

Como a Shopee rotaciona o `refresh_token`, o n8n também passa a ser o único
proprietário da renovação. O Oráculo recebe uma réplica não bloqueante dos
tokens apenas para manter suas integrações próprias; suas funções são
consumidoras e não renovadoras.

## Consequências

### Positivas

- falhas e atrasos do Oráculo não afetam o relatório;
- o dado vem da fonte operacional primária no momento da execução;
- qualquer loja incompleta faz o run falhar, evitando consolidado parcial;
- preview e envio usam exatamente a mesma coleta e formatação;
- todas as variações e lojas são consolidadas sem expor subtotais por loja.
- a separação usa cubagem versionável sem esconder itens ainda não mapeados;
- caixas de tampas dos perfis destampados entram como volumes logísticos.

### Custos e riscos

- o relatório depende da disponibilidade da API Shopee e da Evolution;
- o n8n precisa paginar e detalhar muitos pedidos em cada execução;
- tokens e partner keys precisam estar saudáveis no ambiente do n8n;
- reativar um segundo renovador pode invalidar a cadeia de tokens;
- listas completas podem gerar várias mensagens no WhatsApp.
- a qualidade da conversão depende da manutenção dos vínculos de cubagem;
- anúncios ambíguos permanecem em unidades até decisão manual;
- os intervalos `06:30–08:00` e `13:00–14:00` não são recuperados por outro
  slot, por decisão do negócio.

## Alternativas rejeitadas

- Ler tabelas/RPCs do Oráculo: rejeitado por acoplar a informação à saúde do
  sync e do banco do Oráculo.
- Ler Olist: rejeitado porque não é a origem direta pedida e possui critérios e
  tempos de atualização próprios.
- Enviar apenas top 10: substituído por todos os produtos vendidos, conforme
  decisão posterior do negócio.
- Inferir cubagem apenas por título ou SKU: rejeitado porque nomes comerciais
  não identificam com segurança o produto físico, especialmente nos kits.

## Referência operacional

Ver `docs/shopee-sales-whatsapp-report.md`.
