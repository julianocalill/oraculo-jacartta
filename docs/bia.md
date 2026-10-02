# B.ia — assistente de dados somente leitura

Publicada em 02/10/2026, commit `caa4bcc` nos dois remotes.
Vercel confirmou **Ready**: [deploy](https://oraculo-jacartta-iwq1vth1z-grupo-jacartta.vercel.app),
domínio [Oráculo](https://oraculo.oliverhome.com.br).
Login, personagem e bloqueio sem sessão conferidos por HTTP; consulta pela
interface de produção aguarda login do usuário.
Evidência: [bia-deploy-2026-10-02.json](analyses/bia-deploy-2026-10-02.json).
Decisão: [ADR-008](adr/ADR-008-bia-read-only.md).
Etapas para publicação e evolução: [bia-producao.md](bia-producao.md).

## Correção de respostas — 02/10/2026

Relato recebido: quantidade de devoluções respondeu apresentação e depois
vendas. Não havia histórico nas duas abas observadas; as perguntas originais
não foram recuperadas. Testes reproduzem variantes desse relato. Posteriormente apareceu na aba de produção “Olá, me traga um relatório de devoluções de ontem”, com resposta genérica de cobertura; essa frase exata também entrou na regressão.

Devolução (singular/plural e variações), reembolso e estorno agora recebem
uma resposta específica: ferramenta ainda indisponível na B.ia, com link
para Devoluções. Repetição não muda o assunto. Não consulta a RPC comercial
nem o modelo nesse caminho. A classificação da IA nunca autoriza uma
consulta que o planejador não reconheça como suportada.

SKU é exato; busca por nome pesquisa somente o nome do produto. Valores e
comparações de produto somam os itens correspondentes antes do top N.
A contagem de NFs distintas por produto não é fornecida. Os cards da tela
comercial continuam globais; a resposta explica essa diferença e aponta
as linhas para conferência. Filtro vazio não apresenta valores de outros
produtos. Medida, período, canal e produto aparecem antes da resposta.

Continuação conserva período/canal/produto/medida mesmo sem começar com “E”.
Comparação de quantidade/margem não é convertida para faturamento.
Filtro, loja, medida ou dia parcial não reconhecido pede esclarecimento.
Dados incompletos e margem pendente mantêm seus avisos e valores pendentes.

130 testes passaram; TypeScript e build conferidos. Sem mudança de banco,
permissões ou retenção. Publicação/validação visual em andamento, registrada
no status de 02/10.

## Uso e cobertura

A **B.ia** abre pelo personagem no canto inferior direito, em um painel de
chat lateral nas páginas autorizadas do Oráculo. Ela acompanha a operação
selecionada e não ocupa um item no menu lateral.
O usuário precisa das permissões `bia` e `analise-comercial` nessa operação.
Administradores seguem o comportamento existente; usuários comuns precisam
da liberação da permissão B.ia em Usuários. Esta entrega não modifica concessões.

Primeira versão: faturamento por emissão de NF válida Olist, unidades dos itens
disponíveis, ranking por receita/unidades/margem, margem ponderada, filtro
por produto/SKU e comparação de faturamento entre períodos. Exemplos:

- “Quanto faturamos na Shopee em setembro?”
- “Top 10 produtos mais vendidos da Shopee Donacor no mês passado”
- “Quais produtos têm margem abaixo de 15% este mês?”
- “Margem do SKU 213997 em setembro”
- “Compare setembro com agosto”
- Depois de uma consulta: “E a margem?” ou “E na Donacor?”

Datas: hoje, ontem, anteontem, este mês, mês passado, últimos N dias,
meses por nome/AAAA-MM e datas completas DD/MM/AAAA ou AAAA-MM-DD.
Máximo 366 dias, até 20 produtos por resposta. Sem período explícito, o
padrão é mês atual até hoje na primeira pergunta; continuações conservam o período anterior. A fonte mostra as datas efetivamente usadas.
Uma família de canais soma as lojas correspondentes do catálogo real.
Os links da fonte permitem conferir cada parcela na Análise Comercial.

Estoque, reposição, devoluções, Ads, pedidos, carteira, dados pessoais,
causas de mudanças, comparação entre operações, filtros de exclusão e
custos pendentes ainda não têm ferramentas no chat. A B.ia informa esse
limite. Não inventa resposta nem substitui um canal ausente por todas as lojas.

## Arquitetura e modelo

`BiaChat → /o/<operação>/bia/responder → planejador → consulta fixa → resposta`.

Usa o **Ollama existente na VPS**, com **qwen2.5-coder:7b** conforme
`OLLAMA_MODEL`. Não treinamos um modelo do zero. O serviço Next.js continua
na Vercel e chama o endpoint protegido da VPS pelo backend. Reutiliza
`OLLAMA_URL`, `OLLAMA_MODEL` e `OLLAMA_TOKEN`; nenhum segredo vai ao navegador.
Não há nova infraestrutura, tabela, migration ou cron.

O modelo faz uma classificação curta de intenção/ordenação (uma chamada,
JSON limitado, até 64 tokens de saída, contexto 2048, timeout 12 s).
Recebe somente a pergunta atual, sem resultados comerciais, schema,
credenciais ou histórico de respostas. O código resolve datas, canais,
filtros, cálculos e redação dos números; o modelo não gera SQL.
Receitas reconhecidas continuam funcionando quando o Ollama falha ou não
está configurado, com o rótulo “Consulta verificada”.

Contexto das últimas oito perguntas reconstituído no servidor. Planos,
resultados e nomes de ferramentas enviados pelo cliente são rejeitados.
Se uma pergunta antiga depender de interpretação não reconstituível, um
seguimento pede a pergunta completa em vez de assumir filtros diferentes.
A conversa fica na memória React do layout persistente, sem banco ou
localStorage. Minimizar/reabrir e navegar entre páginas da mesma operação
preservam perguntas, respostas e rascunho. “Nova conversa”, recarregar, sair
da conta, trocar operação/usuário ou perder acesso à fonte limpa o contexto.
`BiaAccess` registra no provider apenas permissões/configuração do AppShell
validado pelo servidor; cada consulta continua revalidada na rota.
No celular, o painel trava a rolagem de fundo e mantém o foco na conversa;
Escape ou o botão de minimizar fecha o painel. A rota antiga `/bia`
redireciona para uma página permitida com `?bia=1`, abrindo o mesmo chat.

## Contrato de leitura

- Recusa de pedidos de mudança antes do modelo e do banco.
- Sem ferramentas de escrita, SQL livre, execução de comandos, envio de
  mensagens ou acesso às APIs dos marketplaces.
- Cliente próprio com chave anon + JWT real, sem `service_role`, inclusive
  em desenvolvimento. O mock local de login não pode consultar dados.
- Allowlist de saída: apenas GET/POST para
  `/rest/v1/rpc/oraculo_commercial_analysis` no Supabase configurado.
  POST é a chamada da função de leitura, não uma escrita. Outras RPCs,
  tabelas, métodos e destinos são bloqueados; redirects são rejeitados.
- Middleware fixa operação/schema, e a rota revalida acesso à B.ia e à
  Análise Comercial em cada turno. A operação nunca vem do corpo.
- Wrappers do banco auditados em 02/10: função STABLE SECURITY DEFINER,
  search_path vazio e verificação explícita de associação à operação via
  `can_access_operation`; implementações internas STABLE SECURITY INVOKER
  só consultam os caches comerciais. A autorização não depende apenas do prompt.
- Respostas privadas sem cache HTTP, erro sem detalhes de credenciais.

O loader é o mesmo de `/analise-comercial`, agora com injeção opcional de
cliente. As regras compartilhadas permanecem em `@oraculo/domain`.
Margem não vira zero quando falta custo/comissão; dados ausentes não viram
faturamento zero. A cobertura, dias pendentes, atraso de atualização, NFs
sem itens e limitações do resultado aparecem na resposta.

## Operação e diagnóstico

Limites locais ao processo: 6 consultas/minuto por usuário/operação, uma
consulta ativa por chave e uma inferência B.ia por processo. Não constituem
limitação distribuída entre instâncias Vercel nem coordenam outros clientes
do Ollama. Até 8 lojas por família, consultas sequenciais, 10 s por RPC,
45 s por requisição; frontend cancela após 55 s. Servidor exporta
`maxDuration = 60`.

Para desenvolvimento com mock, iniciar Next com hostname `localhost` e acessar
`http://localhost:3012/o/uberlandia/bia` (ou Giracasa). Hostname 127.0.0.1
interagiu com o rewrite existente e produziu redirects repetidos; não foi
necessário modificar middleware. Uma sessão real é necessária para dados.
Para testar login real, usar build de produção + next start local pelo
launcher `scripts/bia/local-real.mjs` e o proxy SSH documentado no
[plano de produção](bia-producao.md). Essa preparação está disponível em 02/10;
a sessão real já foi conferida pela tela, com consulta de hoje alinhada à
Análise Comercial. A homologação completa por mês/loja e as demais perguntas
do plano de produção continuam pendentes.

Publicação: novidade ajustada para 11:30 BRT; 118 testes, TypeScript/build
passaram, commit enviado a origin e personal, Vercel Ready confirmado.
Próxima verificação, com usuário autorizado: conferir
resposta de setembro contra a tela da mesma operação/canal, testar
seguimento, recusa de alteração e Giracasa; confirmar classificação pelo
Ollama no endpoint protegido. Não abrir o endpoint nem alterar autenticação.

Diagnóstico: “IA indisponível” pode significar configuração local ausente;
timeout/malformed JSON fazem fallback. Erro de sessão exige login real.
Sem permissão de fonte, nenhuma consulta é feita. Atraso ou vazio do cache
deve ser tratado pela Análise Comercial existente, não por um refresh no chat.

## Validação desta entrega

- Testes de domínio e contrato da rota cobrem permissões, injeção, bloqueio
  de escrita/destino, datas/filtros, margem parcial, ausência de dados,
  comparação, consolidação e contrato do Ollama.
- 118 testes passaram (25 da B.ia e 93 existentes de domínio),
  TypeScript e build de produção; interface desktop e viewport 390 × 844.
  A interface recusou uma mudança de custo e bloqueou a consulta com mock
  local sem JWT real; largura de conteúdo móvel ficou dentro do viewport.
- Catálogo e definições das funções de ambas operações verificados por SQL
  de leitura no Supabase, sem alteração do banco.
- Ollama real validado em 02/10 pela rede privada: seis intenções corretas,
  JSON válido e 1,6–2,2 s com modelo carregado (11,1 s no primeiro uso).
  Classificador do app também passou pelo proxy SSH local (10,5 s).
  [Evidência](analyses/bia-validacao-ollama-2026-10-02.json).
- Painel lateral validado com sessão real em localhost: consulta de hoje
  com IA conferiu receita, NFs, unidades, margem e resultado com a tela
  comercial; pedido de alterar custo recusado. Menu sem item B.ia, histórico
  e rascunho preservados entre Análise Comercial e Agenda, minimizar/reabrir
  preserva conversa, Escape retorna foco e libera rolagem no celular.
  Troca Uberlândia → Giracasa limpa a conversa. Ranking de três produtos
  de hoje também conferiu com a tela; tabela rola dentro do painel móvel
  sem aumentar a largura do documento, e valores ficam em cards inteiros.
- No retorno pelo seletor à página Analytics de Uberlândia, uma consulta
  existente da página excedeu o timeout SQL (57014). O chat foi retomado pela
  Análise Comercial; não foi alterada a consulta da Analytics.
- Deploy Ready e domínio/asset conferidos em 02/10; GET `/bia` e POST da
  resposta sem sessão redirecionam ao login, sem expor dados.
- Homologação completa com dados reais e caminho Vercel → endpoint público
  autenticado ainda pendentes. Endpoint sem credencial confirmou 401.
  Metadados das três variáveis confirmados na Vercel como sensitive, sem ler valores.
  O download amplo de todas as variáveis de produção foi rejeitado pela
  revisão automática por exposição desnecessária de credenciais; não executado.

## Personagem

Arquivo: `apps/web/public/brand/bia/personagem.png`, 1280 × 1280 com alpha.
Gerado pela ferramenta integrada **image_gen**, sem API adicional ou seed
inventado. Robô cerâmico perolado, ouro, rosto índigo e olhos ciano; usado
na abertura e nos avatares. Prompt completo:

> Use case: stylized-concept. Asset type: transparent character illustration for the B.ia data assistant inside Oráculo, a dark premium business analytics app with gold tint and indigo/cyan accents. Primary request: create one original friendly feminine robot character named B.ia, polished three-dimensional editorial illustration, intelligent and approachable, professional rather than childish. Subject: a compact floating rounded assistant with pearl ceramic body, subtle brushed gold trim, a dark indigo glass face with two expressive soft cyan eyes, one small gold orbital halo inspired by an iris, rounded tiny arms with an open welcoming gesture. Feminine personality conveyed through gentle expression and graceful shapes, no sexualized elements. Composition: one centered character, entire body visible, generous clear margins, crisp silhouette readable as a small avatar, square canvas. Lighting: soft studio light with restrained gold and cyan highlights. Background: genuinely transparent alpha, no floor, no scene, no background shadow. Constraints: no text, no letters, no logos, no watermark, no charts or props, no other characters; beautiful and restrained, suitable for a professional dashboard.
