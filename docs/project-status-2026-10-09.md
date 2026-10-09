# Estado do projeto — 09/10/2026

## Calculadora por operação — implementação local

Solicitação: uma calculadora para Uberlândia/Jacartta e outra para Giracasa,
porque as operações têm tratamentos distintos de ICMS. O usuário confirmou
que a Jacartta deve **manter os 1,3% de RET**, separados do ICMS normal da
Giracasa. Publicação solicitada pelo usuário; deploy em preparação.
Contexto anterior de produção: [status de 07/10](project-status-2026-10-07.md).

### Comportamento

- A mesma aba usa a operação autorizada obtida por `getRequestOperation()`:
  `/o/uberlandia/calculadora` e `/o/giracasa/calculadora`. Título e formulário
  identificam a empresa. Não há seletor fiscal que permita mudar a empresa
  sem usar a operação da sessão/URL.
- O componente recebe a operação por prop e usa `key={operation}`. Ao trocar
  a operação no shell, o formulário reinicia: custo, taxas editadas, origem,
  destino e marketplace não passam de uma empresa para a outra.
- Uberlândia: ICMS/RET Jacartta 1,3% inicial, editável; DIFAL separado, mantendo
  os resultados anteriores. Isso é premissa de precificação confirmada pelo
  usuário, não nova validação do regime especial.
- Giracasa: a saída usa a alíquota nominal interestadual escolhida no cenário
  (nacional 12% inicial, pode ajustar para 7%; importado 4% inicial, editável
  para exceções). Dentro de SP usa ICMS interno informado, 18% inicial.
- A linha “ICMS de saída Giracasa” é calculada e somente leitura; não usa RET.
  Os campos que determinam esse ICMS continuam disponíveis no DIFAL manual
  e na venda interna. Mesmo estado zera apenas DIFAL, mantendo ICMS de saída.
- Preço direto, markup, margem desejada e decomposição usam o mesmo ICMS da
  operação. Restaurar padrão respeita a empresa, origem e destino atuais.
- Limites: ICMS de saída bruto, **sem créditos de entrada de ICMS**; FCP,
  benefícios específicos, ST e NCM não são apurados. A alíquota interna inicial
  é cenário ilustrativo, não tabela universal. O limite aparece na tela.
- Regras continuam próprias da calculadora. Não altera nem importa o motor
  fiscal `packages/domain/fiscal.js`, e não lê/grava parâmetros do banco.
  O nome interno `icmsMg` é legado do contrato de cálculo; a taxa e o rótulo
  aplicados agora vêm do perfil de operação.

### Fontes

- Regra de operação já documentada em [giracasa-onboarding.md](giracasa-onboarding.md).
- [SEFAZ/SP — RICMS, artigo 52](https://legislacao.fazenda.sp.gov.br/Paginas/art052.aspx),
  verificado em 09/10: regras gerais de 18% interno, 7%/12% interestadual e
  4% para importados abrangidos pela Resolução 13/2012, com exceções.
- RET Jacartta de 1,3% mantido por confirmação direta do usuário nesta tarefa.

### Validação

- 35 testes da calculadora passaram. Incluem preservação de RET, ICMS nominal
  da Giracasa, ausência de RET adicional, venda interna e menor preço possível
  em centavos para margem de 20%, nos quatro presets e nas duas operações.
- 110 testes de domínio passaram. TypeScript passou.
- Prévia local com componente real e remount por operação confirmou:
  editar RET para 2% em MG não carrega essa taxa para SP; voltar para MG
  restaura 1,3%. Nacional/SP interestadual usa 12% + 6% DIFAL; importado usa
  ICMS 4%, com entrada nominal acessível no DIFAL manual; venda interna usa
  18% ICMS e zero DIFAL, inclusive para importados.
- Cenário original (custo R$ 50, preço R$ 125, Shopee, nacional, outro estado):
  Uberlândia mantém lucro R$ 12,94; Giracasa passa a −R$ 0,44 antes de eventuais
  créditos de entrada de ICMS.
- Build de produção passou, incluindo TypeScript e validação de rotas.
- Conferência responsiva em 390 × 844 passou nas duas operações: largura
  do documento e da tela de 390 px, sem rolagem horizontal. Evidências:
  [Giracasa desktop](analyses/calculadora-operacoes-2026-10-09/giracasa-desktop.jpg),
  [Uberlândia desktop](analyses/calculadora-operacoes-2026-10-09/uberlandia-desktop.jpg),
  [Giracasa celular](analyses/calculadora-operacoes-2026-10-09/giracasa-mobile.jpg) e
  [Uberlândia celular](analyses/calculadora-operacoes-2026-10-09/uberlandia-mobile.jpg).
- Rota temporária de prévia removida antes do build. Autenticação preservada.

Manifesto de novidades preparado para 09/10 às 14h40 BRT. Publicação pelos
dois remotes; confirmação de Ready e domínio será registrada após o deploy.
