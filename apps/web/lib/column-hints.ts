// Explicações dos cabeçalhos de tabela. Ficam num só lugar para que telas
// diferentes usem a mesma linguagem e toda coluna tenha ajuda visível.
export const HINTS = {
  commercialUnits: "Quantidade dos itens vinculados às NFs válidas do período. Item comercial preferencial; item fiscal como fallback. Kits e peças seguem a unidade da fonte.",
  commercialRevenue: "Receita da NF válida distribuída entre seus produtos, pela data de emissão. Não soma a venda Shopee direta novamente.",
  commercialPrice: "Receita faturada do SKU dividida pelas unidades apuradas no período.",
  commercialCost: "Custo líquido total das unidades vendidas, calculado pelo motor fiscal canônico com overrides e componentes de kits. Pendente se alguma linha não tem custo válido.",
  commercialTaxes: "ICMS, PIS/COFINS e DIFAL calculados pelo motor fiscal sobre as vendas do período.",
  commercialFees: "Comissão estimada pelas regras de cada marketplace no motor fiscal. Pendente quando falta configuração para alguma venda.",
  commercialProfit: "Receita menos custo líquido, impostos e comissão. Exibido somente quando todas as linhas do SKU têm custo e comissão. Não desconta Ads, despesas fixas, frete externo ou devoluções posteriores.",
  commercialMargin: "Resultado dividido pela receita do SKU neste período. Pendente se falta custo ou comissão em qualquer linha; não reutiliza margem de 30 dias.",
  costAuditGrossUsed:
    "Custo unitário de aquisição antes dos créditos tributários. Prioridade: correção manual, custo médio do ERP, custo cadastrado e, para kits, soma dos componentes.",
  costAuditNetUsed:
    "Custo bruto menos créditos recuperáveis de PIS/COFINS: 9,25% para nacional e 11,75% para importado. É este valor que entra em margem, lucro, ROI e recomendações.",
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
    "Preço do anúncio − custo unitário do livro de custos (cadastro manual > Olist > kits), já líquido dos créditos recuperáveis (−9,25% nacional, −11,75% importado). É margem bruta: não desconta comissão do marketplace, frete nem impostos.",
  enviar:
    "Quantidade sugerida: média/dia × (dias de estoque alvo + dias até a coleta/prazo) − estoque − trânsito.",
  vendaProtegida:
    "Unidades sugeridas × preço do anúncio: o faturamento que esse envio sustenta durante o horizonte escolhido.",
  custoEnvio:
    "Unidades sugeridas × custo unitário líquido de créditos: quanto de capital o envio consome. Aparece quando o SKU tem custo cadastrado.",
  situacao:
    "Urgência do item: Em ruptura (perdendo venda agora) > Crítico (rompe antes da próxima reposição chegar) > Abaixo do alvo > Fora do Full/oportunidade.",
  armazem: "Centro de distribuição da Shopee onde este SKU está estocado (BRFSP1 = São Paulo, BRFMG1 = Minas, etc.).",
  vendasFbs:
    "Unidades vendidas nos últimos 30 / 60 dias neste armazém, conforme informado pela própria Shopee.",
  mediaDiaFbs:
    "Velocidade de venda (selling_speed) calculada pela própria Shopee para este SKU no armazém.",
  coberturaFbs:
    "Cobertura em dias calculada pela própria Shopee (coverage_days), considerando estoque vendável + entrada pendente.",
  vendavelFbs:
    "Unidades livres para receber novas vendas neste armazém da Shopee.",
  reservadoFbs:
    "Unidades já comprometidas com pedidos e, portanto, fora do saldo vendável.",
  naoVendavelFbs:
    "Unidades no armazém bloqueadas para venda, por exemplo por avaria ou inspeção.",
  vendavelTotalShopee:
    "Total disponível para novas vendas em todas as localizações do anúncio, já descontadas as reservas.",
  ultimaVenda: "Dias desde a última venda registrada. 'nunca' = sem venda no histórico sincronizado.",
  acaoSugerida:
    "Heurística: mais de 120 dias sem venda → avaliar retirada; item Curva A parado → investigar antes de dar desconto; demais → ativar promoção.",
  estoqueFull: "Unidades disponíveis para venda no centro de distribuição do Mercado Livre.",
  origem: "Full = estoque no centro de distribuição do Mercado Livre. Local = estoque próprio, enviado por você.",
  variacao: "Cor/tamanho/modelo do anúncio. A ruptura acontece por variação: o anúncio segue ativo enquanto uma variação já zerou.",
  prevMediaSemana:
    "Unidades por semana: total vendido nas últimas semanas completas da base (até 4) ÷ semanas consideradas (SKU novo divide só pelas semanas em que existiu).",
  prevPrevisao:
    "Média semanal × tendência geral. A tendência compara a média das últimas 4 semanas com as 4 anteriores, limitada a ±30%; sem 4 anteriores no histórico, tendência = 1.",
  prevFaixa:
    "Cenários baixo e alto: previsão × (1 ± variação típica das últimas 8 semanas). É a incerteza esperada, não um limite garantido.",
  prevTendencia:
    "Razão entre a média das 4 últimas semanas do próprio canal e as 4 anteriores, limitada a ±30%. Informativa: a previsão por canal usa o share, não esta razão.",
  prevPeso:
    "Participação deste dia da semana nas unidades das semanas completas do histórico (até 8). A soma dos 7 dias é 100%.",
  prevSemanaBase:
    "Semanas usadas no cálculo. O histórico começa em 20/07/2026; semana anterior a 03/08 só entra quando a cobertura de itens dela atinge 90% (o backfill reescreve julho automaticamente). Cobertura abaixo de 90% gera aviso na tela.",
  reconciliacaoData: "Data de criação do pedido Shopee. É esta data que o filtro de período usa.",
  reconciliacaoBruto: "Valor total pago no pedido Shopee antes das deduções do repasse.",
  reconciliacaoNf: "Soma de olist_invoices.total_amount das NFs de venda válidas ligadas a este pedido.",
  reconciliacaoAReceber: "Líquido do escrow quando liberado ou valor estimado pela Shopee enquanto o pedido está pendente.",
  reconciliacaoPago: "Crédito efetivo ESCROW_VERIFIED_ADD lançado no saldo da carteira para este pedido.",
  reconciliacaoSaldo: "Saldo total da carteira logo após o crédito. Não é o valor pago deste pedido."
} as const;

