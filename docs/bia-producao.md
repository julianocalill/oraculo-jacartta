# B.ia — etapas para produção

Atualização 03/10: ampliação por setor publicada por autorização direta do
usuário. Commit `be6203f` nos dois remotes, Vercel Ready, domínio/asset e
proteção sem sessão confirmados. 150 testes e TypeScript reconferidos; build
Vercel passou. Sessão real desta ampliação aguarda novo login.
[Estado atual](project-status-2026-10-03.md).

Plano registrado em 02/10/2026 a pedido do usuário. A B.ia está implementada
e validada em localhost. Publicação em produção autorizada pelo usuário em
02/10 e concluída: commit `caa4bcc`, [Vercel Ready](https://oraculo-jacartta-iwq1vth1z-grupo-jacartta.vercel.app).
Domínio/asset e proteção sem login conferidos; teste autenticado na
interface publicada ainda aguarda login do usuário. Contrato completo:
[bia.md](bia.md). Decisão: [ADR-008](adr/ADR-008-bia-read-only.md).

Ordem ajustada pelo usuário: validar IA no servidor → login/dados reais em
localhost → preparar → implementar em produção → piloto → ampliar assuntos.

Ampliação solicitada em 02/10: todas as abas possuem fonte registrada, com
autorização própria e tratamento pelo nome. Contrato e limites em
[ADR-009](adr/ADR-009-bia-fontes-autorizadas.md). 150 testes, TypeScript e
build passaram; validação local desta ampliação em andamento. As etapas
abaixo mantêm o histórico da primeira publicação; piloto amplo permanece
pendente.

## Base funcional já pronta

Chat lateral flutuante e personagem, fora do menu; faturamento NF, produtos, margem e comparação de
faturamento; filtros de período/loja/SKU; fontes e cobertura; isolamento da
operação e ferramentas restritas à leitura. Última validação: 118 testes,
TypeScript, build e interface desktop/celular passaram.

## 1. Validar a IA no servidor — concluída para o caminho interno

Confirmar chamada do backend ao endpoint protegido da VPS usando a
configuração existente e qwen2.5-coder:7b. Verificar classificação JSON,
latência, cold start e fallback quando indisponível. A consulta funcionar
sem modelo não prova que a IA está conectada.

Usar configuração restrita às variáveis Ollama, ou execução no ambiente
que já as possui; não baixar todas as credenciais de produção. Uma tentativa
anterior desse download amplo foi rejeitada pela revisão automática e não
executada. Se acesso específico depender do usuário, pedir somente o acesso
necessário, sem solicitar que cole segredos no chat.

Validação real concluída por SSH na rede privada: 6/6 intenções corretas,
JSON válido, 11,077 s na primeira chamada e 1,566–2,202 s nas seguintes.
Ollama 0.30.6, modelo já instalado. Endpoint público sem credencial: 401.
O classificador real do app também passou pelo proxy SSH local (10,474 s).
Não alteramos serviços, modelos, credenciais ou banco. Fallback já coberto
pelos testes de contrato; será conferido também no teste com sessão real.
Evidências: [JSON](analyses/bia-validacao-ollama-2026-10-02.json).

Caminho público autenticado/Vercel ainda pendente; as três variáveis existentes
estão marcadas sensitive e seus valores não foram extraídos. Inicialização
fria ficou próxima do limite de 12 s; observar latência externa antes de abrir
o piloto. Não trocar modelo/hardware antes de medir concorrência.

## 2. Testar login e dados reais em localhost — em homologação

Frontend localhost preparado com modelo conectado e autenticação real.
Foi usado o build de produção + next start em localhost, que já exige login,
sem modificar a autenticação do app ou o mock padrão do next dev.
Sessão real do usuário conferida pela interface, sem extrair credenciais
ou usar JWT administrativo. Consulta de hoje com IA alinhada à tela
comercial (receita, NFs, unidades, margem e resultado). Pedido de alterar
custo recusado. Painel/rascunho preservados entre páginas; reset na troca
Uberlândia/Giracasa, menu sem item B.ia e foco/rolagem móvel conferidos.
Restam os demais cenários abaixo antes de encerrar esta etapa.
Testar com login real autorizado, sem credencial administrativa na B.ia:

- Painel lateral: ausência no menu, abrir/minimizar, conversa preservada ao
  navegar na mesma operação, reset na troca de operação e layout mobile.
- Mesmo período/canal na B.ia e na Análise Comercial: receita, unidades,
  ranking e margem devem conferir, com a mesma cobertura.
- Pergunta seguida de “E a margem?” ou mudança de loja mantém os filtros
  apresentados; datas ambíguas e fontes fora do escopo pedem esclarecimento.
- Uberlândia e Giracasa continuam isoladas. Troca de operação reinicia a
  conversa; usuário sem operação/aba/fonte não recebe dados.
- Pedidos de alterar custos/estoque, criar tarefas e executar SQL são
  recusados. As ferramentas permanecem exclusivamente de consulta.
- Dados ausentes, margem pendente, indisponibilidade e tempo excedido não
  produzem números inventados.

Saída: resultados registrados e diferenças resolvidas antes da publicação.

Reproduzir o ambiente (dois terminais, antes dos testes):

1. `python3 scripts/bia/ollama-ssh-local.py` — proxy temporário apenas em
   127.0.0.1:11435, SSH com chave/config existente e host key verificada.
2. Gerar o build em apps/web; depois, na raiz,
   `node scripts/bia/local-real.mjs` — Next start em localhost:3012.

O proxy usa o Python instalado no Open WebUI somente como cliente HTTP da
rede privada. Não grava nada remoto, não abre porta no servidor e não lê
tokens. Modelo/rota/tamanho limitados; perguntas não ficam em logs. O launcher
usa a URL/key anon local no middleware e mantém segredos fora do navegador.
Não executar next dev/build na mesma .next enquanto next start estiver ativo.
Encerrar os dois processos ao terminar o teste ou voltar ao dev padrão.

Smoke do classificador: `node scripts/bia/check-local-model.cjs`.
Validação interna por SSH: `scripts/bia/validate-ollama-server.py`.

## 3. Preparar a entrega — concluída

Diff da B.ia revisado; 118 testes, TypeScript e build passaram.
A entrega preserva alterações de outras tarefas,
inclusive nos documentos compartilhados. Ajustar a data da novidade para
a publicação efetiva. Reexecutar verificações se houver mudanças após a
última validação. Criar commit próprio com implementação, personagem,
contrato/ADR e contexto atualizado.

Definir os usuários do piloto e as permissões por operação. O novo chat não
deve conceder automaticamente acesso à fonte. Não há migration nem carga
de dados prevista para esta versão.

## 4. Implementar em produção — deploy concluído; conferência autenticada pendente

Entrega enviada para origin e personal; Vercel acompanha personal.
Commit `caa4bcc`, deploy Ready e domínio oficial confirmados.
HTTP 200 no login e PNG; rotas B.ia sem sessão redirecionam ao login.
[Evidência](analyses/bia-deploy-2026-10-02.json).
Após o usuário entrar na aba de produção, conferir navegação,
personagem, consulta real, fonte e recusa de mudança no ambiente publicado.
Commit/deploy e evidência já registrados em README, CHANGELOG e status.
Publicada; a consulta autenticada na interface continua pendente e não
foi substituída por JWT administrativo ou transferência de cookies locais.

Se houver regressão, restaurar o frontend anterior pelo fluxo normal de
rollback Vercel. A B.ia não cria tabelas nem escreve dados comerciais,
portanto não exige reversão de dados.

## 5. Piloto e abertura gradual — pendente

Começar com um grupo pequeno de usuários autorizados. Medir acerto das
perguntas reais, latência, timeouts, carga/RAM da VPS e simultaneidade.
Os limites atuais são por processo e não coordenam múltiplas instâncias
Vercel nem outros clientes do Ollama. Antes de abrir para mais usuários,
avaliar com essas medidas se precisa de fila/limitação distribuída.

Monitorar falhas e duração sem registrar tokens, resultados comerciais ou
conversas completas. Decidir ajustes a partir de evidências do piloto.

## 6. Ampliar os assuntos da B.ia — backlog

Adicionar estoque/reposição, devoluções, Ads e reconciliação conforme as
perguntas prioritárias. Cada domínio exige consulta fixa auditada, permissão
da fonte, cálculos canônicos, indicação de cobertura e testes. A regra
"apenas responder e nunca alterar dados" vale também para essas evoluções.
Essa ampliação não é requisito para publicar a primeira versão comercial.
