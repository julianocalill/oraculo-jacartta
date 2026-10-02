# Estado do projeto — 02/10/2026

## B.ia — publicação em andamento

Chat flutuante à direita: B.ia, assistente com personagem original, Ollama
qwen2.5-coder:7b existente e respostas de faturamento NF, produtos/margem e
comparação de faturamento entre períodos. Somente a operação selecionada,
com permissões próprias e da Análise Comercial verificadas em cada turno.
Consulta fixa STABLE com JWT; sem escrita, SQL livre, admin client ou
armazenamento de conversa. O personagem abre/minimiza o painel lateral,
sem item no menu. Conversa e rascunho ficam em memória entre páginas da mesma
operação; recarregar, logout ou troca de operação/usuário limpa o contexto.
Permissão `bia` preservada em Usuários e `/bia` abre o painel por redirect.
Publicação autorizada pelo usuário em 02/10. Commit e deploy em preparação;
não há migration ou alteração de dados nesta entrega.

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
Homologação completa e caminho público autenticado continuam pendentes. Revisão automática havia bloqueado baixar todas as variáveis de
produção por exposição excessiva; nenhuma credencial foi extraída.

Contrato, configuração e validação antes/depois da publicação:
[`docs/bia.md`](bia.md). Decisão: [ADR-008](adr/ADR-008-bia-read-only.md).
Plano de publicação registrado a pedido do usuário:
[`docs/bia-producao.md`](bia-producao.md), começando pela conexão real com
Ollama e homologação com sessão real. Localhost agora roda next start com
login obrigatório e proxy SSH local. Sessão real e consulta de hoje conferidas;
restam os demais cenários de homologação antes da publicação.
Ordem confirmada: IA → login/dados em localhost → preparar → produção →
piloto → ampliar assuntos. Publicação autorizada após a validação local;
estado Ready e verificação do domínio serão registrados ao concluir.

## Estado anterior de produção

O frontend permanece no estado de `docs/project-status-2026-10-01.md`, com
Separação sem Full e Grupo congelado, cenários Shopee Ads e correções de
Devoluções. A publicação da B.ia está em andamento; não há migration nesta entrega. A conciliação de Separação com o lote de etiquetas segue pendente.
