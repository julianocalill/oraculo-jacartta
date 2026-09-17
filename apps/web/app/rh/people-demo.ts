// Registros fictícios usados somente para validar a experiência do prontuário
// 360º. Nenhum nome, documento ou evento abaixo representa uma pessoa real.

export type EmployeeTimelineItem = {
  date: string;
  category: "Entrada" | "Movimentação" | "Desenvolvimento" | "Férias" | "Ocorrência";
  title: string;
  detail: string;
};

export type EmployeeDemo = {
  id: string;
  initials: string;
  name: string;
  company: "Apolonis" | "Jacartta";
  area: string;
  role: string;
  admission: string;
  tenure: string;
  contract: "CLT" | "PJ";
  manager: string;
  status: "Ativo" | "Experiência" | "Afastado";
  profileCompletion: number;
  nextAction: string;
  timeline: EmployeeTimelineItem[];
};

export const EMPLOYEE_DEMOS: EmployeeDemo[] = [
  {
    id: "colaborador-demo-01", initials: "CD", name: "Colaborador demonstrativo 01", company: "Apolonis", area: "Operações", role: "Assistente de Operações", admission: "12/08/2026", tenure: "1 mês", contract: "CLT", manager: "Gestor da área", status: "Experiência", profileCompletion: 78, nextAction: "Avaliação de 45 dias em 26/09",
    timeline: [
      { date: "12/08/2026", category: "Entrada", title: "Admissão concluída", detail: "Documentos conferidos, contrato assinado e cadastro criado." },
      { date: "13/08/2026", category: "Desenvolvimento", title: "Onboarding iniciado", detail: "Integração institucional e trilha da função atribuídas." },
      { date: "26/08/2026", category: "Desenvolvimento", title: "Checkpoint de 15 dias", detail: "Registro estruturado do gestor; sem ocorrência crítica." }
    ]
  },
  {
    id: "colaborador-demo-02", initials: "CD", name: "Colaborador demonstrativo 02", company: "Jacartta", area: "Comercial", role: "Analista de Marketplace", admission: "03/06/2026", tenure: "3 meses", contract: "CLT", manager: "Gestor da área", status: "Ativo", profileCompletion: 92, nextAction: "Fechar avaliação de 90 dias",
    timeline: [
      { date: "03/06/2026", category: "Entrada", title: "Admissão concluída", detail: "Origem da candidatura e score de seleção vinculados ao perfil." },
      { date: "18/06/2026", category: "Desenvolvimento", title: "Trilha inicial concluída", detail: "Conteúdos obrigatórios concluídos e evidências anexadas." },
      { date: "02/09/2026", category: "Desenvolvimento", title: "Avaliação de experiência", detail: "Avaliação do gestor registrada; decisão aguardando validação do RH." }
    ]
  },
  {
    id: "colaborador-demo-03", initials: "CD", name: "Colaborador demonstrativo 03", company: "Apolonis", area: "Logística", role: "Auxiliar de Expedição", admission: "17/02/2026", tenure: "7 meses", contract: "CLT", manager: "Gestor da área", status: "Ativo", profileCompletion: 84, nextAction: "Revisar banco de horas",
    timeline: [
      { date: "17/02/2026", category: "Entrada", title: "Admissão concluída", detail: "Cadastro funcional e entrega de equipamentos registrados." },
      { date: "04/04/2026", category: "Ocorrência", title: "Atestado lançado", detail: "Documento validado pelo RH e integrado ao fechamento do ponto." },
      { date: "31/08/2026", category: "Movimentação", title: "Fechamento de banco de horas", detail: "Saldo e justificativas disponibilizados para conferência." }
    ]
  },
  {
    id: "colaborador-demo-04", initials: "CD", name: "Colaborador demonstrativo 04", company: "Jacartta", area: "Administrativo", role: "Analista Administrativo", admission: "08/11/2025", tenure: "10 meses", contract: "CLT", manager: "Gestor da área", status: "Ativo", profileCompletion: 100, nextAction: "PDI trimestral em outubro",
    timeline: [
      { date: "08/11/2025", category: "Entrada", title: "Admissão concluída", detail: "Dados cadastrais e documentos funcionais arquivados." },
      { date: "05/03/2026", category: "Desenvolvimento", title: "PDI aberto", detail: "Objetivos, competências e prazo acordados com a liderança." },
      { date: "14/07/2026", category: "Férias", title: "Férias concluídas", detail: "Período e recibos vinculados ao histórico funcional." }
    ]
  },
  {
    id: "colaborador-demo-05", initials: "CD", name: "Colaborador demonstrativo 05", company: "Apolonis", area: "Produção", role: "Líder de Produção", admission: "21/04/2024", tenure: "2 anos e 5 meses", contract: "CLT", manager: "Diretoria", status: "Ativo", profileCompletion: 96, nextAction: "Atualizar plano de sucessão",
    timeline: [
      { date: "21/04/2024", category: "Entrada", title: "Admissão concluída", detail: "Registro original migrado para o prontuário central." },
      { date: "10/01/2025", category: "Movimentação", title: "Promoção para liderança", detail: "Alteração de cargo, salário e centro de custo registrada." },
      { date: "08/08/2026", category: "Desenvolvimento", title: "Feedback de liderança", detail: "Competências avaliadas e ações incorporadas ao PDI." }
    ]
  },
  {
    id: "colaborador-demo-06", initials: "CD", name: "Colaborador demonstrativo 06", company: "Jacartta", area: "Tecnologia", role: "Pessoa Desenvolvedora", admission: "01/07/2026", tenure: "2 meses", contract: "PJ", manager: "Gestor da área", status: "Ativo", profileCompletion: 71, nextAction: "Completar documentos contratuais",
    timeline: [
      { date: "01/07/2026", category: "Entrada", title: "Contrato iniciado", detail: "Prestador vinculado à empresa, área e responsável interno." },
      { date: "02/07/2026", category: "Desenvolvimento", title: "Acessos liberados", detail: "Checklist de sistemas e segurança registrado." },
      { date: "01/09/2026", category: "Movimentação", title: "Renovação em análise", detail: "Responsável e data de decisão definidos." }
    ]
  }
];
