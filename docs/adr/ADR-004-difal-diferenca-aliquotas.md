# ADR-004 — DIFAL pela diferença de alíquotas, sem base "por dentro"

- Status: aceito
- Data: 2026-08-14
- Pendência: parecer escrito do contador (ver "Consequências")

## Contexto

Desde 04/08/2026 o motor fiscal calculava o DIFAL com a base única "por dentro"
da LC 190/2022, na fórmula que a própria NF-e usa:

```text
base_destino = valor da NF ÷ (1 − alíquota interna do destino)
DIFAL        = máx(0, base_destino × interna − valor da NF × interestadual)
```

Essa regra foi adotada porque reproduz, no centavo, o que a NF real 533740
(Jacartta, 04/08/2026, MG→RJ, vNF R$ 44,51) traz impresso: `vBCUFDest` 57,06 e
`vICMSUFDest` 7,21.

Em 14/08/2026 o contador (Eduardo Faleiros) devolveu a planilha de ICMS
interestadual de saída de MG — `icms-interestadual-saida-mg.xlsx`, produzida pelo
Oráculo — com **uma única alteração**: as colunas de DIFAL das 26 linhas
interestaduais passaram de `interna ÷ (1 − interna) − interestadual` para
`interna − interestadual`. Nenhuma alíquota foi tocada.

## Decisão

O motor fiscal passa a calcular:

```text
DIFAL = valor da NF × máx(0, interna do destino − interestadual nominal)
```

- Continua existindo **somente em operação interestadual**: venda MG→MG é interna
  e não paga DIFAL.
- Continua usando as alíquotas **nominais** (4% importado; 7% ou 12% nacional,
  conforme o destino), e não a carga efetiva de 1,3% do RET.
- Continua respeitando `oraculo_state_tax_params` quando a linha estiver marcada
  como validada e vigente na data da nota.

Implementação: `supabase/migrations/20260814120000_difal_diferenca_aliquotas.sql`
(fonte de verdade) e `calcDifalDiferencaAliquotas` em `packages/domain/fiscal.js`.

## Alternativas descartadas

1. **Manter a base por dentro e tratar a edição como apresentação.** Descartada:
   a coluna alterada é a que o documento chama de "DIFAL efetivo sobre a NF", e a
   mudança veio de quem responde pela apuração.
2. **Adotar a diferença simples também dentro de MG.** Descartada: operação
   interna não gera diferencial. Era o defeito do porte original do app
   Financeiro (`calcDifal`), corrigido em 04/08 e mantido corrigido aqui.

## Consequências

**O motor deixa de bater com a NF em mais um campo, de propósito.** Para a NF
533740 o motor passa a calcular R$ 4,45 onde a nota imprime R$ 7,21 (−38%). O
DIFAL entra na mesma categoria em que o ICMS já estava: o painel mede a premissa
do contador, não o campo do documento fiscal. Isso está escrito na ressalva 3 de
`docs/explicacao-fiscal-oraculo.md` e nas notas do dashboard e de `/skus`.

**Impacto medido em produção** (01–14/08/2026, receita com custo R$ 3.824.978,14,
cobertura 96,5%):

| | Antes | Depois |
|---|---:|---:|
| DIFAL | R$ 570.891,62 | R$ 423.249,36 |
| Impostos totais | R$ 1.030.082,62 | R$ 882.440,36 |
| Lucro fiscal | −R$ 197.210,25 | −R$ 49.567,99 |
| Margem fiscal | −5,16% | −1,30% |
| ROI fiscal | −9,88% | −2,48% |

O prejuízo do período encolhe 75% e a leitura do negócio muda de tom, mas **não
vira lucro**: a operação coberta continua negativa, e o diagnóstico da auditoria
de 09/08 (Shopee negativa, comissão maior que a carga tributária) permanece.

**O que fica pendente:**

1. **O parecer por escrito.** Hoje a orientação existe como uma fórmula alterada
   numa planilha. Como o DIFAL é ~48% da carga tributária do motor, a
   justificativa técnica do contador precisa ser anexada a este ADR.
2. **O RET continua sem comprovação.** A edição do contador não tocou no ICMS de
   1,3%; a pendência da auditoria de 09/08 (íntegra do regime especial da IE
   004.052.627.00-39) segue aberta e as 54 linhas de `/parametros` seguem
   `Pendente`.
3. **Descontinuidade nos sparklines.** O histórico dos hero cards guarda a última
   captura de cada dia; as capturas anteriores a 14/08 ficaram com a regra antiga,
   então o gráfico de Impostos mostra um degrau por cerca de duas semanas.

## Referências

- Planilha do contador: `icms-interestadual-saida-mg.xlsx` (14/08/2026).
- Regra anterior: `calcDifalPorDentro` em `packages/domain/fiscal.js`, mantida como
  especificação histórica com os testes da NF 533740.
- LC 190/2022: https://planalto.gov.br/ccivil_03/leis/lcp/lcp190.htm
- Auditoria anterior: `docs/fiscal-audit-jacartta-2026-08-09.md`.
