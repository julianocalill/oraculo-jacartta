# Estado do projeto — 02/10/2026

## B.ia — correção de respostas fora do assunto

O usuário relatou que uma pergunta sobre quantidade de devoluções recebeu
apresentação pessoal e, ao repetir, um relatório de vendas. As duas abas
observadas estavam sem perguntas: não foi possível recuperar o histórico
original, pois o chat guarda somente memória React. O relato gerou testes
com perguntas representativas, sem atribuir a eles texto histórico recuperado.
Posteriormente a aba de produção mostrou “Olá, me traga um relatório de
devoluções de ontem”, com resposta genérica de cobertura. Essa frase exata
também entrou na regressão; a conversa aberta foi preservada.

O planejador agora reconhece devolução no singular/plural, variações de
escrita, reembolso e estorno antes da IA. Responde que essa consulta ainda
não está disponível no chat e oferece a tela Devoluções. Repetir a pergunta
ou fazê-la após vendas produz o mesmo limite; nenhuma consulta comercial
ou inferência é feita para essas perguntas. Assuntos ambíguos pedem
esclarecimento; a classificação do modelo não pode autorizar vendas.

SKU corresponde exatamente. Cards e comparações de produto somam apenas
os itens desse filtro, antes do limite do ranking. Quantidade responde
unidades; margem pendente não vira zero; filtro vazio não mostra totais de
outros produtos. Continuação mantém período, canal, produto e medida; a
resposta exibe esses filtros. Medidas/filtros/datas não suportados não são
silenciosamente descartados. Permissões e contrato de leitura permanecem.

Na produção, a consulta de unidades do SKU 215780 revelou um falso positivo
`write` do classificador: a rota recusou a leitura. O veto por rótulo do
modelo foi retirado; pedidos reais de alteração continuam barrados pelo
código antes da inferência. Regressão própria cobre esse caso.

Validação: 131 testes de domínio/contrato passaram; TypeScript e build
passaram. Publicada: commits `b5775e2` e `7f1c1f3` nos dois remotes, Vercel
[Ready](https://oraculo-jacartta-bifgpl0sv-grupo-jacartta.vercel.app), domínio
oficial confirmado. Sessão real em produção: resposta específica de
devoluções, singular e repetição após consulta comercial conferidos.
Unidades/receita/margem/resultado do SKU 215780 de hoje conferiram com a
linha da Análise Comercial; fonte, filtros e rótulo de IA visíveis.
Viewport 390 × 844: documento e painel dentro da largura.
A sessão localhost expirou; a validação visual final ocorreu na produção.
[Evidência](analyses/bia-respostas-validacao-2026-10-02.json).
Sem migration, novas ferramentas de banco ou retenção de conversa.
Contrato atualizado: [bia.md](bia.md).

## B.ia — publicada em produção

Chat flutuante à direita: B.ia, assistente com personagem original, Ollama
qwen2.5-coder:7b existente e respostas de faturamento NF, produtos/margem e
comparação de faturamento entre períodos. Somente a operação selecionada,
com permissões próprias e da Análise Comercial verificadas em cada turno.
Consulta fixa STABLE com JWT; sem escrita, SQL livre, admin client ou
armazenamento de conversa. O personagem abre/minimiza o painel lateral,
sem item no menu. Conversa e rascunho ficam em memória entre páginas da mesma
operação; recarregar, logout ou troca de operação/usuário limpa o contexto.
Permissão `bia` preservada em Usuários e `/bia` abre o painel por redirect.
Publicação autorizada pelo usuário em 02/10 e concluída: commit `caa4bcc`
enviado a origin e personal, deploy [Vercel](https://oraculo-jacartta-iwq1vth1z-grupo-jacartta.vercel.app)
**Ready**, domínio `https://oraculo.oliverhome.com.br`. Novidade: 11:30 BRT.
Não há migration ou alteração de dados nesta entrega.

Fontes e cálculos reutilizados da tela comercial, com datas, canais,
atualização e cobertura explícitos. Personagem PNG transparente e interface
desktop/mobile conferidos. 118 testes de domínio/contrato, TypeScript e build
passaram. Catálogo/definições SQL das duas operações auditados por leitura.
Ollama real validado posteriormente por SSH/rede privada: 6/6 intenções
corretas, 11,077 s no primeiro uso e 1,566–2,202 s com modelo carregado.
Classificador do app passou pelo proxy SSH (10,474 s). Endpoint público sem
credencial: 401. Nenhum serviço remoto/modelo ou dado foi alterado.
Painel lateral conferido com sessão real em localhost: consulta de hoje
com IA alinhada à tela comercial (receita, NFs, unidades, margem e resultado),
recusa de alteração, histórico/rascunho entre páginas, abrir/minimizar e
reset na troca Uberlândia/Giracasa. Layout móvel e foco/rolagem conferidos.
Produção: login/PNG com HTTP 200; rota B.ia e resposta sem sessão
redirecionam ao login (307), sem expor dados. Na entrega inicial, a interface de produção aguardava
login do usuário para consultar com JWT real e confirmar Vercel → Ollama;
a correção descrita acima já confirmou esse caminho com consulta por SKU.
[Evidência de deploy](analyses/bia-deploy-2026-10-02.json).
Homologação ampliada continua pendente; caminho público autenticado
confirmado na correção acima. Revisão automática havia bloqueado baixar todas as variáveis de
produção por exposição excessiva; nenhuma credencial foi extraída.

Contrato, configuração e validação antes/depois da publicação:
[`docs/bia.md`](bia.md). Decisão: [ADR-008](adr/ADR-008-bia-read-only.md).
Plano de publicação registrado a pedido do usuário:
[`docs/bia-producao.md`](bia-producao.md), começando pela conexão real com
Ollama e homologação com sessão real. Localhost agora roda next start com
login obrigatório e proxy SSH local. Sessão real e consulta de hoje conferidas;
demais cenários de homologação permanecem na homologação ampliada do piloto.
Ordem confirmada: IA → login/dados em localhost → preparar → produção →
piloto → ampliar assuntos. Publicação autorizada após a validação local,
Ready e domínio confirmados; piloto/expansão ainda não iniciados.

## Estado anterior de produção

Antes desta entrega, o frontend estava no estado de `docs/project-status-2026-10-01.md`, com
Separação sem Full e Grupo congelado, cenários Shopee Ads e correções de
Devoluções. B.ia acrescentada em produção; não há migration nesta entrega. A conciliação de Separação com o lote de etiquetas segue pendente.
