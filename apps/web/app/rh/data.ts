// Snapshot documental usado pelo protótipo local de RH.
//
// Fonte: "Resumo_RH_25_26 - Apolonis&Jacartta.pdf" (08/09/2026).
// Este arquivo centraliza somente os valores explicitamente documentados. As
// lacunas permanecem fora das métricas para que a interface mostre "não
// apurado" em vez de transformar hipótese em indicador.

export const RH_DIAGNOSTIC = {
  source: {
    title: "Diagnóstico de RH 2026",
    mainPeriod: "Jan a Ago/2026",
    terminationPeriod: "Jan/2025 a Set/2026",
    sources: ["Relatórios internos de RH", "VR Ponto", "Folhas mensais", "Relatórios de rescisão"]
  },
  workforce: {
    clt: 48,
    contractors: 4,
    linkedTotal: 52,
    start2026: 32,
    endAug2026: 48,
    averageDaily: 39.5,
    hires: 49,
    terminations: 33,
    netGrowth: 16,
    growthRate: 50
  },
  tenure: {
    averageMonths: 7.9,
    medianMonths: 4.1,
    upTo3Months: 17,
    from3To6Months: 10,
    from6To12Months: 8,
    over12Months: 13,
    upTo6MonthsRate: 56.3
  },
  historicalTerminations: {
    total: 67,
    companyInitiative: 39,
    employeeInitiative: 24,
    automaticEnd: 3,
    agreement: 1,
    upTo45Days: 22,
    from46To90Days: 16,
    from91To180Days: 12,
    from181To365Days: 13,
    over365Days: 4,
    upTo90DaysRate: 56.7,
    upTo180DaysRate: 74.6,
    medianDays: 89,
    experienceRelatedRate: 53.7,
    jacarttaUpTo90DaysRate: 85,
    jacarttaMedianDays: 44
  },
  absence: {
    scheduledHours: 37030,
    absenceHours: 778,
    rate: 2.1,
    equivalentDays: 97,
    justifiedHours: 683,
    justifiedRate: 87.8,
    unjustifiedHours: 95,
    unjustifiedRate: 12.2,
    peopleWithAbsence: 26,
    peopleWithoutAbsence: 22,
    top5ConcentrationRate: 54.4,
    monthly: [
      { label: "Jan", value: 0.84 }, { label: "Fev", value: 2.44 },
      { label: "Mar", value: 5.41 }, { label: "Abr", value: 5.77 },
      { label: "Mai", value: 1.02 }, { label: "Jun", value: 1.8 },
      { label: "Jul", value: 0.77 }, { label: "Ago", value: 1.36 }
    ]
  },
  overtime: {
    hours: 1964.5,
    amount: 31230.47,
    monthlyAverageAmount: 3903.81,
    averageHoursPerEquivalentEmployeeMonth: 6.2,
    augustHours: 640.9,
    augustAmount: 10186.51
  },
  payroll: {
    processedEarnings: 885140.06,
    monthlyAverage: 110642.51,
    netTerminations: 76976.21
  },
  companies: [
    { name: "Apolonis", clt: 21, contractors: 0, averageTenureMonths: 14.7, historicalTerminations: 47, absenceRate: 2.65, overtimeHours: 1295.97, overtimeShare: 66, overtimeAmount: 21237.53, processedEarnings: 606050.6, netTerminationsAmount: 45916.91 },
    { name: "Jacartta", clt: 27, contractors: 4, averageTenureMonths: 2.7, historicalTerminations: 20, absenceRate: 1.07, overtimeHours: 668.53, overtimeShare: 34, overtimeAmount: 9992.94, processedEarnings: 279089.46, netTerminationsAmount: 31059.3 }
  ],
  processMap: [
    { process: "Ponto", status: "VR Ponto", maturity: "operating" },
    { process: "Fechamento da folha", status: "RH confere e prepara informações", maturity: "operating" },
    { process: "Processamento da folha", status: "Contabilidade externa", maturity: "operating" },
    { process: "Atestados", status: "RH recebe, lança e arquiva", maturity: "operating" },
    { process: "Faltas / atrasos", status: "VR Ponto", maturity: "operating" },
    { process: "Recrutamento", status: "Indeed + WhatsApp", maturity: "operating" },
    { process: "Vagas", status: "Planilha de controle", maturity: "manual" },
    { process: "Tempo de contratação", status: "Controle iniciando", maturity: "building" },
    { process: "Banco de talentos", status: "Em estruturação", maturity: "building" },
    { process: "Site de vagas", status: "Em estruturação", maturity: "building" },
    { process: "SST", status: "RH + parceiro terceirizado", maturity: "building" },
    { process: "Setores", status: "Cadastro ainda precisa de padronização", maturity: "pending" }
  ],
  notClosed: ["Tempo médio histórico de contratação", "Turnover oficial e sua fórmula", "Custo total de pessoas", "Análise por setor", "SST gerencial"]
} as const;

