# Estado do projeto — 22/09/2026

## Ajuste de apresentação da separação

A coluna redundante **Descritivo** foi removida da impressão A4, do CSV e da
mensagem do WhatsApp. O aviso de kit sem composição aparece junto a **Produto**.
A descrição segue persistida para auditoria e cubagem; as quantidades da lista
personalizada já pronta permanecem congeladas. O workflow ativo recebe o mesmo
formato pelo atualizador versionado, com backup anterior à publicação.

## Separação por produto físico

A RPC `olist_multichannel_separation_report` agora abre kits válidos conforme
`olist_products.payload.kit` antes de agrupar SKUs. O tipo dos itens no pedido
Olist não foi usado como detector: os kits do PDF chegaram marcados como `P`.
Vendas diretas e componentes de vários kits somam uma única linha física. Kits
sem composição ficam com o SKU comercial e o aviso **KIT SEM COMPOSIÇÃO NO
OLIST**. `expansion_sources` permite auditar os kits de origem.

O workflow n8n `UGLCLNS6oVCK87o3` foi atualizado antes da RPC, com backup local
em `tmp/n8n-backups/`. A mudança aceita o formato antigo e o novo durante a
transição. Tapetes simples seguem com seis pacotes por caixa. Componentes sem
cubagem ficam visíveis com zero caixas; potes marmita usam a cubagem explícita
do SKU simples quando existir e, provisoriamente, a menor capacidade física
derivada dos perfis de kit existentes (370 ml: 48;
640 ml: 30). É uma estimativa até o depósito medir a capacidade do SKU simples.

## Lista corrigida do PDF

A lista original `d70a93fc-f504-4779-bd3b-75881cbd184a` foi preservada com 25
linhas e 96 caixas. A nova lista personalizada
`440b3ca8-bdb1-41fa-9e16-6d9aab487d93` cobre 21/09 às 14:30 até 22/09 às
07:00 BRT e ficou `ready`: 1.271 pedidos, 50 linhas, 117 caixas e 4.075
unidades avulsas. `whatsapp_status = not_requested`; o cursor oficial não foi
acionado. A quantidade de pedidos subiu de 1.265 no documento original para
1.271 porque seis pedidos foram observados pela base depois da emissão do PDF.

Na janela atualizada, o SKU físico `213169` soma 94 pacotes: 20 vendas diretas,
62 do kit `213849` e 12 do kit `213851`, totalizando 15 caixas e 4 pacotes.
`213877` soma 442 potes de seis kits comerciais; `213878` soma 210 potes de
três kits. O kit misto `216478` gerou seis SKUs físicos separados. A prévia n8n
e a lista persistida têm as mesmas 50 linhas, com zero divergência em SKU,
descrição, quantidade, caixas e avulsos.

## Validação e publicação

- Migration testada em transação com `ROLLBACK` antes da aplicação e consultada
  novamente após a publicação no banco vinculado.
- Quatro testes do consolidado n8n, 85 testes de domínio, typecheck e build
  Next.js aprovados.
- Impressão A4, CSV e WhatsApp usam **Unidades a separar**. O CSV e o WhatsApp
  derivam da lista congelada quando ela é enviada.
- Frontend publicado pelo Vercel CLI no deploy
  `dpl_GmoHJhsJ44T4okAxvHqXrkrQpSxL`, estado `READY`, com alias de produção
  `https://oraculo.oliverhome.com.br`.
- PDF A4 corrigido gerado a partir da lista persistida em
  `output/pdf/lista-separacao-corrigida-2026-09-22.pdf` e inspecionado nas duas
  páginas: os kits válidos não aparecem e os SKUs físicos estão legíveis.
- Arquivos de continuidade: `docs/logistica-separacao.md` e
  `scripts/separation/update-n8n-workflow.mjs`.
