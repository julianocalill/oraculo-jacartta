import { normalizeBia } from './bia.js';

// Fixed read surfaces. A source inherits exactly the permission of its page.
// No URLs, schemas or tool names can be supplied by the model or browser.
export const BIA_SOURCES = (/** @type {Array<[string,string,string,string,string,string,string,[string,string]?]>} */ ([
  ['analytics','analytics','Analytics','/','analitico','analytics|dashboard|painel geral|impostos|tributos|fiscal|roi','Consolida a operação. Receita faturada e pedidos têm datas e critérios próprios.',['start','end']],
  ['analise-comercial','analise-comercial','Análise Comercial','/analise-comercial','comercial','analise comercial|faturamento|faturamos|receita|vendemos|vendas|unidades|margem|lucro|produtos vendidos|ranking','Faturamento por emissão de NF válida. Margem cobre custo e comissão disponíveis; não representa lucro líquido total.',['start','end']],
  ['ads','ads','Shopee Ads','/ads','comercial','ads|roas|campanhas|campanha|publicidade|anuncios|cliques|ctr','ROAS direto é a receita atribuída ao produto anunciado dividida pelo investimento. Dias não coletados não equivalem a gasto zero.',['start','end']],
  ['pedidos','pedidos','Pedidos','/pedidos','comercial','pedidos|pedido|cancelamentos|ticket medio','Apura pedidos pela data do pedido. Essa contagem é diferente das notas fiscais emitidas.',['start','end']],
  ['mais-vendidos','mais-vendidos','Mais Vendidos','/mais-vendidos','analitico','mais vendidos','Ranking da janela indicada na tela. A lista exibida não representa todo o catálogo.'],
  ['skus','skus','SKUs','/skus','analitico','skus|rentabilidade|custo unitario|preco de custo','Analisa o SKU com os critérios e a janela da tela. Custo ou margem pendente não deve ser tratado como zero.'],
  ['curva-de-venda','curva-de-venda','Curva de Venda','/curva-de-venda','analitico','curva de venda|curva abc|classificacao abc','ABC classifica a participação dos produtos na venda. Verifique se a tela usa receita ou volume.',['de','ate']],
  ['curva-de-estoque','curva-de-estoque','Curva de Estoque','/curva-de-estoque','analitico','curva de estoque','Mostra a distribuição atual do estoque. Estoque disponível, reservado e trânsito são posições diferentes.'],
  ['previsao-de-vendas','previsao-de-vendas','Previsão de Vendas','/previsao-de-vendas','analitico','previsao|prever|projecao','Previsão é uma estimativa, com semana-alvo e backtest. Não é venda medida.'],
  ['shopee','shopee','Shopee','/shopee','comercial','shopee','Analítica do canal Shopee; não deve ser somada novamente ao faturamento Olist, que já emite as NFs dessas vendas.'],
  ['shopee-estoque','shopee','Estoque Shopee','/shopee/estoque','comercial','estoque shopee|estoque da shopee|fbs|armazem shopee','Saldo por armazém: vendável, reservado, trânsito e não vendável têm significados distintos.'],
  ['shopee-reposicao','shopee','Reposição Shopee','/shopee/reposicao','comercial','reposicao shopee|repor shopee','Sugestão de reposição é calculada a partir de venda e cobertura; não cria remessa nem compra.'],
  ['shopee-precos','shopee','Preços Shopee','/shopee/precos','comercial','precos shopee|preco shopee','Preços exibidos pelo canal, com os critérios da tela. A B.ia não altera anúncios.'],
  ['inteligencia','inteligencia','Inteligência','/inteligencia','comercial','inteligencia|oportunidades|inteligencia de mercado','Cruza sinais de mercado e custo. Oportunidades são indicações para análise, não garantias de resultado.'],
  ['reconciliacao','reconciliacao','Reconciliação','/reconciliacao','comercial','reconciliacao|conciliacao|carteira|pagamentos|a receber|recebimentos|creditos','Compara pedido, NF, líquido previsto e crédito efetivo. Saldo após é o saldo da carteira, não o pagamento daquele pedido.',['inicio','fim']],
  ['mercado-livre','mercado-livre','Mercado Livre','/mercado-livre','comercial','mercado livre|mercadolivre|ml','Analítica do Mercado Livre e suas posições de estoque. Confira a janela e a atualização mostradas.'],
  ['expedicao','expedicao','Expedição','/expedicao','operacoes','expedicao|despacho|envios|prazo de envio','Pedidos pagos e carga por prazo de envio são indicadores distintos.',['de','ate']],
  ['devolucoes','devolucoes','Devoluções','/devolucoes','comercial','devolucao|devolucoes|devolvemos|devolvidos|devolvida|reembolso|reembolsos|estorno|estornos|retornos','Devoluções abertas são solicitações do período. Reembolso recusado e cancelamento não são perdas. Valor estimado pela NF pode ser o total da venda, não o reembolso parcial.',['inicio','fim']],
  ['importacoes','importacoes','Importações','/importacoes','operacoes','importacoes|importacao|navios|navio|container|comex|fatura de importacao','Acompanha faturas, cargas e posição AIS. Datas previstas não são chegada confirmada.'],
  ['logistica','logistica','Logística','/logistica','operacoes','logistica|palete|paletes|etiqueta','Organiza o depósito e o acesso aos módulos de estoque, recebimento, etiquetas e separação.'],
  ['logistica-estoque','logistica','Estoque por depósito','/logistica/estoque','operacoes','estoque|deposito|capital em estoque|ruptura','Saldo por depósito do ERP. Quantidades físicas e saldo vendável do marketplace têm fontes diferentes.'],
  ['logistica-separacao','logistica','Separação','/logistica/separacao','operacoes','separacao|separar|picking|caixas a separar','A lista oficial é congelada por fechamento, com kits abertos em componentes físicos e Full excluído da separação local.'],
  ['logistica-recebimento','logistica','Recebimento','/logistica/recebimento','operacoes','recebimento de mercadoria|conferencia de carga|cargas recebidas','Registros de recebimento e conferência de cargas. Previsto e confirmado permanecem separados.'],
  ['full','full','Full','/full','operacoes','full|fbs onsite|remessa|remessas','Acompanha remessas reais e suas etapas. Consulta não aprova, agenda ou altera a remessa.'],
  ['rh','rh','RH','/rh','pessoas','rh|recursos humanos|folha|salario|salarios|pessoal|colaboradores|absenteismo|turnover|horas extras','O diagnóstico de RH tem período documental próprio. Indicadores não apurados permanecem ausentes; dados não substituem avaliação individual.'],
  ['precos-colaboradores','precos-colaboradores','Preços para colaboradores','/precos-colaboradores','pessoas','precos para colaboradores|preco colaborador|precos colaboradores','Tabela de preços para colaboradores. Códigos duplicados e validade da origem devem ser conferidos.'],
  ['calculadora','calculadora','Calculadora','/calculadora','comercial','calculadora|precificacao|preco de venda','Simulação de precificação com regras próprias, separadas do motor fiscal. Uma simulação não modifica preços.'],
  ['rpa','rpa','RPA Afiliados','/rpa','comercial','rpa|afiliados|afiliado|inss|irrf|recibo','Lotes de comissões e retenções congeladas por pessoa. Totais dependem da competência e do lote; esta fonte contém dados pessoais restritos.'],
  ['agenda','agenda','Agenda','/agenda','','agenda|tarefas|tarefa|compromissos|minhas pendencias','Mostra somente as tarefas que a própria sessão pode ler, respeitando participação e período.'],
  ['documentacao','documentacao','Documentação','/documentacao','','documentacao|dicionario|banco de dados|tabelas|schema|como funciona o oraculo','Explica fontes, regras e limitações do banco. Documentação não é uma consulta de fatos comerciais.'],
  ['alertas','alertas','Alertas','/alertas','operacoes','alertas|alerta|reposicao','Sinais de ruptura e reposição com os critérios da tela. Alertas representam ação sugerida, não alteração executada.'],
  ['parametros','parametros','Parâmetros','/parametros','','parametros|aliquotas|icms|difal|pis|cofins|taxas configuradas','Configurações fiscais vigentes. A B.ia apenas explica os valores disponíveis; não salva parâmetros.'],
  ['usuarios','usuarios','Usuários','/usuarios','admin','usuarios|usuario|permissoes|acessos de usuarios','Configuração administrativa de acesso por operação e aba. A B.ia não concede nem remove permissões.'],
  ['status','status','Status sync','/status','admin','status|sincronizacao|sync|integracoes|atualizacao dos dados','Estado das ingestões por fonte. Uma rotina saudável não comprova a cobertura de todas as outras.']
])).map(([id, tab, label, path, sector, aliases, explanation, dates]) => ({ id, tab, label, path, sector, aliases: String(aliases).split('|'), explanation, dates }));

