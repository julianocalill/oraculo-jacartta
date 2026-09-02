# Status do projeto — 2026-09-02

Este registro complementa o panorama de produção de
[`project-status-2026-09-01.md`](project-status-2026-09-01.md). A entrega é uma
melhoria de explicação na aplicação web: não altera banco, custos cadastrados,
motor fiscal, sincronizações ou automações.

## Bruto usado e líquido usado mais transparentes

A seção **Parâmetros → Conferência de custos** ganhou uma explicação visível,
antes da tabela, sobre os dois valores que alimentam as análises do Oráculo:

- **Bruto usado:** custo unitário de aquisição antes dos créditos tributários.
  A prioridade é correção manual, custo médio do ERP e custo cadastrado; nos
  kits, o valor é a soma dos componentes.
- **Líquido usado:** custo bruto depois dos créditos recuperáveis de PIS/COFINS.
  É este valor que entra nos cálculos de margem, lucro, ROI e recomendações.

A tela mostra os fatores atuais da regra contábil — `bruto × 0,9075` para
produto nacional e `bruto × 0,8825` para importado — e traduz a fórmula em um
exemplo simples: um custo bruto de R$ 100,00 resulta em R$ 90,75 ou R$ 88,25,
respectivamente.

Os cabeçalhos **Bruto usado** e **Líquido usado** também receberam tooltips
centralizados em `apps/web/lib/column-hints.ts`. A origem do item continua
visível na própria linha para permitir o double-check antes de confiar na
margem.

## Limite contábil explicitado

A interface avisa que os percentuais representam a regra contábil vigente no
Oráculo. Mercadorias que não permitem crédito integral — como determinados
casos de regime monofásico, substituição tributária ou fornecedor do Simples —
precisam de confirmação da contabilidade.

Essa ressalva preserva a distinção entre a regra implementada e a situação
fiscal específica de cada mercadoria. Nenhuma fórmula foi alterada nesta
entrega.

## Novidades pós-login

A mudança foi adicionada ao manifesto de Novidades com um ID próprio:
`2026-09-02-explicacao-custo-bruto-liquido`. Assim, o aviso reaparece para todos
durante 48 horas, inclusive para quem marcou **Não mostrar novamente** na
publicação anterior. O atalho leva diretamente a
`/parametros?secao=custos`.

## Validação

- TypeScript sem erros;
- revisão visual em desktop e viewport móvel de 390 × 844 px;
- conteúdo e tooltips conferidos no navegador;
- SKU nacional real validado: bruto de R$ 0,35 e líquido de R$ 0,32, coerente
  com o fator de origem nacional;
- nenhuma gravação de custo e nenhuma migration executada.

## Publicação

A melhoria foi publicada nos dois remotes no commit `037d701`. O deployment
Vercel `dpl_95UMr7x6C2dTFqZPRcme7XgopWZe` chegou a `Ready` e recebeu o alias
`https://oraculo.oliverhome.com.br`.

`origin/main` e `personal/main` apontam para o mesmo commit; a Vercel acompanha
`personal/main`.

Arquivos centrais:

- `apps/web/app/parametros/page.tsx`;
- `apps/web/app/globals.css`;
- `apps/web/lib/column-hints.ts`;
- `apps/web/lib/release-notes.ts`.

## Decisão fiscal confirmada com Eduardo

Após validação com Eduardo, foi mantida a decisão do ADR-005: margem, lucro,
ROI e recomendações usam o **custo líquido**. O custo bruto permanece visível
somente como valor de aquisição e auditoria.

A revisão encontrou uma exceção no protótipo de Inteligência: ele carregava
`unit_cost_gross` e compensava o crédito dentro do PIS/COFINS. O trecho foi
alinhado ao contrato canônico: passa a carregar `unit_cost` e desconta o débito
cheio de PIS/COFINS sobre a venda, sem dupla contagem do crédito. Nenhuma view,
tabela ou fórmula do banco foi alterada.

Correção publicada no commit `c366197`; deployment Vercel
`dpl_51ujVePAEgWjq5xqpWHumjCUPW1P` confirmado como `Ready` no domínio
`https://oraculo.oliverhome.com.br`.

## Busca de produto na Inteligência

A Inteligência ganhou uma consulta global antes dos cards de resumo. A busca
aceita SKU, nome, variação ou loja, ignora acentos e prioriza correspondência
exata de SKU, início do SKU e início do nome.

Até oito resultados são exibidos enquanto o usuário digita. Cada resultado já
responde se o produto **precisa de ação** ou está **sem ação imediata**, mostra
a recomendação e seu motivo. Ao selecionar o item — ou pressionar Enter no
primeiro resultado — o sistema abre diretamente o Produto 360 correspondente.

A experiência foi validada com busca por SKU, busca textual, estado sem
resultado e abertura do diagnóstico; o layout também foi revisado em viewport
de 390 × 844 px. A mudança recebeu um ID próprio no manifesto de Novidades para
ser comunicada por 48 horas mesmo a usuários que silenciaram avisos anteriores.

Publicada no commit `c644041`; deployment Vercel
`dpl_4JYL74Ae9avL4Ram4nnoPQFmbo3c` confirmado como `Ready` no domínio
`https://oraculo.oliverhome.com.br`.

## Custo cadastrado no Produto 360

O diagnóstico do produto passou a separar visualmente o valor bruto cadastrado
na Olist do custo líquido usado pelo cálculo. O card **Custo cadastrado Olist**
mostra o total do anúncio e sua composição (`custo unitário × quantidade do SKU
por venda`); o card vizinho **Custo líquido usado** deixa explícito qual valor
alimenta margem e lucro.

O dado bruto vem diretamente de `olist_products.preco_custo`, consolidado pelo
SKU. Não é substituído silenciosamente pelo custo médio, por override manual ou
pelo custo líquido canônico. Quando o cadastro está vazio ou zerado, a tela
mostra “Sem custo bruto cadastrado”.

No SKU `213169` da validação, a Olist registra R$ 29,12 por unidade e o anúncio
vende duas unidades: o Produto 360 mostra R$ 58,24 cadastrado e R$ 52,85 líquido
usado. O fluxo foi conferido no localhost em desktop e em 390 × 844 px. Nenhuma
migration ou alteração de dados foi necessária.
