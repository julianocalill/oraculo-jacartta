import { requireTabAccess } from "../../lib/auth/access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { MetricCard } from "../components/metric-card";
import { NoAccess } from "../components/no-access";
import { OperationLink as Link } from "../components/operation-provider";
import { RecruitmentFunnel } from "./charts";
import { RH_DIAGNOSTIC as data } from "./data";
import { EMPLOYEE_DEMOS } from "./people-demo";

export const dynamic = "force-dynamic";

type RhView = "visao-geral" | "recrutamento" | "pessoas" | "desenvolvimento" | "governanca";

const VIEWS: ReadonlyArray<{ key: RhView; label: string; description: string }> = [
  { key: "visao-geral", label: "Visão geral", description: "Saúde do quadro e prioridades" },
  { key: "recrutamento", label: "Recrutamento", description: "Entrada, experiência e método" },
  { key: "pessoas", label: "Pessoas", description: "Quadro, presença e capacidade" },
  { key: "desenvolvimento", label: "Desenvolvimento", description: "PDI, trilhas e treinamentos" },
  { key: "governanca", label: "Governança", description: "Processos, lacunas e decisões" }
];

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value: number) => `${nf.format(value)}%`;
const hours = (value: number) => `${nf.format(value)} h`;

const earlyExitBuckets = [
  { label: "Até 45 dias", value: data.historicalTerminations.upTo45Days, detail: "32,8% das saídas" },
  { label: "46 a 90 dias", value: data.historicalTerminations.from46To90Days, detail: "23,9% das saídas" },
  { label: "91 a 180 dias", value: data.historicalTerminations.from91To180Days, detail: "17,9% das saídas" },
  { label: "181 a 365 dias", value: data.historicalTerminations.from181To365Days, detail: "19,4% das saídas" },
  { label: "Mais de 1 ano", value: data.historicalTerminations.over365Days, detail: "6,0% das saídas" }
];

function RhNavigation({ active }: { active: RhView }) {
  return (
    <nav className="rh-view-nav" aria-label="Áreas do setor de RH">
      {VIEWS.map((view) => (
        <Link key={view.key} href={`/rh?visao=${view.key}`} className={active === view.key ? "rh-view-link active" : "rh-view-link"}>
          <strong>{view.label}</strong><span>{view.description}</span>
        </Link>
      ))}
    </nav>
  );
}

function SourceNotice() {
  return (
    <section className="rh-demo-notice rh-source-notice" role="status">
      <div><strong>Base documental incorporada · {data.source.title}</strong><p>Quadro, movimentação, absenteísmo, horas extras e folha: {data.source.mainPeriod}. Desligamentos históricos: {data.source.terminationPeriod}. Indicadores ainda sem definição aparecem como “não apurado”.</p></div>
      <span>Dados medidos</span>
    </section>
  );
}

function AbsenceChart() {
  const max = Math.max(...data.absence.monthly.map((item) => item.value));
  return (
    <div className="rh-month-bars" role="img" aria-label="Absenteísmo mensal de janeiro a agosto de 2026">
      {data.absence.monthly.map((item) => (
        <div key={item.label}><strong>{pct(item.value)}</strong><div><span style={{ height: `${Math.max(7, (item.value / max) * 100)}%` }} /></div><small>{item.label}</small></div>
      ))}
    </div>
  );
}

function CompanyComparison() {
  return (
    <div className="table-wrap"><table className="data-table rh-table"><thead><tr><th>Empresa</th><th>Quadro atual</th><th>Tempo médio</th><th>Absenteísmo</th><th>Horas extras</th><th>Valor HE + DSR</th></tr></thead><tbody>
      {data.companies.map((company) => <tr key={company.name}><td>{company.name}</td><td>{company.clt} CLTs{company.contractors ? ` + ${company.contractors} PJs` : ""}</td><td>{nf.format(company.averageTenureMonths)} meses</td><td>{pct(company.absenceRate)}</td><td>{hours(company.overtimeHours)}</td><td>{money.format(company.overtimeAmount)}</td></tr>)}
    </tbody></table></div>
  );
}

