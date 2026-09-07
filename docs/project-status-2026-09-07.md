# Status do projeto — 07/09/2026

## Oráculo restaurado; Giracasa pausada na interface

O domínio `oraculo.oliverhome.com.br` foi apontado para o deploy estável `dpl_4seDnHYCyQydNmYzgioTYSGs8iEe`, gerado pelo commit `69f73f2` em 04/09/2026. A interface voltou a usar as rotas originais (`/`, `/skus` etc.) e não oferece seleção de operação.

O rollback ocorreu porque a publicação multioperação deixava a navegação real presa no skeleton após o login, mesmo quando testes HTTP isolados concluíam. A versão estável foi conferida em produção com usuário técnico: `/` respondeu 200 com conteúdo renderizado em 5,3 s e `/skus` respondeu 200 em 0,5 s. O usuário técnico foi removido ao final.

## Estado preservado da Giracasa

As migrations já aplicadas, scripts, testes e documentação da Giracasa permanecem no repositório e no Supabase. O schema `giracasa` continua sem pedidos e notas; a operação permanece `enabled=false`, sem usuários liberados, sem credenciais `GIRACASA_*` e sem jobs. As Edge Functions `giracasa-*` continuam sem fonte configurada e, portanto, não executam carga.

A próxima implementação deve partir de uma branch isolada e só voltar ao `main` depois de validar o fluxo completo em navegador com uma conta real, incluindo login, navegação RSC, troca de abas e carga concorrente. O domínio deve continuar preso à versão estável até essa validação.

## Recuperação aplicada

- alias de produção apontado diretamente para `dpl_4seDnHYCyQydNmYzgioTYSGs8iEe`;
- código web revertido ao estado do commit `69f73f2`;
- migrations e artefatos da Giracasa preservados como histórico aplicado;
- alterações locais não relacionadas mantidas fora do rollback.