const GLOBAL_COLUMN_HINTS: Record<string, string> = {
  "": "Ações disponíveis para este registro.",
  "#": "Posição desta linha na ordenação atual da tabela.",
  "acao": "Ação disponível para este registro.",
  "acao sugerida": HINTS.acaoSugerida,
  "acoes": "Ações disponíveis para consultar ou alterar este registro.",
  "alerta": "Aviso que identifica o risco ou a pendência desta linha.",
  "anuncio": "Anúncio do marketplace ao qual os números desta linha pertencem.",
  "anuncio e justificativa": "Anúncio do Mercado Livre acompanhado do motivo que levou à sugestão de envio.",
  "afiliado": "Pessoa afiliada à qual este registro e seus valores pertencem.",
  "afiliados": "Quantidade de afiliados distintos incluídos neste lote.",
  "armazem": HINTS.armazem,
  "atrasados": "Quantidade de registros cujo prazo operacional já venceu.",
  "atualizado": "Data e hora da última atualização deste registro.",
  "bl": "Número do Bill of Lading, documento de transporte internacional da carga.",
  "bruto": "Valor total antes das deduções mostradas nesta tela.",
  "campo": "Campo do arquivo ou cadastro relacionado à ocorrência.",
  "canal": "Canal de venda ou marketplace ao qual esta linha pertence.",
  "capital": "Valor do estoque calculado pelo custo unitário usado pelo Oráculo.",
  "capital parado": HINTS.capitalParado,
  "casos": "Quantidade de ocorrências agrupadas nesta linha.",
  "chegada": "Data de chegada registrada ou prevista para a carga.",
  "chegada prevista": "Previsão mais recente de chegada da carga ao destino.",
  "checagem": "Resultado da conferência automática dos dados desta linha.",
  "chave": "Indica se a coluna participa de uma chave primária ou estrangeira no banco.",
  "cobertura": HINTS.cobertura,
  "coluna": "Nome técnico da coluna no banco de dados.",
  "colunas": "Quantidade total de colunas do objeto do banco.",
  "comissao": "Valor ou percentual de comissão aplicado a esta linha.",
  "competencia": "Mês de referência dos pagamentos e retenções deste lote.",
  "concluida": "Data em que o processo foi concluído; vazio significa que continua aberto.",
  "conferido": "Quantidade já contada e confirmada no recebimento.",
  "container": "Identificação do contêiner que transporta a carga.",
  "conteiner": "Identificação do contêiner que transporta a carga.",
  "cpf": "CPF do afiliado usado para identificar e emitir o recibo.",
  "curva": HINTS.curva,
  "custo": "Custo atribuído aos produtos ou unidades desta linha.",
  "custo unit": "Custo por unidade usado no cálculo desta linha.",
  "custo unitario": "Custo por unidade usado no cálculo desta linha.",
  "custo do envio": HINTS.custoEnvio,
  "data": "Data de referência usada para agrupar ou filtrar esta linha.",
  "descricao": "Explicação funcional deste objeto, campo ou registro.",
  "descritas": "Quantidade de colunas que já possuem descrição no catálogo do banco.",
  "destino": "Local de destino informado para a carga.",
  "devolucoes": "Quantidade de devoluções agrupadas nesta linha.",
  "dia": "Dia de referência dos valores apresentados nesta linha.",
  "disponivel": "Quantidade disponível em estoque para venda.",
  "divergencias": "Quantidade de registros cuja conferência encontrou diferença.",
  "efetiva": "Alíquota efetiva resultante das regras tributárias cadastradas.",
  "embalagem": "Custo de embalagem aplicado por item vendido.",
  "enviar": HINTS.enviar,
  "erro": "Erro encontrado no processamento ou diferença percentual da previsão, conforme a tela.",
  "esperado": "Quantidade que deveria ser recebida segundo a fatura.",
  "estoque": "Quantidade disponível no estoque considerado por esta tela.",
  "estoque atual": "Saldo de estoque disponível no momento da última atualização.",
  "estoque full": HINTS.estoqueFull,
  "estornado": "Valor devolvido ou estornado ao comprador.",
  "fatura": "Fatura de importação ou referência financeira associada a esta linha.",
  "fim atividade": "Horário de término; durante uma execução, mostra a atividade mais recente.",
  "fonte": "Sistema de origem do dado apresentado nesta linha.",
  "frete item": "Custo de frete parametrizado para cada item vendido.",
  "funcao": "Nome da função do banco de dados disponível para consulta.",
  "icms": "Valor de ICMS calculado para esta linha.",
  "importado": "Data e hora em que o arquivo ou lote foi importado.",
  "imposto": "Percentual de imposto configurado para este canal.",
  "impostos": HINTS.commercialTaxes,
  "inicio": "Data e hora em que a execução começou.",
  "inss": "Retenção de INSS calculada para o afiliado neste pagamento.",
  "irrf": "Retenção de Imposto de Renda calculada para o afiliado neste pagamento.",
  "iss": "Retenção de ISS calculada para o afiliado neste pagamento.",
  "item": "Produto ou item vinculado a esta linha.",
  "itens": "Quantidade de itens vinculados a este registro.",
  "linha": "Número da linha no arquivo importado.",
  "linhas": "Quantidade de linhas de dados representadas por este agrupamento.",
  "linhas aprox": "Estimativa de linhas atualmente armazenadas no objeto do banco.",
  "liquido": "Valor restante depois das deduções aplicadas nesta tela.",
  "loja": "Loja ou conta do marketplace à qual esta linha pertence.",
  "margem": "Percentual da receita que sobra após os custos e descontos considerados pela tela.",
  "margem fiscal": "Margem calculada pelo motor fiscal sobre as notas válidas cobertas por custo.",
  "margem unit": HINTS.margemUnit,
  "media dia": HINTS.mediaDia,
  "media diaria": "Média de unidades vendidas por dia usada para estimar a duração do estoque.",
  "media mensal": "Média diária multiplicada por 30 dias.",
  "meta": "Meta de margem configurada para sinalizar o desempenho desejado.",
  "min": "Margem mínima aceitável antes de o item entrar em alerta.",
  "motivo": "Motivo informado ou classificado para esta ocorrência.",
  "navio": "Navio associado ao transporte desta carga.",
  "nf": "Valor ou identificação da nota fiscal associada a esta linha.",
  "nome": "Nome legível usado para identificar este cadastro.",
  "notas fiscais": "Quantidade de notas fiscais válidas incluídas no agrupamento.",
  "nulo": "Indica se o banco permite que esta coluna fique sem valor.",
  "objeto": "Tabela ou visão do banco de dados descrita nesta linha.",
  "obs": "Observação cadastrada para contextualizar esta regra.",
  "ocorrencia": "Problema ou aviso encontrado nessa linha do arquivo.",
  "origem": "Origem operacional, fiscal ou logística informada para este registro.",
  "pagamento": "Custo ou taxa de processamento do pagamento configurado para o canal.",
  "papel": "Indica como esta semana participa do cálculo: base atual ou comparação anterior.",
  "parametros": "Parâmetros aceitos pela função do banco.",
  "participantes": "Pessoas que podem acompanhar e atualizar esta tarefa.",
  "pedidos": "Quantidade de pedidos distintos representados nesta linha.",
  "perda dia": HINTS.perdaDia,
  "prazo": "Data ou horário limite para concluir esta atividade.",
  "preco": "Preço de venda considerado nesta linha.",
  "produto": "Produto ao qual os valores desta linha pertencem.",
  "produto e justificativa": "Produto Shopee acompanhado do motivo que levou à sugestão de reposição.",
  "qtd": "Quantidade de unidades deste item.",
  "quantidade": "Quantidade de unidades vendidas ou movimentadas nesta linha.",
  "recibo": "Número ou link do recibo individual gerado para o afiliado.",
  "receita": "Valor de vendas atribuído a esta linha no período da tela.",
  "receita 30d": "Receita atribuída ao produto nos últimos 30 dias.",
  "registros": "Quantidade de registros processados pela execução.",
  "retencoes": "Soma das retenções legais descontadas do valor bruto.",
  "repor": HINTS.enviar,
  "retorna": "Tipo de dado devolvido pela função do banco.",
  "roi": "Retorno sobre o custo: resultado dividido pelo custo considerado.",
  "sem nf": "Quantidade de casos sem a nota fiscal exigida para a conferência.",
  "share": "Participação percentual desta linha no total apresentado.",
  "sinal": "Classificação de saúde do estoque segundo saldo e cobertura.",
  "situacao": HINTS.situacao,
  "sku": "Código usado para identificar o produto no sistema de origem.",
  "sku produto": "SKU e nome usados para identificar o produto no catálogo.",
  "status": "Situação atual do registro segundo as regras desta tela.",
  "status margem": "Sinal da margem comparada às metas e à disponibilidade de custo.",
  "sync": "Rotina de sincronização ou atualização monitorada nesta linha.",
  "tamanho": "Espaço aproximado ocupado pelo objeto no banco de dados.",
  "tarefa": "Título da tarefa compartilhada.",
  "taxas": "Total de taxas descontadas nesta linha.",
  "ticket": "Receita dividida pela quantidade de unidades vendidas.",
  "tipo": "Tipo ou categoria técnica deste registro.",
  "total caixa": "Quantidade total de caixas informadas nos itens da fatura.",
  "tendencia 120→0": HINTS.tendencia,
  "transito": HINTS.transito,
  "uf": "Estado ao qual a regra tributária se aplica.",
  "un": "Quantidade de unidades vendidas.",
  "un 30d": "Unidades vendidas nos últimos 30 dias.",
  "unid": "Quantidade de unidades vendidas nesta linha.",
  "unidades": "Quantidade de unidades representadas nesta linha.",
  "ultima venda": HINTS.ultimaVenda,
  "valor": "Valor monetário correspondente a esta linha.",
  "var": "Variação percentual da receita em relação ao período de comparação.",
  "var %": "Variação percentual da receita em relação ao período de comparação.",
  "variacao": HINTS.variacao,
  "venda protegida": HINTS.vendaProtegida,
  "vendas 30 60d": HINTS.vendas3060,
  "vendavel": "Unidades liberadas pelo armazém para venda imediata.",
  "vigencia": "Período em que esta regra permanece válida."
};

