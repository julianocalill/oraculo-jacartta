import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Serviço — Oráculo",
  description:
    "Condições aplicáveis ao acesso e ao uso autorizado da plataforma interna Oráculo."
};

// Página pública para consulta e cadastros de integrações. Fonte editorial em
// docs/termos-de-servico.md: alterar os dois juntos.

const ORG = "Jacartta Atacado e Varejo";
const CNPJ = "42.033.601/0001-40";
const CONTATO = "juliano@oliverhome.com.br";
const VERSAO = "1.0";
const VIGENTE_DESDE = "18 de agosto de 2026";

type Bloco =
  | { tipo: "p"; texto: string }
  | { tipo: "lista"; itens: string[] };

type Secao = {
  titulo: string;
  blocos: Bloco[];
};

const SECOES: Secao[] = [
  {
    titulo: "1. Aceitação e escopo",
    blocos: [
      {
        tipo: "p",
        texto:
          "Estes Termos disciplinam o acesso e o uso do Oráculo. Ao acessar a aplicação com uma conta autorizada, o usuário declara que leu e concorda em cumprir estes Termos, as políticas internas aplicáveis e a legislação vigente."
      },
      {
        tipo: "p",
        texto:
          "O Oráculo é uma plataforma privada de inteligência operacional, desenvolvida e mantida para uso interno da Jacartta Atacado e Varejo e de pessoas expressamente autorizadas pela organização. A publicação destes Termos não representa oferta, venda ou licenciamento do sistema ao público ou a outros vendedores."
      }
    ]
  },
  {
    titulo: "2. Acesso autorizado e contas",
    blocos: [
      {
        tipo: "lista",
        itens: [
          "O acesso depende de autorização prévia da organização e pode ser limitado conforme a função de cada usuário.",
          "A conta é pessoal e intransferível. O usuário deve manter suas credenciais em sigilo e não pode compartilhar a conta ou permitir o acesso de terceiros.",
          "O usuário deve informar imediatamente qualquer suspeita de uso indevido, comprometimento de credenciais ou incidente de segurança.",
          "A organização pode exigir autenticação adicional, redefinição de credenciais ou outras medidas razoáveis de segurança."
        ]
      }
    ]
  },
  {
    titulo: "3. Finalidade da plataforma",
    blocos: [
      {
        tipo: "p",
        texto:
          "O Oráculo consolida dados de sistemas internos, ERPs, marketplaces e outros provedores autorizados para apoiar atividades como acompanhamento de vendas, estoque, logística, publicidade, rentabilidade, conciliação e planejamento operacional."
      },
      {
        tipo: "p",
        texto:
          "As funcionalidades disponíveis podem variar por usuário, integração, canal de venda e etapa de desenvolvimento. A organização pode incluir, alterar ou descontinuar funcionalidades quando necessário para a operação, a segurança ou o cumprimento de obrigações legais e contratuais."
      }
    ]
  },
  {
    titulo: "4. Uso permitido e responsabilidades do usuário",
    blocos: [
      {
        tipo: "p",
        texto:
          "O usuário deve utilizar a plataforma exclusivamente para atividades profissionais autorizadas e de acordo com as orientações da organização. É proibido:"
      },
      {
        tipo: "lista",
        itens: [
          "acessar dados, contas, áreas ou recursos sem autorização;",
          "copiar, exportar, divulgar ou utilizar informações para finalidade pessoal ou estranha às atividades da organização;",
          "inserir dados falsos, enganosos, ilícitos ou que violem direitos de terceiros;",
          "tentar contornar controles de acesso, explorar vulnerabilidades, interferir na disponibilidade ou realizar engenharia reversa indevida;",
          "compartilhar dados obtidos de marketplaces em desacordo com as regras das respectivas plataformas;",
          "usar o Oráculo para praticar fraude, violar a lei ou causar dano à organização, a terceiros ou aos provedores integrados."
        ]
      },
      {
        tipo: "p",
        texto:
          "O usuário é responsável pela exatidão das informações que inserir, pelas ações realizadas em sua conta e pelo tratamento adequado dos dados aos quais tiver acesso."
      }
    ]
  },
  {
    titulo: "5. Dados pessoais e confidencialidade",
    blocos: [
      {
        tipo: "p",
        texto:
          "O tratamento de dados pessoais e de dados provenientes de integrações é descrito na Política de Privacidade e Tratamento de Dados do Oráculo. O usuário deve preservar a confidencialidade de informações comerciais, fiscais, financeiras, operacionais e pessoais acessadas por meio da plataforma, inclusive após o encerramento de seu acesso."
      }
    ]
  },
  {
    titulo: "6. Serviços e integrações de terceiros",
    blocos: [
      {
        tipo: "p",
        texto:
          "O Oráculo pode se conectar a marketplaces, ERPs, serviços de nuvem e outras plataformas independentes. Esses serviços são regidos por seus próprios termos, políticas, limites técnicos e regras de disponibilidade. O usuário deve respeitar também as condições aplicáveis a cada serviço integrado."
      },
      {
        tipo: "p",
        texto:
          "Alterações, indisponibilidades, atrasos, limitações ou erros em serviços de terceiros podem afetar dados e funcionalidades do Oráculo sem que a organização tenha controle sobre a causa externa."
      }
    ]
  },
  {
    titulo: "7. Propriedade intelectual",
    blocos: [
      {
        tipo: "p",
        texto:
          "O software, a identidade visual, os textos, os modelos de dados, os relatórios e os demais elementos próprios do Oráculo pertencem à organização ou são utilizados sob licença. A autorização de acesso é limitada, revogável, não exclusiva e vinculada às atividades profissionais autorizadas; ela não transfere ao usuário qualquer direito de propriedade intelectual."
      },
      {
        tipo: "p",
        texto:
          "Marcas, conteúdos e dados de terceiros permanecem sujeitos aos direitos de seus respectivos titulares."
      }
    ]
  },
  {
    titulo: "8. Disponibilidade e natureza das informações",
    blocos: [
      {
        tipo: "p",
        texto:
          "A organização emprega esforços razoáveis para manter o Oráculo seguro e disponível, mas pode realizar manutenções, correções e interrupções sem garantia de operação contínua ou livre de erros."
      },
      {
        tipo: "p",
        texto:
          "Painéis, estimativas, alertas e cálculos servem como apoio à gestão. Eles podem depender de dados incompletos, atrasados ou incorretos recebidos de terceiros e não substituem a conferência nos sistemas de origem, documentos fiscais, registros contábeis ou avaliação profissional quando exigida. Decisões relevantes devem observar os controles e aprovações internos aplicáveis."
      }
    ]
  },
  {
    titulo: "9. Suspensão e encerramento do acesso",
    blocos: [
      {
        tipo: "p",
        texto:
          "A organização pode restringir, suspender ou encerrar o acesso em caso de desligamento, mudança de função, risco de segurança, violação destes Termos, exigência legal ou necessidade operacional. Quando possível e compatível com a segurança, o usuário será informado sobre a medida."
      }
    ]
  },
  {
    titulo: "10. Responsabilidade",
    blocos: [
      {
        tipo: "p",
        texto:
          "Cada parte responde pelos danos que causar por ação ou omissão contrária à lei, a estes Termos ou às políticas internas aplicáveis. Na máxima extensão permitida pela legislação, a organização não responde por falhas causadas exclusivamente por serviços de terceiros, uso não autorizado, descumprimento das orientações de segurança ou decisões tomadas sem a conferência indicada nestes Termos."
      },
      {
        tipo: "p",
        texto:
          "Nada nestes Termos exclui ou limita responsabilidade que não possa ser afastada pela legislação aplicável."
      }
    ]
  },
  {
    titulo: "11. Alterações destes Termos",
    blocos: [
      {
        tipo: "p",
        texto:
          "Estes Termos podem ser atualizados para refletir mudanças legais, operacionais, técnicas ou de segurança. A versão e a data de vigência serão indicadas nesta página. Quando uma alteração for material para usuários ativos, a organização adotará meio razoável de comunicação interna."
      }
    ]
  },
  {
    titulo: "12. Legislação aplicável",
    blocos: [
      {
        tipo: "p",
        texto:
          "Estes Termos são regidos pelas leis da República Federativa do Brasil. Eventuais controvérsias serão submetidas ao foro competente definido pela legislação aplicável, sem prejuízo da tentativa de solução administrativa junto à organização."
      }
    ]
  }
];

