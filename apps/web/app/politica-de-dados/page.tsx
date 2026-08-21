import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade e Tratamento de Dados — Oráculo",
  description:
    "Como coletamos, processamos, armazenamos, usamos, compartilhamos e descartamos os dados obtidos da Amazon Selling Partner API e de outros marketplaces."
};

// Página pública (fora do login) — a Amazon exige URL acessível sem autenticação
// no cadastro de desenvolvedor da SP-API. Fonte editorial em
// docs/politica-de-tratamento-de-dados.md: alterar os dois juntos.

const ORG = "Jacartta Atacado e Varejo";
const CNPJ = "42.033.601/0001-40";
const CONTATO = "juliano@oliverhome.com.br";
const VERSAO = "1.0";
const VIGENTE_DESDE = "28 de julho de 2026";

type Bloco =
  | { tipo: "p"; texto: string }
  | { tipo: "lista"; itens: string[] };

type Secao = {
  titulo: string;
  blocos: Bloco[];
};

const SECOES: Secao[] = [
  {
    titulo: "1. Escopo e papel da organização",
    blocos: [
      {
        tipo: "p",
        texto:
          "Somos desenvolvedor privado: construímos e operamos uma aplicação que integra a nossa própria conta de vendedor aos nossos sistemas internos. Não desenvolvemos, vendemos ou licenciamos software para terceiros, e não atuamos como prestador de serviço para outros vendedores."
      },
      {
        tipo: "p",
        texto:
          "Todo o tratamento descrito aqui ocorre exclusivamente em benefício da própria organização e é realizado por seus funcionários."
      }
    ]
  },
  {
    titulo: "2. Dados coletados",
    blocos: [
      {
        tipo: "p",
        texto:
          "Coletamos, via SP-API, exclusivamente dados transacionais e de catálogo necessários à operação comercial:"
      },
      {
        tipo: "lista",
        itens: [
          "identificadores e status de pedidos;",
          "itens de pedido, SKU, ASIN, quantidade e valores;",
          "preços, promoções e informações de listagem;",
          "posições e movimentações de estoque;",
          "eventos financeiros, tarifas, comissões e repasses;",
          "relatórios agregados de desempenho de vendas."
        ]
      },
      {
        tipo: "p",
        texto:
          "Não solicitamos, não recebemos e não armazenamos informações pessoais identificáveis (PII) de compradores — nome, endereço de entrega, telefone, e-mail, documento ou dados de pagamento. Não requisitamos as funções (roles) da SP-API que dão acesso a esses campos. Caso um campo com PII seja retornado de forma incidental por uma API, ele é descartado no momento da ingestão e não é persistido."
      }
    ]
  },
  {
    titulo: "3. Como os dados são processados",
    blocos: [
      {
        tipo: "p",
        texto:
          "A coleta é feita por rotinas automatizadas em funções serverless, autenticadas com credenciais próprias da organização (Login with Amazon), executadas em intervalos programados."
      },
      {
        tipo: "p",
        texto:
          "Os dados recebidos são normalizados, associados às nossas chaves internas de produto e pedido, e agregados em métricas de negócio: receita por período, ranking de SKUs, margem por canal, custo efetivo de marketplace (take rate) e cobertura de estoque."
      },
      {
        tipo: "p",
        texto:
          "Nenhum tratamento é realizado por processos manuais fora dos sistemas descritos, e nenhum dado é processado em máquinas pessoais."
      }
    ]
  },
  {
    titulo: "4. Onde e como os dados são armazenados",
    blocos: [
      {
        tipo: "lista",
        itens: [
          "Banco de dados: PostgreSQL gerenciado (Supabase), hospedado em provedor de nuvem com certificação SOC 2 Tipo II.",
          "Aplicação: plataforma serverless gerenciada (Vercel), sem servidores próprios expostos e sem servidores de arquivos.",
          "Criptografia em repouso: AES-256 em bancos, backups e armazenamento de objetos, acima do mínimo de AES-128 exigido pela Política de Proteção de Dados da Amazon.",
          "Criptografia em trânsito: TLS 1.2 ou superior, com TLS 1.3 por padrão, em todas as chamadas à SP-API, conexões de banco e acesso via navegador.",
          "Segredos: credenciais da SP-API e refresh tokens são mantidos em cofre de segredos gerenciado, nunca no código-fonte, em repositórios ou em pacotes entregues ao navegador. As chaves são rotacionadas ao menos anualmente."
        ]
      }
    ]
  },
  {
    titulo: "5. Como os dados são usados",
    blocos: [
      {
        tipo: "p",
        texto:
          "Os dados são usados exclusivamente para fins internos de gestão do próprio negócio:"
      },
      {
        tipo: "lista",
        itens: [
          "acompanhamento de receita e volume de pedidos;",
          "identificação de produtos mais vendidos e de baixo giro;",
          "análise de tarifas, comissões e rentabilidade por canal;",
          "planejamento de compras, importação e reposição de estoque;",
          "conciliação fiscal e financeira das vendas realizadas."
        ]
      },
      {
        tipo: "p",
        texto:
          "Não usamos os dados para publicidade, para construção de perfis de consumidores, para treinamento de modelos de terceiros, nem para qualquer finalidade competitiva envolvendo outros vendedores."
      }
    ]
  },
  {
    titulo: "6. Compartilhamento",
    blocos: [
      {
        tipo: "p",
        texto:
          "Não vendemos, alugamos, licenciamos ou compartilhamos dados da Amazon com terceiros."
      },
      {
        tipo: "p",
        texto:
          "O acesso é limitado aos nossos próprios funcionários, mediante conta nominal individual, autenticação multifator e concessão pelo princípio do menor privilégio. A maior parte dos usuários acessa apenas relatórios agregados na aplicação; o acesso direto ao banco é restrito a administradores nomeados."
      },
      {
        tipo: "p",
        texto:
          "Os únicos terceiros que tecnicamente processam os dados são os provedores de infraestrutura utilizados para hospedagem e armazenamento, sob contrato escrito, avaliados anualmente com base em suas atestações SOC 2 Tipo II, divulgação de subprocessadores e compromissos de notificação de incidentes. Esses provedores não têm permissão de uso próprio dos dados."
      },
      {
        tipo: "p",
        texto:
          "Dados poderão ser divulgados a autoridades apenas mediante ordem legal válida, e a Amazon será notificada quando permitido por lei."
      }
    ]
  },
  {
    titulo: "7. Retenção e descarte",
    blocos: [
      {
        tipo: "lista",
        itens: [
          "Dados da Amazon são etiquetados na ingestão e retidos por, no máximo, 18 meses.",
          "Rotina automatizada agendada exclui permanentemente os registros brutos que ultrapassam esse prazo. Apenas agregados não reversíveis — que não permitem reconstruir o registro original — são mantidos além dele.",
          "Como não armazenamos PII, o limite de 30 dias após a entrega não se aplica; caso passemos a tratar PII, esse limite será adotado.",
          "A exclusão utiliza métodos seguros padrão de mercado e se propaga aos backups dentro do ciclo de rotação de backup.",
          "Em caso de encerramento da integração ou revogação de autorização, todos os dados da Amazon são excluídos e a Amazon é notificada da conclusão."
        ]
      }
    ]
  },
  {
    titulo: "8. Segurança da informação",
    blocos: [
      {
        tipo: "lista",
        itens: [
          "Contas nominais únicas, senhas de no mínimo 12 caracteres com complexidade e autenticação multifator obrigatória; contas compartilhadas são proibidas.",
          "Menor privilégio aplicado por papéis de banco e Row Level Security.",
          "Revisão trimestral de acessos e revogação em até 24 horas após desligamento ou mudança de função.",
          "Log de auditoria centralizado e somente-anexação, retido por 12 meses, com registro de data/hora, identidade, endpoint, IP de origem e resultado, revisado quinzenalmente e com alertas para padrões anômalos.",
          "Varredura de vulnerabilidades a cada 30 dias, correção de itens críticos em até 7 dias e de alto risco em até 30 dias, e teste de intrusão anual.",
          "Endpoints corporativos com disco criptografado, firewall ativo, proteção contra malware atualizada mensalmente e bloqueio de gravação em mídia removível."
        ]
      }
    ]
  },
  {
    titulo: "9. Resposta a incidentes",
    blocos: [
      {
        tipo: "p",
        texto:
          "Mantemos plano escrito de resposta a incidentes, com ponto focal designado, revisado e exercitado semestralmente, cobrindo detecção, contenção, erradicação, recuperação e revisão pós-incidente."
      },
      {
        tipo: "p",
        texto:
          "Qualquer incidente de segurança real ou suspeito envolvendo dados da Amazon é comunicado à Amazon em até 24 horas da descoberta, seguido de análise de causa raiz e resumo de remediação por escrito."
      }
    ]
  },
  {
    titulo: "10. Alterações desta política",
    blocos: [
      {
        tipo: "p",
        texto:
          "Alterações materiais são registradas com nova versão e data de vigência nesta mesma página. O histórico de versões é mantido no controle de versão do projeto."
      }
    ]
  }
];