function Overview() {
  return (
    <>
      <section className="metric-grid rh-metric-grid">
        <MetricCard accent="accent-blue" label="Quadro atual" value={nf.format(data.workforce.linkedTotal)} caption={`${data.workforce.clt} CLTs + ${data.workforce.contractors} PJs`} />
        <MetricCard accent="accent-violet" label="Movimentação em 2026" value="82 eventos" caption={`${data.workforce.hires} admissões · ${data.workforce.terminations} desligamentos`} />
        <MetricCard accent="accent-red" label="Saídas até 90 dias" value={pct(data.historicalTerminations.upTo90DaysRate)} caption={`Base: ${data.historicalTerminations.total} desligamentos históricos`} />
        <MetricCard accent="accent-yellow" label="Absenteísmo" value={pct(data.absence.rate)} caption={`Aprox. ${hours(data.absence.absenceHours)} · ${data.absence.equivalentDays} jornadas`} />
        <MetricCard accent="accent-cyan" label="Horas extras" value={hours(data.overtime.hours)} caption={`${money.format(data.overtime.amount)} com DSR`} />
        <MetricCard accent="accent-green" label="Proventos processados" value={money.format(data.payroll.processedEarnings)} caption="Não representa custo total de pessoas" />
      </section>

      <section className="rh-dashboard-grid">
        <article className="panel rh-panel-wide">
          <div className="section-head section-row"><div><p className="eyebrow">Movimentação do quadro</p><h2>Como o quadro cresceu</h2></div><span className="pill">Jan a Ago/2026</span></div>
          <div className="rh-workforce-bridge">
            <div><span>01/01</span><strong>{data.workforce.start2026}</strong><small>CLTs no início</small></div><i>+</i>
            <div className="positive"><span>Entradas</span><strong>{data.workforce.hires}</strong><small>admissões</small></div><i>−</i>
            <div className="negative"><span>Saídas</span><strong>{data.workforce.terminations}</strong><small>desligamentos</small></div><i>=</i>
            <div><span>31/08</span><strong>{data.workforce.endAug2026}</strong><small>CLTs no fim</small></div>
          </div>
          <p className="rh-reading"><strong>Leitura:</strong> crescimento líquido de {data.workforce.netGrowth} pessoas ({pct(data.workforce.growthRate)}), mas foram necessários 82 movimentos para chegar a esse resultado.</p>
        </article>
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Presença</p><h2>Absenteísmo mensal</h2></div>
          <AbsenceChart />
          <p className="rh-reading">Pico em abril ({pct(5.77)}); agosto fechou em {pct(1.36)}. A queda é observada, mas o documento não atribui uma causa.</p>
        </article>
      </section>

      <section className="rh-dashboard-grid rh-dashboard-grid-balanced">
        <article className="panel"><div className="section-head"><p className="eyebrow">Apolonis × Jacartta</p><h2>Comparativo das empresas</h2></div><CompanyComparison /></article>
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Prioridades do diagnóstico</p><h2>Fila de atenção</h2></div>
          <div className="rh-action-list">
            <div><span className="signal-danger">Crítico</span><strong>Entrada e experiência</strong><p>{pct(data.historicalTerminations.upTo90DaysRate)} das saídas ocorreram até 90 dias.</p></div>
            <div><span className="signal-warning">Atenção</span><strong>Horas extras na Apolonis</strong><p>Concentra 66% das horas e {money.format(21237.53)}.</p></div>
            <div><span className="signal-warning">Atenção</span><strong>Ausências concentradas</strong><p>Os cinco maiores casos representam {pct(data.absence.top5ConcentrationRate)} das horas.</p></div>
            <div><span className="signal-muted">Lacuna</span><strong>Indicadores ainda abertos</strong><p>Turnover, tempo de contratação, custo total, setores e SST gerencial.</p></div>
          </div>
        </article>
      </section>
    </>
  );
}

