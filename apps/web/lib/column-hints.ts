// Explicações das colunas calculadas (tooltip no hover do cabeçalho).
// Ficam num só lugar para que ML e Shopee digam exatamente a mesma coisa.
export const HINTS = {
  curva:
    "Curva ABC por faturamento dos últimos 30 dias: A = os produtos que somam os primeiros 80% da receita, B = os próximos 15%, C = os últimos 5%. Sem venda no período fica sem curva.",
  tendencia:
    "Unidades vendidas em 4 janelas de 30 dias, da mais antiga para a mais recente: 120-90 · 90-60 · 60-30 · 30-0 dias. Números subindo = produto ganhando tração; caindo = perdendo. Ordena pela variação da última janela contra a anterior.",
  vendas3060:
    "Unidades vendidas nos últimos 30 dias / nos últimos 60 dias. A janela de 60 dias é o critério de 'ainda tem procura' usado na ruptura.",
  mediaDia:
    "Velocidade de venda: unidades por dia calculadas apenas sobre os dias em que o item TINHA estoque. A média bruta do período subestima quem passou parte dele zerado.",
  perdaDia:
    "Média/dia × preço do anúncio: o faturamento que o item deixa de gerar a cada dia parado. Some 30 dias para ver o custo mensal da ruptura.",
  cobertura:
    "Quantos dias o estoque atual dura no ritmo de venda de hoje (estoque + trânsito ÷ média/dia). Vermelho abaixo de 7 dias, amarelo abaixo de 15.",
  transito:
    "Unidades já despachadas que ainda não chegaram. São somadas à cobertura e descontadas da sugestão para não pedir em dobro.",
  capitalParado:
    "Estoque × preço do anúncio: dinheiro imobilizado em produto que não está girando (e pagando armazenagem).",
  margemUnit:
    "Preço do anúncio − custo unitário do livro de custos (cadastro manual > Olist > kits). É margem bruta: não desconta comissão do marketplace, frete nem impostos.",
  enviar:
    "Quantidade sugerida: média/dia × (dias de estoque alvo + dias até a coleta/prazo) − estoque − trânsito.",
  vendaProtegida:
    "Unidades sugeridas × preço do anúncio: o faturamento que esse envio sustenta durante o horizonte escolhido.",
  custoEnvio:
    "Unidades sugeridas × custo unitário: quanto de capital o envio consome. Aparece quando o SKU tem custo cadastrado.",
  situacao:
    "Urgência do item: Em ruptura (perdendo venda agora) > Crítico (rompe antes da próxima reposição chegar) > Abaixo do alvo > Fora do Full/oportunidade.",
  armazem: "Centro de distribuição da Shopee onde este SKU está estocado (BRFSP1 = São Paulo, BRFMG1 = Minas, etc.).",
  vendasFbs:
    "Unidades vendidas nos últimos 30 / 60 dias neste armazém, conforme informado pela própria Shopee.",
  mediaDiaFbs:
    "Velocidade de venda (selling_speed) calculada pela própria Shopee para este SKU no armazém.",
  coberturaFbs:
    "Cobertura em dias calculada pela própria Shopee (coverage_days), considerando estoque vendável + entrada pendente.",
  ultimaVenda: "Dias desde a última venda registrada. 'nunca' = sem venda no histórico sincronizado.",
  acaoSugerida:
    "Heurística: mais de 120 dias sem venda → avaliar retirada; item Curva A parado → investigar antes de dar desconto; demais → ativar promoção.",
  estoqueFull: "Unidades disponíveis para venda no centro de distribuição do Mercado Livre.",
  origem: "Full = estoque no centro de distribuição do Mercado Livre. Local = estoque próprio, enviado por você.",
  variacao: "Cor/tamanho/modelo do anúncio. A ruptura acontece por variação: o anúncio segue ativo enquanto uma variação já zerou."
} as const;