export function biaSourceById(id) { return BIA_SOURCES.find(source => source.id === id); }

export function resolveBiaSources(question, previous = []) {
  const text = normalizeBia(question);
  const hits = BIA_SOURCES.flatMap(source => {
    const matched=source.aliases.map(alias=>({alias:normalizeBia(alias),index:text.search(new RegExp(`(?:^|[^a-z0-9])${normalizeBia(alias)}(?:$|[^a-z0-9])`))})).filter(hit=>hit.index>=0).sort((a,b)=>b.alias.length-a.alias.length)[0];
    return matched ? [{source,...matched}] : [];
  });
  if (hits.length) {
    // A natural product ranking keeps the mature commercial calculation.
    // The dedicated Mais Vendidos screen remains available by its own name.
    if (/\btop\s*\d+\b/.test(text) && /\bmais vendidos\b/.test(text)
      && hits.every(hit=>['mais-vendidos','analise-comercial','shopee','mercado-livre'].includes(hit.source.id))) return ['analise-comercial'];
    const specific=hits.filter(hit=>!hits.some(other=>other!==hit && other.alias.length>hit.alias.length && other.alias.includes(hit.alias)));
    const qualified=specific.filter(hit=>!['shopee','mercado-livre'].includes(hit.source.id) || specific.length===1);
    const selected=qualified.length?qualified:specific;
    const compound=/\b(e|versus|vs)\b/.test(text);
    return selected.filter(hit=>hit.source.id!=='analise-comercial' || selected.length===1 || compound).map(hit=>hit.source.id);
  }
  if (previous.length && /^(e\b|agora\b|como\b|qual\b|quanto\b|nesse\b|nessa\b|desses\b|destes\b|explique\b|compare\b)/.test(text)) return [...previous];
  return [];
}

export function biaUserName(user) {
  const value = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Usuário';
  return String(value).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Usuário';
}
