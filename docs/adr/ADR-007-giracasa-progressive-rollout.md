# ADR-007: ativação progressiva da Giracasa

## Status

Accepted — 08/09/2026.

## Contexto

A primeira publicação da interface multioperação deixou sessões reais presas no
skeleton após o login. O banco isolado da Giracasa, seu motor financeiro e as
Edge Functions foram preservados, mas a interface voltou ao Oráculo estável de
Uberlândia. A Giracasa continua vazia, desativada e sem credenciais ou usuários.

## Decisão

- Uberlândia permanece nas rotas atuais durante toda a preparação da Giracasa.
- A carga inicial da Giracasa cobre 40 dias e começa por uma janela fechada de
  um dia usada como amostra de conferência.
- A carga é sequencial, retomável e dividida em blocos de até 14 dias. Cada
  chamada processa poucas páginas para limitar CPU, I/O e duração das Edge
  Functions.
- Dados e motor `gira-casa-v1` serão validados antes de qualquer seletor de
  operação aparecer no login ou no menu.
- A próxima interface usará segmentos reais do Next.js para
  `/o/giracasa/...`. Não será reintroduzida a reescrita global por middleware
  que participou da falha anterior.
- Login, navegação RSC, URL direta, exportações e duas abas simultâneas serão
  testados em um deployment de preview com uma conta real antes de promover o
  código ao `main`.
- A ativação continua sendo uma mudança separada: concede o primeiro usuário,
  habilita a operação e cria seus jobs somente depois da conferência fiscal.

## Consequências

O cronograma ganha uma etapa de validação, mas Uberlândia não recebe mudanças
de navegação enquanto a Giracasa ainda estiver incompleta. A carga consome o
mesmo banco de forma controlada e pode ser interrompida sem apagar o que já foi
importado. O retorno operacional continua sendo desabilitar a operação e seus
jobs, preservando os dados para diagnóstico.
