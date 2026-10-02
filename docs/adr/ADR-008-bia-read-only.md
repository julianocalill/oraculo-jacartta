# ADR-008: B.ia usa modelo local e ferramentas fechadas de leitura

## Status

Accepted — 02/10/2026. Publicada em produção; commit `caa4bcc`, Vercel Ready confirmado.

Ampliação de assuntos: [ADR-009](ADR-009-bia-fontes-autorizadas.md) qualifica
a receita inicial abaixo com GETs fixos de telas autorizadas e seleção de
fatos por IDs. As decisões desta ADR descrevem a primeira ferramenta.

## Contexto

O usuário quer perguntar sobre os dados do Oráculo por chat, com uma IA
operada na infraestrutura existente e sem custo de API por pergunta.
Exigência explícita: apenas responder e nunca alterar dados.
A VPS já executa Ollama com qwen2.5-coder:7b, e a Análise Comercial já possui
consulta/cálculos compartilhados e isolamento operacional.

## Decisão

- B.ia é um chat flutuante à direita, autorizado por operação, fora do menu
  lateral. Mantém a permissão `bia`, sem ampliar as permissões da fonte.
  A primeira ferramenta cobre a Análise Comercial.
- Ollama classifica apenas perguntas já validadas em um vocabulário fechado.
  Sua classificação não autoriza nem amplia a consulta. Código determina
  cobertura, filtros e cálculos e constrói a resposta verificável.
  Assuntos fora da cobertura recebem limite específico; ambiguidades pedem
  esclarecimento antes do modelo e do banco (revisão de 02/10/2026).
- Não há SQL livre, tool calling de escrita ou cliente administrativo.
  Um cliente JWT próprio só pode invocar a RPC comercial STABLE auditada.
- Conversas ficam em memória do provider no layout raiz, preservadas ao
  minimizar e navegar na mesma operação. Recarregar, logout ou troca de
  usuário/operação reinicia o contexto; não criamos armazenamento nem vetores.
  AppShell registra acesso no provider; autorização de dados continua na rota.
  `/bia` permanece como link de compatibilidade que abre o painel.
- Cada fonte futura exige uma ferramenta fixa auditada, autorização da aba
  de origem, critério de cobertura e testes do limite de leitura.
- Modelo indisponível mantém as receitas determinísticas funcionando.

## Consequências

O modelo não tem capacidade técnica de escolher uma mutação nem vê resultados
comerciais. As respostas preservam os critérios e limites da tela de origem.
Um escopo inicial explícito evita atribuir receita NF a pedidos, saldo ou Ads.
O modelo existente é reutilizado sem novo treinamento. Inferências curtas
reduzem carga na VPS sem GPU; carga/concorrência precisam ser medidas no piloto.
Trocar o modelo continua possível por configuração sem mudar a autorização.