export default function TermosDeServicoPage() {
  return (
    <main
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "48px 24px 96px",
        color: "var(--text)",
        lineHeight: 1.7
      }}
    >
      <header style={{ borderBottom: "1px solid var(--line)", paddingBottom: 24, marginBottom: 32 }}>
        <h1 style={{ fontSize: 30, lineHeight: 1.25, margin: "0 0 16px" }}>
          Termos de Serviço
        </h1>
        <dl style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          <div>
            <dt style={{ display: "inline", fontWeight: 600 }}>Organização: </dt>
            <dd style={{ display: "inline", margin: 0 }}>
              {ORG} — CNPJ {CNPJ}
            </dd>
          </div>
          <div>
            <dt style={{ display: "inline", fontWeight: 600 }}>Aplicação: </dt>
            <dd style={{ display: "inline", margin: 0 }}>
              Oráculo — plataforma interna de inteligência operacional
            </dd>
          </div>
          <div>
            <dt style={{ display: "inline", fontWeight: 600 }}>Versão: </dt>
            <dd style={{ display: "inline", margin: 0 }}>
              {VERSAO} · vigente desde {VIGENTE_DESDE}
            </dd>
          </div>
          <div>
            <dt style={{ display: "inline", fontWeight: 600 }}>Contato: </dt>
            <dd style={{ display: "inline", margin: 0 }}>{CONTATO}</dd>
          </div>
        </dl>
      </header>

      <p style={{ marginTop: 0 }}>
        Estes Termos estabelecem as condições de acesso e uso do Oráculo. Consulte também a{" "}
        <a href="/politica-de-dados" style={{ color: "var(--gold)" }}>
          Política de Privacidade e Tratamento de Dados
        </a>
        .
      </p>

      {SECOES.map((secao) => (
        <section key={secao.titulo} style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 19, margin: "0 0 12px" }}>{secao.titulo}</h2>
          {secao.blocos.map((bloco, indice) =>
            bloco.tipo === "p" ? (
              <p key={indice} style={{ margin: "0 0 12px" }}>
                {bloco.texto}
              </p>
            ) : (
              <ul key={indice} style={{ margin: "0 0 12px", paddingLeft: 22 }}>
                {bloco.itens.map((item) => (
                  <li key={item} style={{ marginBottom: 6 }}>
                    {item}
                  </li>
                ))}
              </ul>
            )
          )}
        </section>
      ))}

      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 19, margin: "0 0 12px" }}>13. Contato</h2>
        <p style={{ margin: 0 }}>
          Dúvidas, solicitações ou comunicações relacionadas a estes Termos: {" "}
          <a href={`mailto:${CONTATO}`} style={{ color: "var(--gold)" }}>
            {CONTATO}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