function Recruitment() {
  return (
    <>
      <section className="metric-grid rh-metric-grid">
        <MetricCard accent="accent-red" label="Desligamentos históricos" value={nf.format(data.historicalTerminations.total)} caption={data.source.terminationPeriod} />
        <MetricCard accent="accent-yellow" label="Saída até 90 dias" value={pct(data.historicalTerminations.upTo90DaysRate)} caption="38 de 67 desligamentos" />
        <MetricCard accent="accent-violet" label="Saída até 6 meses" value={pct(data.historicalTerminations.upTo180DaysRate)} caption="50 de 67 desligamentos" />
        <MetricCard accent="accent-blue" label="Mediana até a saída" value={`${data.historicalTerminations.medianDays} dias`} caption="Todos os desligamentos históricos" />
        <MetricCard accent="accent-cyan" label="Ligados à experiência" value={pct(data.historicalTerminations.experienceRelatedRate)} caption="Rescisões relacionadas ao período" />
        <MetricCard accent="accent-red" label="Jacartta até 90 dias" value={pct(data.historicalTerminations.jacarttaUpTo90DaysRate)} caption={`Mediana de ${data.historicalTerminations.jacarttaMedianDays} dias`} />
      </section>

      <section className="rh-dashboard-grid rh-dashboard-grid-balanced">
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Permanência até a saída</p><h2>Onde os desligamentos se concentram</h2></div>
          <RecruitmentFunnel stages={earlyExitBuckets} />
          <p className="rh-reading">As faixas são grupos independentes, não etapas de conversão. A prioridade é revisar seleção, integração e acompanhamento dos primeiros 90 dias.</p>
        </article>
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Processo atual</p><h2>Base para o futuro funil</h2></div>
          <div className="rh-checklist">
            <div><span>Canal de recrutamento</span><b className="signal-good">Indeed + WhatsApp</b></div><div><span>Controle de vagas</span><b className="signal-warning">Planilha</b></div><div><span>Tempo de contratação</span><b className="signal-warning">Iniciando</b></div><div><span>Banco de talentos</span><b className="signal-warning">Em estruturação</b></div><div><span>Site de vagas</span><b className="signal-warning">Em estruturação</b></div><div><span>Turnover oficial</span><b className="signal-danger">Fórmula pendente</b></div>
          </div>
          <p className="rh-reading"><strong>Próxima captura obrigatória:</strong> data de abertura, entrada no funil, mudança de etapa, proposta, aceite e admissão.</p>
        </article>
      </section>

      <section className="panel rh-ai-flow-panel">
        <div className="section-head section-row"><div><p className="eyebrow">Fluxo futuro · recrutamento com IA</p><h2>Da primeira mensagem à admissão</h2></div><span className="pill">Automação com decisão humana</span></div>
        <p className="rh-flow-intro">O n8n coordena a jornada, o Supabase guarda o histórico canônico, o Chatwoot concentra a conversa e o CRM do Oráculo controla etapas, SLAs e responsáveis. A IA organiza evidências e recomenda; o RH decide.</p>
        <div className="rh-ai-flow" aria-label="Fluxograma completo do recrutamento com inteligência artificial">
          <div className="rh-flow-stage"><span>01 · Entrada</span><strong>Captação do candidato</strong><p>Site de carreiras, Indeed, indicação ou WhatsApp oficial.</p><b>Meta API + Chatwoot</b></div>
          <i>→</i>
          <div className="rh-flow-stage"><span>02 · Identidade</span><strong>Consentimento e cadastro</strong><p>LGPD, deduplicação, vaga de interesse e origem.</p><b>n8n + Supabase</b></div>
          <i>→</i>
          <div className="rh-flow-stage ai"><span>03 · IA</span><strong>Leitura e triagem</strong><p>Extrai currículo, identifica requisitos e aponta lacunas.</p><b>Evidências, não inferências</b></div>
          <i>→</i>
          <div className="rh-flow-stage"><span>04 · Conversa</span><strong>Perguntas objetivas</strong><p>A IA pergunta somente o que falta e registra cada resposta.</p><b>WhatsApp oficial</b></div>
          <i>→</i>
          <div className="rh-flow-stage ai"><span>05 · Análise</span><strong>Aderência explicável</strong><p>Score ponderado, evidências, pendências e confiança.</p><b>Oráculo CRM</b></div>
        </div>

        <div className="rh-flow-decision"><div><span>Informação insuficiente</span><strong>Volta para perguntas</strong><p>O candidato recebe uma solicitação clara; nunca perde pontos por dado ausente.</p></div><b>◆ Gate da IA</b><div><span>Análise completa</span><strong>Segue para o RH</strong><p>Resumo, score e evidências ficam disponíveis para revisão humana.</p></div></div>

        <div className="rh-ai-flow rh-ai-flow-second">
          <div className="rh-flow-stage human"><span>06 · Humano</span><strong>Revisão do RH</strong><p>Aprova avanço, pede complemento ou encerra com motivo.</p><b>Decisão registrada</b></div>
          <i>→</i>
          <div className="rh-flow-stage"><span>07 · Agenda</span><strong>Entrevista automática</strong><p>Disponibilidade, confirmação e lembretes ao candidato.</p><b>Google Agenda</b></div>
          <i>→</i>
          <div className="rh-flow-stage human"><span>08 · Humano</span><strong>Entrevista estruturada</strong><p>Roteiro por competência e parecer do entrevistador.</p><b>RH + gestor</b></div>
          <i>→</i>
          <div className="rh-flow-stage"><span>09 · Decisão</span><strong>Decisão final</strong><p>Aprovar, manter no banco ou encerrar com motivo estruturado.</p><b>Mensagem por evento</b></div>
          <i>→</i>
          <div className="rh-flow-stage success"><span>10 · Conversão</span><strong>Admissão e prontuário</strong><p>Documentos, checklist e criação do perfil em Pessoas.</p><b>Supabase Storage</b></div>
        </div>

        <div className="rh-flow-outcomes"><div className="approved"><span>Aprovado</span><strong>Proposta → aceite → admissão</strong><p>Gera documentos, checklist e perfil em Pessoas.</p></div><div className="talent"><span>Potencial futuro</span><strong>Banco de talentos</strong><p>Consentimento, prazo de retenção e vaga-alvo ficam registrados.</p></div><div className="closed"><span>Não avança</span><strong>Encerramento respeitoso</strong><p>Motivo estruturado, comunicação automática e auditoria da decisão.</p></div></div>

        <div className="rh-flow-foundation"><div><strong>Fila e retentativas</strong><span>Supabase Queues impede perda de mensagens e reprocessa falhas.</span></div><div><strong>Auditoria ponta a ponta</strong><span>Prompt, regra, resposta, score, mudança de etapa e autor ficam registrados.</span></div><div><strong>Exceção humana</strong><span>Baixa confiança, inconsistência ou tema sensível é encaminhado ao RH.</span></div><div><strong>Comunicação automática</strong><span>Confirmação, lembrete, pendência, avanço e encerramento usam templates aprovados.</span></div></div>
      </section>

      <section className="panel">
        <div className="section-head section-row"><div><p className="eyebrow">Método proposto · exemplo ilustrativo</p><h2>Aderência do candidato</h2></div><span className="pill">Explicável e auditável</span></div>
        <div className="rh-adherence-layout">
          <div className="rh-score-example"><span>Exemplo de aderência</span><strong>82%</strong><b>Confiança média</b><p>Esta nota não vem do diagnóstico e serve apenas para demonstrar o método futuro.</p></div>
          <div className="rh-criteria-list">{[["Competências técnicas", "30%", "25,8"], ["Experiência relacionada", "25%", "20,0"], ["Respostas situacionais", "20%", "15,2"], ["Condições objetivas da vaga", "15%", "15,0"], ["Completude das evidências", "10%", "6,0"]].map(([label, weight, result]) => <div key={label}><strong>{label}</strong><span>Peso {weight}</span><b>{result} pts</b></div>)}</div>
        </div>
        <div className="rh-method-notes"><p><strong>Cálculo:</strong> soma de (nota de 0 a 5 ÷ 5 × peso). Informação ausente vira pergunta pendente, nunca zero.</p><p><strong>Fora da análise:</strong> idade, gênero, raça, religião, estado civil, foto, deficiência, bairro, sotaque, aparência e demais atributos sensíveis.</p></div>
      </section>
    </>
  );
}

