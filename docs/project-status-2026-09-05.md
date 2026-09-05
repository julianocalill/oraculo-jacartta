# Status do projeto — 05/09/2026

## Giracasa/SP em produção, aguardando credenciais

A fundação multioperação, o isolamento do banco e o motor financeiro `gira-casa-v1` foram aplicados no Supabase de produção. Uberlândia permanece no schema `public`; Giracasa usa o schema `giracasa`, exposto separadamente pelo PostgREST. O acervo de Uberlândia não foi copiado.

O schema paulista contém 101 tabelas, 94 funções e 34 views equivalentes, com `operation_id`, RLS restritiva e guardas nas views e RPCs. Pedidos e notas Giracasa continuam em zero. Nenhum usuário recebeu acesso e `oraculo_operations.enabled=false`.

As 26 Edge Functions `giracasa-*` estão publicadas e ativas, sempre com schema `giracasa` e secrets `GIRACASA_*`. Não há fallback para credenciais de Uberlândia. Ainda não existem secrets Giracasa no projeto, por isso nenhum cron foi criado e a carga de 90 dias não começou.

## Interface e autorização

O web app usa rotas `/o/uberlandia/*` e `/o/giracasa/*`. Usuários com uma operação entram diretamente; quem receber as duas verá o seletor. Links antigos apontam para Uberlândia. A operação ativa aparece no shell e pode ser trocada pelo menu.

Páginas, Server Actions, formulários e exportações conferem operação ativa e aba no servidor. Clientes Supabase enviam `Accept-Profile` e `Content-Profile`; caches globais incluem a operação na chave. A tela da Giracasa permanece em preparação enquanto a operação estiver desativada.

## Validação executada

- clone local limpo com as cinco migrations na ordem de produção;
- paridade de tabelas, funções e views;
- usuário apenas Uberlândia, apenas Giracasa, duas operações e acesso revogado;
- tentativa direta em tabela, view e RPC da outra operação;
- mesmo SKU nas duas operações com custos independentes;
- todas as views consultadas sob `authenticated`;
- 64 testes de domínio, TypeScript e build Next.js;
- exemplo SP→SP: receita 100, custo 40, ICMS 18, PIS/COFINS 5,55, DIFAL zero e lucro 26,45;
- REST `public` e `giracasa` respondendo 200, com Giracasa vazia;
- 26/26 Edge Functions Giracasa publicadas.

## Próximo passo operacional

Cadastrar as credenciais próprias da Olist/Tiny e de cada marketplace com prefixo `GIRACASA_`. Depois conectar as contas, importar 90 dias em blocos retomáveis, conferir cobertura e números fiscais, criar os jobs `giracasa-*`, conceder usuários e ativar a operação. O runbook é [giracasa-onboarding.md](giracasa-onboarding.md).

Em falha, mantenha `enabled=false` e os jobs ausentes ou pausados. O schema deve ser preservado para diagnóstico.
