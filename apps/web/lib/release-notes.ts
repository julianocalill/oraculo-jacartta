export const RELEASE_NOTE_WINDOW_HOURS = 48;

export type ReleaseChange = {
  title: string;
  description: string;
  href?: string;
  linkLabel?: string;
};

export type ReleaseNote = {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  changes: ReleaseChange[];
};

export type ActiveReleaseNote = ReleaseNote & {
  expiresAt: string;
};

// Toda mudança visível ao usuário deve ganhar uma entrada aqui no mesmo commit.
// O publishedAt é o horário previsto de publicação em produção; após 48 horas a
// novidade deixa de aparecer automaticamente, sem migration ou limpeza manual.
const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "2026-10-02-bia-setores",
    title: "B.ia acompanha os seus setores",
    summary: "Consulte as áreas liberadas para você, com explicações e fontes dos dados.",
    publishedAt: "2026-10-02T17:50:00-03:00",
    changes: [{
      title: "Informação com contexto e acesso respeitado",
      description: "A B.ia trata você pelo nome, explica os indicadores e mostra onde conferir os dados. Cada assunto respeita o acesso configurado em Usuários. Ela apenas consulta e informa quando um dado não está disponível para você.",
      href: "/bia",
      linkLabel: "Conversar com a B.ia"
    }]
  },
  {
    id: "2026-10-02-bia-respostas",
    title: "Respostas mais claras da B.ia",
    summary: "Confira a medida, o período e o produto usados em cada resposta.",
    publishedAt: "2026-10-02T12:10:00-03:00",
    changes: [{
      title: "Perguntas e filtros respeitados",
      description: "A B.ia pede esclarecimento quando não entende um filtro e mostra quais dados consultou. As respostas indicam a fonte para conferir a informação.",
      href: "/bia",
      linkLabel: "Conversar com a B.ia"
    }]
  },
  {
    id: "2026-10-02-bia",
    title: "Conheça a B.ia",
    summary: "Pergunte sobre faturamento, produtos e margem da operação selecionada.",
    publishedAt: "2026-10-02T11:30:00-03:00",
    changes: [{
      title: "Sua assistente de dados",
      description: "Clique no personagem no canto direito para abrir a B.ia. O chat acompanha você entre páginas e responde com os dados da Análise Comercial, mostrando a fonte. Ela apenas consulta: nunca altera seus dados.",
      href: "/bia",
      linkLabel: "Conversar com a B.ia"
    }]
  },
  {
    id: "2026-10-01-separacao-sem-full",
    title: "Separação com Grupo e sem Full",
    summary: "Confira o grupo dos produtos e as unidades que precisam de separação local.",
    publishedAt: "2026-10-01T15:10:00-03:00",
    changes: [{
      title: "Grupo na impressão e no CSV",
      description: "A impressão e o CSV mostram a categoria do produto gravada na geração da lista. O total de unidades a separar fica visível na tela, e pedidos com expedição Full ficam fora das novas listas.",
      href: "/logistica/separacao",
      linkLabel: "Abrir Separação"
    }]
  },
  {
    id: "2026-10-01-shopee-ads-verba-ilimitada",
    title: "Cenários de Ads para verba ilimitada",
    summary: "Compare ROAS e alcance entre períodos equivalentes para decidir o próximo ajuste.",
    publishedAt: "2026-10-01T10:10:00-03:00",
    changes: [{
      title: "Quatro cenários de entrega e retorno",
      description: "A análise de prints agora considera orçamento sempre ilimitado. Informe a meta e as impressões de um período anterior igual; as sugestões respeitam a margem antes de propor uma meta menor.",
      href: "/ads/analisar-print",
      linkLabel: "Analisar anúncio"
    }]
  },
  {
    id: "2026-10-01-tiktok-devolucoes-upload",
    title: "Devoluções por motivo e upload TikTok",
    summary: "Clique em um motivo para identificar os produtos afetados e confira o resultado dos uploads.",
    publishedAt: "2026-10-01T09:50:00-03:00",
    changes: [{
      title: "Do motivo aos produtos",
      description: "Clique no motivo, na legenda ou na fatia do gráfico para filtrar os SKUs de devoluções. Limpe o motivo para voltar à visão geral; as datas e o canal selecionados são mantidos.",
      href: "/devolucoes",
      linkLabel: "Ver devoluções"
    }, {
      title: "Escolha a loja quando a aba vier sem identificação",
      description: "Arquivos com aba chamada “0” agora permitem selecionar Donacor, Aliver ou Jacartta. O resultado informa quantas linhas foram gravadas e mostra os avisos quando houver problemas.",
      href: "/devolucoes",
      linkLabel: "Abrir Devoluções"
    }]
  },
  {
    id: "2026-09-30-shopee-ads-print",
    title: "Analise prints de anúncios na Shopee Ads",
    summary: "Envie uma captura de Performance e confira sugestões de ROAS dentro do Oráculo.",
    publishedAt: "2026-09-30T16:00:00-03:00",
    changes: [{
      title: "Do print à decisão",
      description: "A imagem é lida no navegador; você confere os números e informa o contexto para identificar o cenário da campanha. A ferramenta não altera anúncios.",
      href: "/ads/analisar-print",
      linkLabel: "Analisar print"
    }]
  },
  {
    id: "2026-09-28-analise-comercial-csv",
    title: "Exporte a Análise Comercial",
    summary: "Baixe em CSV os produtos vendidos no período que você selecionou.",
    publishedAt: "2026-09-28T12:00:00-03:00",
    changes: [{
      title: "Ranking pronto para planilha",
      description: "O arquivo acompanha o período, a loja e a busca da tela, incluindo unidades, receita, margem e a situação de cada produto.",
      href: "/analise-comercial",
      linkLabel: "Abrir Análise Comercial"
    }]
  },
  {
    id: "2026-09-25-calculadora-marketplaces",
    title: "Novas tarifas na calculadora",
    summary: "Mercado Livre, TikTok e Shopee foram atualizados com os novos custos fixos de precificação.",
    publishedAt: "2026-09-25T10:30:00-03:00",
    changes: [{
      title: "Simulações com as novas regras",
      description: "Mercado Livre inclui um campo editável de R$ 12 de envio abaixo de R$ 79,99; TikTok ganhou campos separados de envio de R$ 12,10 abaixo de R$ 50 e R$ 19,30 a partir de R$ 50; Shopee passa a R$ 4,50 até R$ 79,99 na regra vigente em 01/10.",
      href: "/calculadora",
      linkLabel: "Abrir calculadora"
    }]
  },
  {
    id: "2026-09-23-precos-colaboradores",
    title: "Preços para colaboradores no Oráculo",
    summary: "O setor Pessoas agora reúne a tabela de produtos e valores para compra interna.",
    publishedAt: "2026-09-23T12:00:00-03:00",
    changes: [{
      title: "Consulta por nome ou código",
      description: "A nova aba mostra 254 itens da planilha vigente, permite busca e ordenação e sinaliza códigos repetidos para conferência antes da compra.",
      href: "/precos-colaboradores",
      linkLabel: "Consultar preços"
    }]
  },
  {
    id: "2026-09-22-separacao-todos-vendidos",
    title: "Separação inclui todos os itens vendidos",
    summary: "Produtos com zero caixas fechadas também aparecem na lista, em ordem decrescente de caixas.",
    publishedAt: "2026-09-22T17:30:00-03:00",
    changes: [{
      title: "Lista completa por SKU",
      description: "Impressão, CSV e WhatsApp incluem todos os SKUs vendidos. Produtos sem caixa fechada aparecem com zero caixas e suas unidades avulsas.",
      href: "/logistica/separacao",
      linkLabel: "Abrir Separação"
    }]
  },
  {
    id: "2026-09-22-separacao-sem-descritivo",
    title: "Lista de separação mais enxuta",
    summary: "A impressão e o CSV mostram só os dados necessários para separar os produtos.",
    publishedAt: "2026-09-22T17:10:00-03:00",
    changes: [{
      title: "Coluna Descritivo removida",
      description: "O nome do produto concentra a informação necessária, inclusive o aviso para kits sem composição. As quantidades da lista não mudam.",
      href: "/logistica/separacao",
      linkLabel: "Abrir Separação"
    }]
  },
  {
    id: "2026-09-22-separacao-kits-fisicos",
    title: "Separação mostra os produtos dentro dos kits",
    summary: "Kits passam a ser somados aos produtos simples que o depósito precisa retirar.",
    publishedAt: "2026-09-22T16:30:00-03:00",
    changes: [{
      title: "Lista por produto físico",
      description: "A lista soma vendas diretas e componentes de kits no mesmo SKU. A quantidade aparece como Unidades a separar; kits sem composição são sinalizados para conferência.",
      href: "/logistica/separacao",
      linkLabel: "Abrir Separação"
    }]
  },
  {
    id: "2026-09-17-setor-rh",
    title: "Novo setor de RH no Oráculo",
    summary: "Indicadores de pessoas, recrutamento com IA e prontuário funcional agora estão reunidos em uma área própria.",
    publishedAt: "2026-09-17T13:55:00-03:00",
    changes: [{
      title: "Gestão de Pessoas e recrutamento",
      description: "A nova área apresenta o diagnóstico consolidado de RH, o fluxo futuro de recrutamento com IA e a estrutura de prontuário 360º. Os perfis individuais exibidos nesta primeira versão são demonstrativos e não representam colaboradores reais.",
      href: "/rh",
      linkLabel: "Abrir RH"
    }]
  },
  {
    id: "2026-09-17-separacao-uma-caixa",
    title: "Separação inclui produtos a partir de uma caixa",
    summary: "SKUs que formam uma única caixa completa também passam a aparecer na lista operacional.",
    publishedAt: "2026-09-17T08:00:00-03:00",
    changes: [{
      title: "Novo mínimo operacional",
      description: "A impressão, o CSV e o WhatsApp agora incluem todos os SKUs com uma caixa completa ou mais. Tapetes higiênicos usam seis pacotes por caixa, com expansão dos kits pelos componentes do Olist.",
      href: "/logistica/separacao",
      linkLabel: "Abrir Separação"
    }]
  },
  {
    id: "2026-09-11-shopee-ads",
    title: "Shopee Ads agora no Comercial",
    summary: "Acompanhe o investimento, o ROAS e as prioridades de cada dia dentro do Oráculo.",
    publishedAt: "2026-09-11T17:10:00-03:00",
    changes: [{
      title: "Gasto e retorno por loja e campanha",
      description: "O novo dashboard reúne evolução diária, filtros de período e loja, ranking de campanhas e análise dos pontos de atenção. Inclui campanhas pausadas e informa quando o histórico está incompleto.",
      href: "/ads",
      linkLabel: "Abrir Shopee Ads"
    }]
  },
  {
    id: "2026-09-11-home-pedidos-olist",
    title: "Home e Pedidos sem produtos e lojas duplicados",
    summary: "O ranking de SKUs da home e a aba Pedidos passam a usar só a Olist, como já acontecia em SKUs.",
    publishedAt: "2026-09-11T12:00:00-03:00",
    changes: [{
      title: "Uma linha por produto e por loja",
      description: "A API direta da Shopee repetia o mesmo produto com outro SKU e mostrava cada loja duas vezes em Pedidos por loja. Agora a Olist, que já consolida Shopee, TikTok Shop e Mercado Livre, é a única fonte dessas telas. O seletor de fonte da aba Pedidos foi removido.",
      href: "/pedidos",
      linkLabel: "Abrir pedidos"
    }]
  },
  {
    id: "2026-09-10-calculadora-tiktok",
    title: "Taxas do TikTok corrigidas na calculadora",
    summary: "A simulação passa a incluir a tarifa fixa correta em todas as faixas de preço.",
    publishedAt: "2026-09-11T08:11:27-03:00",
    changes: [{
      title: "Comissão e tarifa fixa por faixa",
      description: "Abaixo de R$ 50: 10% + R$ 4. A partir de R$ 50: 6% + R$ 6. Refaça suas simulações do TikTok para conferir o lucro e a margem atualizados.",
      href: "/calculadora",
      linkLabel: "Abrir calculadora"
    }]
  },
  {
    id: "2026-09-04-explicacoes-colunas",
    title: "Todas as colunas agora se explicam",
    summary: "Passe o mouse ou toque no “?” de qualquer coluna para entender o dado exibido.",
    publishedAt: "2026-09-04T17:20:00-03:00",
    changes: [{
      title: "Glossário em todas as tabelas",
      description: "Cabeçalhos de todas as telas ganharam explicações rápidas, incluindo fórmulas, origem do dado e ressalvas importantes quando se aplicam. O recurso também funciona por teclado."
    }]
  },
  {
    id: "2026-09-04-operacoes",
    title: "Oráculo preparado para mais de uma operação",
    summary: "Acesso e dados agora reconhecem Uberlândia e Giracasa separadamente.",
    publishedAt: "2026-09-04T18:00:00-03:00",
    changes: [{
      title: "Escolha segura da operação",
      description: "Quem receber acesso à Giracasa poderá escolher a operação ao entrar. A base de São Paulo será exibida somente depois da validação das integrações e do financeiro.",
      href: "/operacoes?trocar=1",
      linkLabel: "Ver operações"
    }]
  },
  {
    id: "2026-09-04-analise-comercial",
    title: "Análise comercial por dia e período",
    summary: "Veja quais produtos mais venderam e qual margem cada um deixou.",
    publishedAt: "2026-09-04T11:52:00-03:00",
    changes: [{
      title: "Vendas e margem na mesma tela",
      description: "Escolha hoje, ontem ou um intervalo de datas, filtre a loja e ordene os produtos por unidades, receita ou margem. Custos e comissões pendentes ficam sinalizados.",
      href: "/analise-comercial",
      linkLabel: "Abrir Análise Comercial"
    }]
  },
  {
    id: "2026-09-02-custo-cadastrado-produto-360",
    title: "Custo cadastrado no Produto 360",
    summary: "O diagnóstico agora mostra o custo bruto da Olist ao lado do custo líquido usado.",
    publishedAt: "2026-09-02T15:25:00-03:00",
    changes: [
      {
        title: "Confira a composição do custo",
        description: "Veja o custo cadastrado por unidade, a quantidade do SKU em cada venda e o custo líquido que alimenta margem e lucro.",
        href: "/inteligencia",
        linkLabel: "Abrir Produto 360"
      }
    ]
  },
  {
    id: "2026-09-02-busca-inteligencia-produto",
    title: "Busca rápida na Inteligência",
    summary: "Agora ficou mais fácil descobrir se um produto precisa de ação.",
    publishedAt: "2026-09-02T15:15:00-03:00",
    changes: [
      {
        title: "Consulte qualquer produto",
        description: "Busque por SKU, nome, variação ou loja, veja a ação recomendada e abra o diagnóstico completo no Produto 360.",
        href: "/inteligencia",
        linkLabel: "Buscar produto"
      }
    ]
  },
  {
    id: "2026-09-02-explicacao-custo-bruto-liquido",
    title: "Custos mais transparentes",
    summary: "A conferência de custos agora explica exatamente quais valores alimentam as análises.",
    publishedAt: "2026-09-02T14:25:00-03:00",
    changes: [
      {
        title: "Bruto usado × líquido usado",
        description: "Veja a origem do custo, os créditos recuperáveis aplicados e exemplos práticos antes de validar a margem.",
        href: "/parametros?secao=custos",
        linkLabel: "Entender os custos"
      }
    ]
  },
  {
    id: "2026-09-01-inteligencia-custos-novidades-v2",
    title: "Novidades no Oráculo",
    summary: "Uma nova camada de inteligência comercial, custos auditáveis e avisos de atualização.",
    publishedAt: "2026-09-01T17:00:00-03:00",
    changes: [
      {
        title: "Inteligência de Mercado",
        description: "Radar de ações, Produto 360, concorrentes e simulação de preço em uma única área.",
        href: "/inteligencia",
        linkLabel: "Abrir Inteligência"
      },
      {
        title: "Conferência de custos",
        description: "Confira custo cadastrado, médio, bruto e líquido; corrija um SKU antes de confiar na margem.",
        href: "/parametros?secao=custos",
        linkLabel: "Conferir custos"
      },
      {
        title: "Avisos por 48 horas",
        description: "A partir de agora, cada mudança relevante aparecerá neste pop-up a cada novo login durante dois dias."
      },
      {
        title: "Controle de exibição",
        description: "Marque para não ver esta atualização de novo; o aviso retorna automaticamente quando houver outra novidade."
      }
    ]
  }
];

export function getActiveReleaseNotes(now = new Date()): ActiveReleaseNote[] {
  const currentTime = now.getTime();
  const windowMs = RELEASE_NOTE_WINDOW_HOURS * 60 * 60 * 1000;

  return RELEASE_NOTES
    .map((release) => {
      const publishedTime = new Date(release.publishedAt).getTime();
      return {
        ...release,
        expiresAt: new Date(publishedTime + windowMs).toISOString()
      };
    })
    .filter((release) => {
      const publishedTime = new Date(release.publishedAt).getTime();
      const expiresTime = new Date(release.expiresAt).getTime();
      return Number.isFinite(publishedTime) && publishedTime <= currentTime && currentTime < expiresTime;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