function People({ selectedId }: { selectedId?: string }) {
  const tenure = [["Até 3 meses", data.tenure.upTo3Months], ["3 a 6 meses", data.tenure.from3To6Months], ["6 a 12 meses", data.tenure.from6To12Months], ["Mais de 1 ano", data.tenure.over12Months]] as const;
  const selected = EMPLOYEE_DEMOS.find((employee) => employee.id === selectedId) ?? EMPLOYEE_DEMOS[0];
  return (
    <>
      <section className="metric-grid rh-metric-grid">
        <MetricCard accent="accent-blue" label="CLTs ativos" value={nf.format(data.workforce.clt)} caption={`${data.workforce.contractors} PJs acompanhados separadamente`} />
        <MetricCard accent="accent-green" label="Admissões" value={nf.format(data.workforce.hires)} caption={data.source.mainPeriod} />
        <MetricCard accent="accent-red" label="Desligamentos" value={nf.format(data.workforce.terminations)} caption={data.source.mainPeriod} />
        <MetricCard accent="accent-violet" label="Tempo médio de casa" value={`${nf.format(data.tenure.averageMonths)} meses`} caption={`Mediana: ${nf.format(data.tenure.medianMonths)} meses`} />
        <MetricCard accent="accent-yellow" label="Quadro com até 6 meses" value={pct(data.tenure.upTo6MonthsRate)} caption="27 de 48 CLTs" />
        <MetricCard accent="accent-cyan" label="Headcount médio diário" value={nf.format(data.workforce.averageDaily)} caption={data.source.mainPeriod} />
      </section>

      <section className="rh-dashboard-grid rh-dashboard-grid-balanced">
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Tempo de casa do quadro atual</p><h2>Distribuição dos 48 CLTs</h2></div>
          <div className="rh-tenure-bars">{tenure.map(([label, value]) => <div key={label}><span>{label}</span><div><i style={{ width: `${(value / data.workforce.clt) * 100}%` }} /></div><strong>{value}</strong></div>)}</div>
          <p className="rh-reading">Mais da metade do quadro está nos primeiros seis meses, reforçando a necessidade de onboarding e acompanhamento da experiência.</p>
        </article>
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Natureza das ausências</p><h2>Predominantemente justificadas</h2></div>
          <div className="rh-split-bar"><span style={{ width: `${data.absence.justifiedRate}%` }}>Justificadas · {pct(data.absence.justifiedRate)}</span><span style={{ width: `${data.absence.unjustifiedRate}%` }} aria-label={`Injustificadas ${pct(data.absence.unjustifiedRate)}`} /></div>
          <div className="rh-fact-grid"><div><span>Horas justificadas</span><strong>≈ {hours(data.absence.justifiedHours)}</strong></div><div><span>Horas injustificadas</span><strong>≈ {hours(data.absence.unjustifiedHours)}</strong></div><div><span>Com alguma ausência</span><strong>{data.absence.peopleWithAbsence} pessoas</strong></div><div><span>Sem ausência classificada</span><strong>{data.absence.peopleWithoutAbsence} pessoas</strong></div></div>
        </article>
      </section>

      <section className="rh-directory-notice"><div><strong>Prontuário 360º do colaborador</strong><p>A estrutura abaixo está pronta para centralizar todos os 52 vínculos. Os seis perfis visíveis são fictícios e servem somente para validar navegação, campos e histórico antes da importação dos cadastros reais.</p></div><span>0 de 52 importados</span></section>

      <section className="rh-people-workspace">
        <aside className="panel rh-employee-directory">
          <div className="section-head"><p className="eyebrow">Diretório de pessoas</p><h2>Colaboradores</h2></div>
          <div className="rh-directory-tools"><div>⌕ Buscar por nome, cargo ou área</div><span>Empresa · Área · Status · Contrato</span></div>
          <nav aria-label="Perfis demonstrativos de colaboradores">
            {EMPLOYEE_DEMOS.map((employee) => <Link key={employee.id} href={`/rh?visao=pessoas&colaborador=${employee.id}`} className={selected.id === employee.id ? "rh-employee-row active" : "rh-employee-row"}><span>{employee.initials}</span><div><strong>{employee.name}</strong><small>{employee.role} · {employee.company}</small></div><b>{employee.tenure}</b></Link>)}
          </nav>
          <p className="rh-directory-foot">Na produção: paginação, busca, filtros, exportação controlada e acesso conforme o papel do usuário.</p>
        </aside>

        <article className="panel rh-employee-profile">
          <header className="rh-profile-head"><span>{selected.initials}</span><div><p>Perfil funcional · demonstração</p><h2>{selected.name}</h2><small>{selected.role} · {selected.area} · {selected.company}</small></div><b className={selected.status === "Experiência" ? "signal-warning" : "signal-good"}>{selected.status}</b></header>
          <div className="rh-profile-tabs"><b>Visão geral</b><span>Histórico</span><span>Documentos</span><span>Ponto e ausências</span><span>Desenvolvimento</span><span>Remuneração</span></div>
          <div className="rh-profile-facts"><div><span>Admissão</span><strong>{selected.admission}</strong></div><div><span>Tempo de empresa</span><strong>{selected.tenure}</strong></div><div><span>Contrato</span><strong>{selected.contract}</strong></div><div><span>Gestor</span><strong>{selected.manager}</strong></div><div><span>Cadastro completo</span><strong>{selected.profileCompletion}%</strong></div><div><span>Próxima ação</span><strong>{selected.nextAction}</strong></div></div>
          <div className="rh-profile-body">
            <div><div className="section-head"><p className="eyebrow">Linha do tempo única</p><h3>Histórico funcional</h3></div><ol className="rh-employee-timeline">{selected.timeline.map((event) => <li key={`${event.date}-${event.title}`}><time>{event.date}</time><div><span>{event.category}</span><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol></div>
            <aside><strong>Centralizar neste perfil</strong>{["Dados pessoais e contatos", "Contrato, cargo e salário", "Documentos e assinaturas", "Ponto, faltas e atestados", "Férias e afastamentos", "Feedbacks, PDI e avaliações", "Treinamentos e certificados", "Equipamentos e acessos", "Promoções e movimentações", "Ocorrências e desligamento"].map((item) => <span key={item}>✓ {item}</span>)}</aside>
          </div>
          <div className="rh-profile-security"><strong>Acesso protegido:</strong> remuneração, documentos pessoais, saúde e ocorrências terão permissões específicas, trilha de auditoria e retenção definida pela LGPD.</div>
        </article>
      </section>

      <section className="panel"><div className="section-head"><p className="eyebrow">Comparativo consolidado</p><h2>Apolonis × Jacartta</h2></div><CompanyComparison /><p className="rh-reading"><strong>Ressalva:</strong> o absenteísmo representa a população disponível no histórico atual do ponto, não todo o histórico de pessoas desligadas.</p></section>

      <section className="rh-dashboard-grid rh-dashboard-grid-balanced">
        <article className="panel"><div className="section-head"><p className="eyebrow">Capacidade e retenção</p><h2>Horas extras</h2></div><div className="rh-fact-grid"><div><span>Total</span><strong>{hours(data.overtime.hours)}</strong></div><div><span>HE + DSR</span><strong>{money.format(data.overtime.amount)}</strong></div><div><span>Média mensal</span><strong>{money.format(data.overtime.monthlyAverageAmount)}</strong></div><div><span>Pico de agosto</span><strong>{hours(data.overtime.augustHours)}</strong></div></div><p className="rh-reading">A Apolonis reduziu o quadro e concentra 66% das horas extras. Ainda não há base para afirmar que HE causa desligamentos.</p></article>
        <article className="panel"><div className="section-head"><p className="eyebrow">Folha · proventos processados</p><h2>Dimensão financeira disponível</h2></div><div className="rh-fact-grid"><div><span>Proventos</span><strong>{money.format(data.payroll.processedEarnings)}</strong></div><div><span>Média mensal</span><strong>{money.format(data.payroll.monthlyAverage)}</strong></div><div><span>Líquido de rescisões</span><strong>{money.format(data.payroll.netTerminations)}</strong></div></div><p className="rh-reading"><strong>Atenção:</strong> proventos não são custo total. Podem incluir salário, férias, horas extras, comissões, variáveis e verbas rescisórias.</p></article>
      </section>
    </>
  );
}

function Development() {
  return (
    <>
      <section className="metric-grid rh-metric-grid rh-unavailable-grid">
        <MetricCard className="metric-text" accent="accent-white" label="Cobertura de PDI" value="Não apurado" caption="Precisa de cadastro de plano, responsável e prazo" />
        <MetricCard className="metric-text" accent="accent-white" label="PDI no prazo" value="Não apurado" caption="Sem histórico consolidado no diagnóstico" />
        <MetricCard className="metric-text" accent="accent-white" label="Trilhas publicadas" value="Não apurado" caption="Arquitetura proposta, sem medição oficial" />
        <MetricCard className="metric-text" accent="accent-white" label="Treinamentos realizados" value="Não apurado" caption="SST gerencial ainda em estruturação" />
        <MetricCard className="metric-text" accent="accent-white" label="Sucessores mapeados" value="Não apurado" caption="Cadastro necessário por posição crítica" />
      </section>
      <section className="rh-governance-rule"><strong>O que o diagnóstico permite concluir</strong><p>Há necessidade clara de estruturar desenvolvimento e sucessão, mas o PDF não contém contagens de PDI, conclusão de treinamentos ou sucessores. Esses indicadores só devem nascer após o cadastro oficial.</p></section>
      <section className="panel">
        <div className="section-head section-row"><div><p className="eyebrow">Arquitetura proposta</p><h2>Plano anual de desenvolvimento</h2></div><span className="pill">Sem percentual inventado</span></div>
        <div className="rh-quarter-grid">
          <div><span>T1 · Fundamentos</span><strong>Integração e segurança</strong><p>Onboarding, NR1, equipamentos, WMS, bipagem e POP da função.</p><b>Medir presença e conclusão</b></div><div><span>T2 · Indicadores</span><strong>Gestão orientada a dados</strong><p>Lideranças usando Oráculo, KPIs de área e rotina de decisão.</p><b>Medir aplicação prática</b></div><div><span>T3 · Liderança</span><strong>Comunicação e delegação</strong><p>Preparação de sucessores e desenvolvimento de gestores.</p><b>Medir evolução no PDI</b></div><div><span>T4 · Avaliação</span><strong>Carreira e próximos ciclos</strong><p>Revisão de PDI, cargos, salários e plano do ano seguinte.</p><b>Medir avanço de nível</b></div>
        </div>
      </section>
      <section className="panel">
        <div className="section-head"><p className="eyebrow">Trilha proposta da função de RH</p><h2>Do operacional ao estratégico</h2></div>
        <div className="rh-career-track"><div><span>Nível 1</span><strong>Analista de RH Operacional</strong><p>Rotinas, admissões, benefícios e processos definidos.</p></div><div><span>Nível 2</span><strong>Analista de RH Pleno</strong><p>Seleção antecipada, protocolo e PDI de uma área.</p></div><div><span>Nível 3</span><strong>Coordenação / Especialista</strong><p>Cargos, salários, trilhas e indicadores consolidados.</p></div><div><span>Nível 4</span><strong>Head de RH Estratégico</strong><p>Planejamento, sucessão, retenção e parceria com a direção.</p></div></div>
      </section>
    </>
  );
}

function Governance() {
  const maturityLabel: Record<string, [string, string]> = { operating: ["Operando", "signal-good"], manual: ["Manual", "signal-warning"], building: ["Estruturando", "signal-warning"], pending: ["Padronizar", "signal-danger"] };
  return (
    <>
      <section className="metric-grid rh-metric-grid">
        <MetricCard accent="accent-blue" label="Fontes atuais" value={nf.format(data.source.sources.length)} caption="Ponto, folha, rescisões e relatórios internos" />
        <MetricCard accent="accent-yellow" label="Processos mapeados" value={nf.format(data.processMap.length)} caption="Operacionais, manuais e em estruturação" />
        <MetricCard accent="accent-red" label="Indicadores não fechados" value={nf.format(data.notClosed.length)} caption="Definição ou fonte ainda pendente" />
        <MetricCard accent="accent-violet" label="Prioridades definidas" value="5" caption="Entrada, HE, ausência, padrão e integração" />
      </section>
      <section className="rh-dashboard-grid rh-dashboard-grid-balanced">
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Como o RH funciona hoje</p><h2>Mapa de processos e sistemas</h2></div>
          <div className="rh-process-map">{data.processMap.map((item) => { const [label, className] = maturityLabel[item.maturity]; return <div key={item.process}><strong>{item.process}</strong><span>{item.status}</span><b className={className}>{label}</b></div>; })}</div>
        </article>
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Decisão sensível · protocolo proposto</p><h2>Governança de desligamento</h2></div>
          <ol className="rh-protocol"><li><span>1</span><div><strong>Identificar o motivo</strong><p>Data, contexto e responsável.</p></div></li><li><span>2</span><div><strong>Reunir evidências</strong><p>Indicadores, feedbacks e ocorrências.</p></div></li><li><span>3</span><div><strong>Revisar PDI e avisos</strong><p>Chance real de correção, salvo falta grave.</p></div></li><li><span>4</span><div><strong>Escalonar à direção</strong><p>Validação antes da comunicação.</p></div></li><li><span>5</span><div><strong>Decidir e comunicar</strong><p>Respeito, clareza e pessoas corretas.</p></div></li><li><span>6</span><div><strong>Arquivar o processo</strong><p>Registro para auditoria e aprendizado.</p></div></li></ol>
        </article>
      </section>
      <section className="panel"><div className="section-head"><p className="eyebrow">Backlog de dados</p><h2>O que falta fechar antes de automatizar</h2></div><div className="rh-not-closed">{data.notClosed.map((item, index) => <div key={item}><span>{index + 1}</span><strong>{item}</strong></div>)}</div></section>
      <section className="rh-governance-rule"><strong>Regra de centralização</strong><p>O Supabase deverá guardar o dado canônico, a origem, o período e a data de atualização. Planilhas e sistemas externos serão fontes de ingestão; o Oráculo será a camada de análise e governança.</p></section>
    </>
  );
}

function ViewContent({ view, selectedEmployee }: { view: RhView; selectedEmployee?: string }) {
  if (view === "recrutamento") return <Recruitment />;
  if (view === "pessoas") return <People selectedId={selectedEmployee} />;
  if (view === "desenvolvimento") return <Development />;
  if (view === "governanca") return <Governance />;
  return <Overview />;
}

export default async function RhPage({ searchParams }: { searchParams?: Promise<{ visao?: string | string[]; colaborador?: string | string[] }> }) {
  const [{ allowed }, alertCount] = await Promise.all([requireTabAccess("rh"), loadActionableAlertCount()]);
  if (!allowed) return <NoAccess tab="rh" />;
  const params = searchParams ? await searchParams : {};
  const raw = Array.isArray(params.visao) ? params.visao[0] : params.visao;
  const selectedEmployee = Array.isArray(params.colaborador) ? params.colaborador[0] : params.colaborador;
  const view = VIEWS.some((item) => item.key === raw) ? (raw as RhView) : "visao-geral";
  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar rh-topbar"><div><p className="eyebrow">Pessoas · inteligência de RH</p><h1>Gestão de Pessoas</h1><p>Indicadores para contratar melhor, reduzir saídas precoces, dimensionar capacidade e estruturar o RH.</p></div><div className="rh-topbar-actions"><span className="pill">Jan a Ago/2026</span><button type="button" disabled>Exportar apresentação</button></div></header>
      <SourceNotice /><RhNavigation active={view} /><ViewContent view={view} selectedEmployee={selectedEmployee} />
    </AppShell>
  );
}
