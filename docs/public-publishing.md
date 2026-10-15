# Publicação pública e evidências privadas

O remote `personal` é público. Dados reais de pedidos, notas, custos, margens,
extratos e relatórios de clientes devem permanecer no repositório privado ou
fora do Git. Testes públicos usam dados fictícios. Não copie evidências privadas
para textos de commit, exemplos SQL ou documentação pública.

O histórico público foi preparado em uma cópia separada. Nunca faça merge,
pull seguido de push, ou push do histórico antigo do checkout privado para o
remote público: isso pode reintroduzir as evidências retiradas. Para atualizar
o público, use um checkout do histórico sanitizado e aplique somente o diff de
código revisado, com testes fictícios. A publicação requer revisão do conteúdo
e de todos os commits enviados. O repositório privado mantém as evidências.

A reescrita altera hashes. A branch principal pública só deve ser substituída
com aprovação explícita e `--force-with-lease` no SHA remoto conferido. Não use
`--mirror`: branches não afetadas devem ser preservadas. A referência de merge
de PR é controlada pelo GitHub; caches ou referências antigas podem exigir
atendimento do GitHub e coordenação com quem possui clones anteriores.

O backend fiscal, as credenciais e os dados de produção não são recriados por
esta limpeza. A configuração de de-para de custo é privada e deve ser carregada
por um administrador autorizado, separadamente do DDL público.