const PAGE_COLUMN_HINTS: Array<[string, Record<string, string>]> = [
  ["/analise-comercial", {
    "custo liquido": HINTS.commercialCost,
    "preco medio": HINTS.commercialPrice,
    "receita faturada": HINTS.commercialRevenue,
    "resultado": HINTS.commercialProfit
  }],
  ["/agenda", {
    "acoes": "Opções para abrir, editar ou concluir a tarefa.",
    "prazo": "Data limite da tarefa; tarefas vencidas e não concluídas ficam atrasadas."
  }],
  ["/curva-de-estoque", {
    "meses de cobertura": "Estoque atual dividido pela média mensal; estima por quantos meses o saldo deve durar."
  }],
  ["/curva-de-venda", {
    "acumulado": "Soma progressiva da participação dos produtos, usada para formar as curvas A, B e C.",
    "do volume": "Participação das unidades deste produto no total vendido da tabela.",
    "curva de venda": "Classificação ABC formada pela participação acumulada no volume vendido.",
    "data da ultima venda": HINTS.ultimaVenda,
    "nome do produto": "Nome do produto no catálogo Olist.",
    "quantidade em estoque": "Saldo disponível atual no Olist.",
    "unidades vendidas": "Unidades vendidas dentro do período usado pela curva."
  }],
  ["/devolucoes", {
    "contam como perda": "Casos em que o reembolso foi concedido; reembolso recusado e caso cancelado não entram na perda.",
    "custo perdido": "Custo unitário multiplicado pelas unidades que contam como perda.",
    "divergencias": "Casos em que a nota de devolução existe, mas o valor diverge da nota de venda além da tolerância.",
    "resultado": "Resultado da disputa: comprador favorecido, empresa favorecida ou sem decisão.",
    "r$ sem nf": "Valor dos casos que exigem nota de devolução e ainda não possuem uma nota conciliada.",
    "sem nf de devolucao": "Casos com retorno físico e reembolso concedido que ainda não têm NF de devolução conciliada.",
    "sem nf de venda": "Casos em que não foi possível localizar a NF original da venda.",
    "valor estimado pela nf": "Valor aproximado pela NF de venda quando o canal não informa o valor efetivamente reembolsado."
  }],
  ["/documentacao", {
    "camada": "Papel do objeto na arquitetura de dados: origem, canônica, derivada ou operacional.",
    "o que e": "Descrição resumida do objeto retornado pela consulta.",
    "tipo": "Tipo do objeto no Postgres, como tabela, visão, visão materializada ou função."
  }],
  ["/expedicao", {
    "coleta": "Pacotes cuja coleta pela transportadora já foi confirmada pela Shopee.",
    "comercial": "Pacotes confirmados pela leitura comercial do Bip.",
    "divergencias": "Diferença entre os totais das etapas que deveriam estar conciliadas.",
    "logistica": "Pacotes confirmados no recebimento da área de logística.",
    "pacotes": "Pacotes Shopee pagos que compõem o funil de expedição.",
    "pacotes com prazo": "Pacotes pagos que possuem prazo de envio informado pela Shopee.",
    "pedidos pagos": "Pedidos com pagamento confirmado na data desta linha.",
    "rastreio": "Código usado para acompanhar o pacote no fluxo de expedição.",
    "unidades vendidas": "Soma das unidades dos pedidos pagos na data desta linha."
  }],
  ["/importacoes", {
    "acao": "Atalho para abrir ou editar o cadastro desta importação.",
    "itens": "Quantidade de produtos diferentes cadastrados na fatura.",
    "origem": "Porto ou país de origem da carga.",
    "qtd": "Quantidade de caixas ou unidades informada para o item."
  }],
  ["/logistica/recebimento", {
    "conferido": "Total já confirmado fisicamente durante o recebimento.",
    "esperado": "Total previsto pelos itens da fatura de importação."
  }],
  ["/mais-vendidos", {
    "cobertura": "Percentual dos pedidos cuja quantidade de itens já foi sincronizada; abaixo de 100%, o ranking é um piso.",
    "part pedidos": "Participação dos pedidos desta loja no total do período.",
    "quantidade": "Unidades vendidas; pode ser parcial quando a cobertura de itens não chegou a 100%."
  }],
  ["/parametros", {
    "bruto usado": HINTS.costAuditGrossUsed,
    "corrigir": "Abre o cadastro de correção manual do custo deste SKU.",
    "corrigir custo": "Atalho para cadastrar o custo ausente ou revisar o custo deste SKU.",
    "custo cadastrado": "Custo unitário de aquisição cadastrado no ERP antes dos créditos tributários.",
    "custo medio": "Custo médio unitário informado pelo ERP; zero é tratado como não preenchido.",
    "custo override": "Custo bruto manual que tem prioridade sobre as demais fontes.",
    "difal": "Diferença entre o ICMS interno do destino e o interestadual, limitada ao mínimo de zero.",
    "icms interest": "Alíquota interestadual usada quando a venda sai para outra UF.",
    "icms interno": "Alíquota interna da UF de destino.",
    "icms saida": "Alíquota de ICMS aplicada à saída conforme a origem da operação.",
    "liquido usado": HINTS.costAuditNetUsed,
    "receita afetada": "Receita das vendas cuja margem depende da correção deste custo.",
    "situacao": "Diagnóstico da qualidade do custo e da necessidade de revisão."
  }],
  ["/previsao-de-vendas", {
    "cobertura de itens": HINTS.prevSemanaBase,
    "erro": "Diferença percentual entre o realizado e a previsão central; positivo vendeu acima, negativo abaixo.",
    "faixa": HINTS.prevFaixa,
    "media historica": "Média de unidades vendidas neste dia da semana dentro da base considerada.",
    "media semana": HINTS.prevMediaSemana,
    "na faixa": "Indica se o realizado ficou entre os cenários baixo e alto previstos.",
    "peso do dia": HINTS.prevPeso,
    "previsao": HINTS.prevPrevisao,
    "realizado": "Unidades que foram efetivamente vendidas na semana usada para o backtest.",
    "semana": "Intervalo semanal usado na base ou na validação da previsão.",
    "tendencia do canal": HINTS.prevTendencia,
    "unidades na base": "Total de unidades do canal ou SKU nas semanas usadas como histórico."
  }],
  ["/reconciliacao", {
    "a receber": HINTS.reconciliacaoAReceber,
    "bruto": HINTS.reconciliacaoBruto,
    "data": HINTS.reconciliacaoData,
    "liberacao": "Previsão de liberação informada pela Shopee; zero significa aguardando conclusão.",
    "nf": HINTS.reconciliacaoNf,
    "pago carteira": HINTS.reconciliacaoPago,
    "pedido": "Identificador do pedido Shopee usado na conciliação.",
    "saldo apos": HINTS.reconciliacaoSaldo
  }],
  ["/rpa", {
    "bruto": "Valor bruto devido ao afiliado antes das retenções.",
    "liquido": "Valor bruto menos INSS, IRRF e ISS calculados por linha.",
    "loja": "Loja Shopee de origem do relatório mensal.",
    "ocorrencia": "Descrição da inconsistência encontrada durante a importação.",
    "retencoes": "Total de INSS, IRRF e ISS retidos no lote."
  }],
  ["/shopee/precos", {
    "anuncios": "Quantidade de anúncios Shopee ligados ao mesmo SKU Olist.",
    "anuncios em prejuizo": "Quantidade de anúncios cujo lucro estimado por venda é negativo.",
    "checagem": "Validação do vínculo e dos dados necessários para confiar no lucro calculado.",
    "custo total": "Custo unitário multiplicado pela quantidade vendida no anúncio.",
    "lucro periodo": "Soma do lucro estimado das vendas do SKU no período.",
    "lucro venda": "Preço menos taxas, impostos e custo dos produtos de uma venda.",
    "melhor lucro venda": "Maior lucro estimado por venda entre os anúncios ligados ao SKU.",
    "pior lucro venda": "Menor lucro estimado por venda entre os anúncios ligados ao SKU.",
    "sku olist": "SKU canônico do Olist usado para custo e consolidação dos anúncios.",
    "vendas periodo": "Unidades vendidas pelo anúncio no período selecionado.",
    "vendas periodo un olist": "Unidades Olist usadas para estimar o lucro consolidado do período.",
    "⚠": "Indica que esta linha possui uma pendência ou ressalva de qualidade do dado."
  }],
  ["/shopee", {
    "bruto": "Valor bruto dos pedidos antes das taxas, vouchers e demais deduções.",
    "comissao": "Comissão cobrada pela Shopee nos pedidos desta linha.",
    "custo": "Custo líquido dos produtos vendidos, quando o SKU possui custo resolvido.",
    "lucro liq": "Valor líquido recebido menos o custo dos produtos vendidos.",
    "taxa servico": "Taxa de serviço cobrada pela Shopee além da comissão.",
    "take rate": "Total de taxas Shopee dividido pelo valor bruto dos pedidos.",
    "voucher shopee": "Valor de vouchers subsidiados pela Shopee, separado das deduções da loja."
  }],
  ["/status", {
    "cobertura": "Intervalo de dados que a rotina informa ter processado.",
    "erro": "Mensagem da falha mais recente; vazio quando a execução terminou sem erro.",
    "fim atividade": "Fim da execução ou horário da última atividade registrada enquanto ela roda.",
    "status": "Saúde da rotina calculada pelo resultado, atividade e atraso esperado."
  }]
];

function normalizeColumnLabel(label: string) {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[/?().%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function operationlessPath(pathname: string) {
  return pathname.replace(/^\/o\/[^/]+(?=\/|$)/, "") || "/";
}

export function getColumnHint(label: string, pathname = "") {
  const normalized = normalizeColumnLabel(label);
  const currentPath = operationlessPath(pathname);

  for (const [route, hints] of PAGE_COLUMN_HINTS) {
    if ((currentPath === route || currentPath.startsWith(`${route}/`)) && hints[normalized]) {
      return hints[normalized];
    }
  }

  return GLOBAL_COLUMN_HINTS[normalized]
    ?? `Mostra ${label.trim() ? `o valor de “${label.trim()}”` : "as ações disponíveis"} para cada linha desta tabela.`;
}
