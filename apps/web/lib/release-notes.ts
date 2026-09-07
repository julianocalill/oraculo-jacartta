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
