# Política de Privacidade e Tratamento de Dados

**Organização:** Jacartta Atacado e Varejo — CNPJ 42.033.601/0001-40
**Aplicação:** Oráculo — plataforma interna de inteligência de vendas
**URL pública:** https://oraculo.oliverhome.com.br/politica-de-dados
**Versão:** 1.0 · **Vigente desde:** 28 de julho de 2026
**Contato de privacidade e segurança:** juliano@oliverhome.com.br

Esta política descreve como a nossa organização coleta, processa, armazena, usa,
compartilha e descarta os dados obtidos da Amazon através da Selling Partner API
(SP-API), bem como os dados equivalentes obtidos de outros marketplaces onde
operamos.

---

## 1. Escopo e papel da organização

Somos **desenvolvedor privado**: construímos e operamos uma aplicação que integra
a **nossa própria conta de vendedor** aos nossos sistemas internos. Não
desenvolvemos, vendemos ou licenciamos software para terceiros, e não atuamos
como prestador de serviço para outros vendedores.

Todo o tratamento descrito aqui ocorre exclusivamente em benefício da própria
organização e é realizado por seus funcionários.

## 2. Dados coletados

Coletamos, via SP-API, exclusivamente dados transacionais e de catálogo
necessários à operação comercial:

- identificadores e status de pedidos;
- itens de pedido, SKU, ASIN, quantidade e valores;
- preços, promoções e informações de listagem;
- posições e movimentações de estoque;
- eventos financeiros, tarifas, comissões e repasses;
- relatórios agregados de desempenho de vendas.

**Não solicitamos, não recebemos e não armazenamos informações pessoais
identificáveis (PII) de compradores** — nome, endereço de entrega, telefone,
e-mail, documento ou dados de pagamento. Não requisitamos as funções (*roles*)
da SP-API que dão acesso a esses campos. Caso um campo com PII seja retornado de
forma incidental por uma API, ele é descartado no momento da ingestão e não é
persistido.

## 3. Como os dados são processados

A coleta é feita por rotinas automatizadas em funções serverless, autenticadas
com credenciais próprias da organização (Login with Amazon), executadas em
intervalos programados.

Os dados recebidos são normalizados, associados às nossas chaves internas de
produto e pedido, e agregados em métricas de negócio: receita por período,
ranking de SKUs, margem por canal, custo efetivo de marketplace (*take rate*) e
cobertura de estoque.

Nenhum tratamento é realizado por processos manuais fora dos sistemas descritos,
e nenhum dado é processado em máquinas pessoais.

## 4. Onde e como os dados são armazenados

- **Banco de dados:** PostgreSQL gerenciado (Supabase), hospedado em provedor de
  nuvem com certificação SOC 2 Tipo II.
- **Aplicação:** plataforma serverless gerenciada (Vercel), sem servidores
  próprios expostos e sem servidores de arquivos.
- **Criptografia em repouso:** AES-256 em bancos, backups e armazenamento de
  objetos, acima do mínimo de AES-128 exigido pela Política de Proteção de Dados
  da Amazon.
- **Criptografia em trânsito:** TLS 1.2 ou superior, com TLS 1.3 por padrão, em
  todas as chamadas à SP-API, conexões de banco e acesso via navegador.
- **Segredos:** credenciais da SP-API e *refresh tokens* são mantidos em cofre de
  segredos gerenciado, nunca no código-fonte, em repositórios ou em pacotes
  entregues ao navegador. As chaves são rotacionadas ao menos anualmente.

## 5. Como os dados são usados

Os dados são usados exclusivamente para fins internos de gestão do próprio
negócio:

- acompanhamento de receita e volume de pedidos;
- identificação de produtos mais vendidos e de baixo giro;
- análise de tarifas, comissões e rentabilidade por canal;
- planejamento de compras, importação e reposição de estoque;
- conciliação fiscal e financeira das vendas realizadas.

**Não usamos os dados** para publicidade, para construção de perfis de
consumidores, para treinamento de modelos de terceiros, nem para qualquer
finalidade competitiva envolvendo outros vendedores.

## 6. Compartilhamento

**Não vendemos, alugamos, licenciamos ou compartilhamos dados da Amazon com
terceiros.**

O acesso é limitado aos nossos próprios funcionários, mediante conta nominal
individual, autenticação multifator e concessão pelo princípio do menor
privilégio. A maior parte dos usuários acessa apenas relatórios agregados na
aplicação; o acesso direto ao banco é restrito a administradores nomeados.

Os únicos terceiros que tecnicamente processam os dados são os provedores de
infraestrutura utilizados para hospedagem e armazenamento, sob contrato escrito,
avaliados anualmente com base em suas atestações SOC 2 Tipo II, divulgação de
subprocessadores e compromissos de notificação de incidentes. Esses provedores
não têm permissão de uso próprio dos dados.

Dados poderão ser divulgados a autoridades apenas mediante ordem legal válida, e
a Amazon será notificada quando permitido por lei.

## 7. Retenção e descarte

- Dados da Amazon são etiquetados na ingestão e retidos por, no máximo,
  **18 meses**.
- Rotina automatizada agendada (`pg_cron`) exclui permanentemente os registros
  brutos que ultrapassam esse prazo. Apenas agregados não reversíveis — que não
  permitem reconstruir o registro original — são mantidos além dele.
- Como não armazenamos PII, o limite de 30 dias após a entrega não se aplica;
  caso passemos a tratar PII, esse limite será adotado.
- A exclusão utiliza métodos seguros padrão de mercado e se propaga aos backups
  dentro do ciclo de rotação de backup.
- Em caso de encerramento da integração ou revogação de autorização, todos os
  dados da Amazon são excluídos e a Amazon é notificada da conclusão.

## 8. Segurança da informação

- Contas nominais únicas, senhas de no mínimo 12 caracteres com complexidade e
  autenticação multifator obrigatória; contas compartilhadas são proibidas.
- Menor privilégio aplicado por papéis de banco e *Row Level Security*.
- Revisão trimestral de acessos e revogação em até 24 horas após desligamento ou
  mudança de função.
- Log de auditoria centralizado e somente-anexação, retido por 12 meses, com
  registro de data/hora, identidade, endpoint, IP de origem e resultado, revisado
  quinzenalmente e com alertas para padrões anômalos.
- Varredura de vulnerabilidades a cada 30 dias, correção de itens críticos em até
  7 dias e de alto risco em até 30 dias, e teste de intrusão anual.
- Endpoints corporativos com disco criptografado, firewall ativo, proteção contra
  malware atualizada mensalmente e bloqueio de gravação em mídia removível.

## 9. Resposta a incidentes

Mantemos plano escrito de resposta a incidentes, com ponto focal designado,
revisado e exercitado semestralmente, cobrindo detecção, contenção, erradicação,
recuperação e revisão pós-incidente.

Qualquer incidente de segurança real ou suspeito envolvendo dados da Amazon é
comunicado à Amazon em até **24 horas** da descoberta, seguido de análise de
causa raiz e resumo de remediação por escrito.

## 10. Alterações desta política

Alterações materiais são registradas com nova versão e data de vigência nesta
mesma página. O histórico de versões é mantido no controle de versão do projeto.

## 11. Contato

Dúvidas sobre esta política, solicitações relativas a dados ou comunicação de
incidentes: **juliano@oliverhome.com.br**.

Consulte também os [Termos de Serviço](https://oraculo.oliverhome.com.br/termos-de-servico).
