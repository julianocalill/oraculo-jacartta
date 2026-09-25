# Estado do projeto — 25/09/2026

## Tarifa fixa da Shopee a partir de 01/10/2026

- O preset **Shopee** usa R$ 4,50 de valor fixo por item para produtos de até
  R$ 79,99, inclusive.
- A nova regra está identificada na tela como vigente a partir de 01/10/2026.
- A comissão de 20% da primeira faixa e as tarifas de R$ 16, R$ 20, R$ 26 e
  R$ 28 das faixas seguintes permanecem inalteradas.
- A alteração foi baseada no comunicado visual fornecido pela operação em
  25/09/2026.

## Envio fixo do TikTok na calculadora

- O preset **TikTok Shop** desconta R$ 12,10 de envio abaixo de R$ 50 e
  R$ 19,30 a partir de R$ 50, em dois campos próprios e editáveis.
- As comissões permanecem em 10% e 6%; os fixos do marketplace permanecem em
  R$ 4 e R$ 6, respectivamente.
- Afiliado opcional, impostos, custos operacionais e demais marketplaces não
  foram alterados por esta regra.
- Os novos valores participam da decomposição e do modo **Por lucro líquido**.
- O link que atribuía a regra anterior a uma fonte oficial foi retirado: estes
  valores são parâmetros operacionais informados em 25/09/2026.

## Envio fixo do Mercado Livre na calculadora

- Os presets **ML Clássico** e **ML Premium** de `/calculadora` descontam
  R$ 12 de envio quando o preço de venda é estritamente inferior a R$ 79,99.
- O valor aparece em um campo próprio e editável junto às faixas do Mercado
  Livre; trocar de preset ou restaurar os padrões repõe R$ 12.
- O envio aparece em uma linha própria da decomposição, sem substituir nem
  somar-se silenciosamente ao custo fixo por faixa do marketplace.
- O modo **Por lucro líquido** considera a quebra em R$ 79,99 ao procurar o
  menor preço que atinge a margem desejada.
- Comissões do Mercado Livre, tarifas fixas já existentes, impostos e custos
  operacionais permanecem inalterados por esta regra.

## Validação

- Testes automatizados confirmam R$ 4,50 em R$ 79,99 e preservam R$ 16 a
  partir de R$ 80, além das demais faixas da Shopee.
- Testes automatizados confirmam R$ 12 em R$ 79,98 e zero em R$ 79,99, nos
  presets Clássico e Premium.
- O cálculo reverso foi comparado centavo a centavo até o preço encontrado para
  garantir que não ignora a descontinuidade da taxa.
- Testes automatizados do TikTok confirmam os envios de R$ 12,10 em R$ 49,99
  e R$ 19,30 em R$ 50, separados dos fixos de R$ 4/R$ 6, além do cálculo
  reverso e da comissão opcional de afiliado.
- TypeScript do app web validado com o `tsc --noEmit` instalado no workspace.

Não há alteração em banco, motor fiscal, integrações ou deploy de Edge Function.

## Publicação

- Commit funcional: `5f41dde`.
- Deploy de produção validado como `Ready` na Vercel:
  `dpl_AU7EmzD1oHZBMU68oKMZsACsmUqq`.
- Alias público confirmado: `https://oraculo.oliverhome.com.br`.

## Devoluções: período livre e taxa de devolução

- `/devolucoes` aceita qualquer janela Início–Fim (`?inicio=YYYY-MM-DD&fim=YYYY-MM-DD`);
  `?mes=` continua válido. O corte usa meia-noite de São Paulo sobre `opened_at`.
- Taxa de devolução = devoluções abertas no período ÷ pedidos do período sem
  cancelados, lidos de `oraculo_channel_sales_unified_cache` com `source='olist'`
  (canal mapeado por prefixo do `channel_name`: Shopee*, TikTok*, Mercado Livre*).
- Numerador e denominador usam datas diferentes (abertura da devolução × data do
  pedido): em janelas curtas a taxa oscila. A ressalva está na própria tela.
- Validado no navegador: agosto/2026 = 3,4%; 10/07–20/08 = 4,3% (Shopee 4,3%,
  TikTok 5,1%, ML 0,1%). Sem alteração de banco.
