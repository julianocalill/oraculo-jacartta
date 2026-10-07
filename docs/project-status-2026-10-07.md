# Estado do projeto — 07/10/2026

## Calculadora — origem do produto e DIFAL

Implementação e deploy solicitados em 07/10. **Publicação em andamento**. Produção
anterior: [status de 03/10](project-status-2026-10-03.md).

- Origem Nacional/Importado em Dados do produto. Cenário inicial Nacional,
  venda para outro estado, ICMS interno 18% e interestadual 12%: preserva os
  6% de DIFAL e o resultado anterior. Importado começa com 4%: DIFAL 14%.
- Ambas as alíquotas são editáveis; os 18% são ilustrativos. Nacional pode
  usar 7%/12% conforme origem/destino. Importado adquirido no Brasil mantém
  origem estrangeira; exceções aos 4% precisam da alíquota aplicável.
- `DIFAL = máximo(interno − interestadual, 0)`. A taxa calculada aparece
  somente leitura; Taxa manual preserva estimativa digitada (inicial 6%)
  independentemente da origem. Mesmo estado aplica zero em qualquer modo.
- Alíquota interestadual editada é preservada por origem ao alternar.
  Trocar marketplace mantém o cenário fiscal. Restaurar padrão restaura
  taxas, modo por alíquotas e comissões, preservando origem/destino escolhidos.
- A taxa aplicada é compartilhada pelo preço direto, markup, lucro líquido
  desejado e decomposição, incluindo envio e afiliado quando presentes.
- ICMS MG 1,3% continua custo simplificado separado. Não é a alíquota nominal
  para subtrair no DIFAL. O aumento do DIFAL isolado não implica aumento da
  carga total de ICMS no regime comum, em que a parcela de origem diminui.
- Escopo: simulação de venda a consumidor final não contribuinte, sobre o
  preço, sem apuração de FCP, benefícios, ST, NCM ou tabela de UFs. A calculadora
  mantém suas regras próprias, sem alteração no motor fiscal ou banco.

### Fontes verificadas em 07/10/2026

- [Portal oficial DIFAL](https://dfe-portal.svrs.rs.gov.br/Difal/BaseLegal):
  alíquotas interestaduais 7%/12% e importados 4%, legislação por destino.
- [SEFAZ/SP — RC 1391/2013](https://legislacao.fazenda.sp.gov.br/Paginas/RC1391_2013.aspx):
  regra dos 4%, industrializados com conteúdo importado superior a 40%,
  exceções (lista Camex sem similar nacional, PPB, gás natural importado).
- [LC 190/2022](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp190.htm):
  vendas interestaduais a consumidor final e diferença entre alíquotas.

### Validação

- `node --test tests/calculadora-*.test.cjs`: 21 testes passaram. Incluem
  cenários 6%/11%/14%, destino a 20%, diferença negativa, taxa manual,
  mesmo estado e lucro nos três modos. Para cada marketplace, varrem todos
  os preços em centavos abaixo da sugestão para confirmar o menor preço
  que atinge 20% de margem com DIFAL de importados.
- `node --test 'packages/domain/*.test.js'`: 110 testes passaram.
- TypeScript (`apps/web/node_modules/typescript/bin/tsc --noEmit`): passou.
- Interface local: origem, nacional a 7%, importado a 4%, edição manual e
  mesmo estado conferidos no componente real. A rota autenticada local tem
  ciclo de redirecionamentos entre `/calculadora` e `/o/uberlandia/calculadora`;
  validação usou rota temporária de prévia, removida antes da entrega.
- `node node_modules/next/dist/bin/next build` em `apps/web`: passou,
  incluindo lint/tipos e geração das páginas. Aviso preexistente de
  `metadataBase`, sem erro. A rota temporária de prévia não está no build.
- Conferência de restauração e preço por margem: importado a 4%, custo R$ 50,
  Shopee e meta 20% resultam em preço R$ 187,24 e lucro R$ 37,45.
- Desktop e celular 390×844 conferidos no componente real; celular com
  `clientWidth = scrollWidth = 390`, sem rolagem horizontal. Registros:
  [desktop](analyses/calculadora-difal-2026-10-07/desktop.jpg) e
  [celular](analyses/calculadora-difal-2026-10-07/mobile.jpg).

O executável `pnpm` local não produziu saída; checks executados diretamente
com Node e os binários já instalados, sem mudar dependências.
Manifesto de novidades ajustado para 07/10 às 11:47 BRT.
Publicação autorizada pelo usuário; via dois remotes conforme deployment-map.
