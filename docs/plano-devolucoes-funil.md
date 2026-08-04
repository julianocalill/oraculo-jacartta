# Funil de devoluções — avaliação da proposta e desenho recomendado

Status: **implementado** (2026-08-04) — funil em produção em `/devolucoes`, com
os três canais. Este documento registra a avaliação da proposta original e o
raciocínio que levou ao desenho final; os números abaixo são da primeira carga
(só TikTok). Números atuais, com os três canais: `docs/project-status-2026-08-04.md`.

**Uma correção posterior:** o funil entregue tem um estágio a mais do que o
proposto aqui — `cancelada` (523 casos em julho). Sem ele os estágios de decisão
somavam 2.673 contra um topo de 3.196: 16% sumindo sem explicação.

## A pergunta

Proposta original: funil de 3 estágios —
topo = devoluções abertas · meio = disputas em aberto · fundo = ganhas e perdidas.

## Resposta curta

**A forma de funil faz muito sentido. Os três estágios propostos, não.**

O problema é o estágio do meio. Disputa não é uma etapa por onde a devolução
passa — é um desvio raro. Medido em julho:

| | devoluções | % |
|---|---|---|
| Sem disputa nenhuma | 1.633 | **94,5%** |
| Com disputa | 95 | 5,5% |
| **Disputas em aberto (o "meio" proposto)** | **1** | **0,06%** |

Um funil desenhado assim mostraria 1.728 → 1 → 80. Visualmente isso comunica
"perdemos 99,9% no meio do caminho", que é falso: a devolução não morre na
disputa, ela simplesmente nunca passa por lá. Funil só é honesto quando o topo
realmente escoa pelos estágios de baixo.

E o fundo ficaria fino demais para uma tela: **11 ganhas contra 69 perdidas** no
mês inteiro. Não sustenta um dashboard como estrutura principal.

## O funil que os dados sustentam

Existe um funil de verdade aqui, e ele é melhor que o proposto porque cobre
**100% do volume** e termina em dinheiro. O que decide o caso não é a disputa —
é a **decisão de reembolso**, que toda devolução tem e todo canal expõe.

```
TOPO      Devoluções abertas no período              1.728    R$ 82.757
            |
ESTÁGIO 2 Aguardando decisão                          326    R$ 15.613
            |
ESTÁGIO 3 Decidido
            ├── Reembolso RECUSADO (retivemos)        635    R$ 30.960   ← ganhamos
            └── Reembolso CONCEDIDO (pagamos)         767    R$ 36.184   ← perdemos
                  |
ESTÁGIO 4       Dos concedidos, o produto voltou?
                  ├── refund only (não volta)         213    R$ 10.762
                  └── devolução com produto           554    R$ 25.422
                        ├── NF de devolução confere   253    R$ 10.849
                        ├── divergência qtd/valor      55    R$  4.027
                        ├── SEM NF de devolução        86    R$  3.686   ← ação
                        └── sem NF de venda (lastro)  166    R$  7.414
                  |
ESTÁGIO 5       Recuperado do marketplace              35    R$  2.429
```

Os três primeiros estágios **particionam o total exatamente**
(326 + 635 + 767 = 1.728), que é o que torna o funil legítimo.

Por que este desenho é melhor:

- **Cobre todo o volume**, não 5,5% dele.
- **Termina em R$**, e num R$ acionável: os R$ 3.686 sem NF de devolução são
  produto que o cliente devolveu e não deu entrada no estoque.
- **Funciona para todos os canais.** "Reembolso concedido/recusado" existe na
  Shopee e no Mercado Livre. "Disputa ganha/perdida" tem regra e vocabulário
  diferentes em cada um — um funil ancorado em disputa nasceria preso ao TikTok.
- O estágio 4 é a informação que **só nós temos** — nenhum painel de
  marketplace cruza devolução com nota fiscal.

## Disputa entra como painel lateral, não como estágio

A informação de disputa é valiosa, só não é o eixo. Vira um bloco próprio:

| resultado | devoluções | R$ |
|---|---|---|
| Support for seller (ganhamos) | 11 | 962 |
| Dispute closed (encerrada, reembolso recusado) | 14 | 672 |
| Support for customer (perdemos) | 69 | 3.840 |
| Disputing (em aberto) | 1 | 15 |

Taxa de vitória: **14%** contando só "support for seller", **26%** se
"dispute closed" for considerada favorável — o campo não diz explicitamente
quem ganhou, e essa ambiguidade precisa ser resolvida com quem opera o TikTok
antes de virar número de tela.

Com 80 disputas decididas por mês, o valor deste bloco é **tendência ao longo
dos meses**, não o número de um mês isolado.

## Ressalvas que precisam estar na tela

1. **É distribuição de estado, não coorte.** As 326 aguardando decisão ainda vão
   virar aceita ou recusada. Comparar meses fechados; no mês corrente o topo
   está sempre inflado em relação ao fundo.
2. **Hoje o funil é só TikTok.** Shopee e ML só entram quando as fases 5 e 6 do
   plano principal estiverem prontas. A tela precisa dizer isso, não deixar
   parecer que a empresa devolve 1.728 itens por mês.
3. **Os 262 "sem NF de venda" não são furo** — a base de NFs da Olist começa em
   junho/2026 e a venda é anterior. Devem aparecer como "sem lastro", em cor
   neutra, separados do que é problema real.
4. **`Refund rejected` como "ganhamos" merece cuidado.** Reembolso recusado é
   dinheiro retido, mas pode virar disputa ou insatisfação depois. É vitória
   financeira, não necessariamente vitória com o cliente.

## O que eu recomendo

Funil de 5 estágios acima como elemento principal da aba, disputa como painel
lateral com leitura de tendência, e as quatro ressalvas escritas na tela em vez
de implícitas.

Se você preferir manter disputa no eixo central, dá para fazer — mas aí sugiro
que seja **uma tela de disputas**, alimentada por vários meses, e não um funil:
com 95 casos por mês o formato de funil vai enganar mais do que informar.

## Decisões que dependem de você

1. "Dispute closed" conta como vitória nossa ou como neutro?
2. O funil deve abrir por loja (Donacor / Aliver / Jacartta) ou só consolidado?
3. Manter os R$ ao lado da contagem em todos os estágios, ou só no fundo?