export default function PoliticaDeDadosPage() {
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
          Política de Privacidade e Tratamento de Dados
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
              Oráculo — plataforma interna de inteligência de vendas
            </dd>
          </div>
          <div>
            <dt style={{ display: "inline", fontWeight: 600 }}>Versão: </dt>
            <dd style={{ display: "inline", margin: 0 }}>
              {VERSAO} · vigente desde {VIGENTE_DESDE}
            </dd>
          </div>
          <div>
            <dt style={{ display: "inline", fontWeight: 600 }}>Contato de privacidade e segurança: </dt>
            <dd style={{ display: "inline", margin: 0 }}>{CONTATO}</dd>
          </div>
        </dl>
      </header>

      <p style={{ marginTop: 0 }}>
        Esta política descreve como a nossa organização coleta, processa, armazena, usa, compartilha e
        descarta os dados obtidos da Amazon através da Selling Partner API (SP-API), bem como os dados
        equivalentes obtidos de outros marketplaces onde operamos.
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
        <h2 style={{ fontSize: 19, margin: "0 0 12px" }}>11. Contato</h2>
        <p style={{ margin: 0 }}>
          Dúvidas sobre esta política, solicitações relativas a dados ou comunicação de incidentes:{" "}
          <a href={`mailto:${CONTATO}`} style={{ color: "var(--gold)" }}>
            {CONTATO}
          </a>
          .
        </p>
        <p style={{ margin: "12px 0 0" }}>
          Consulte também os{" "}
          <a href="/termos-de-servico" style={{ color: "var(--gold)" }}>
            Termos de Serviço
          </a>
          .
        </p>
      </section>
    </main>
  );
}
