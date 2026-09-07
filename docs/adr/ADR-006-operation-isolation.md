# ADR-006: Isolamento das operações por namespace

## Status

Accepted — implementação pronta; Giracasa permanece desativada até configurar e validar as contas próprias.

## Contexto

Uberlândia/MG e Giracasa/SP compartilham o produto Oráculo e podem ter SKUs e IDs externos iguais. Dados, custos, regras fiscais, pessoas em tarefas, credenciais e caches não podem atravessar operações. O acervo existente e centenas de consultas assumiam `public` e IDs globais; reescrever chaves de produção em uma única mudança aumentaria o risco de regressão.

## Decisão

- Uma instância Supabase e uma identidade de usuário.
- `public` é o namespace de Uberlândia e `giracasa` é o namespace de São Paulo.
- Todas as tabelas carregam `operation_id` constante e verificado no próprio namespace.
- URLs carregam a operação (`/o/<id>/...`) e o cliente PostgREST recebe `Accept-Profile`/`Content-Profile` no servidor.
- `app_metadata.operations` concede operação e abas. Giracasa exige concessão explícita; permissões antigas migram apenas para Uberlândia.
- RLS restritiva consulta `auth.users` para que revogação não espere renovação do JWT. Views e RPCs também possuem guarda, pois podem executar com privilégio do owner.
- Giracasa nasce desativada, sem dados e sem jobs. Não existe fallback para `public`.

## Consequências

IDs externos e SKUs podem se repetir sem colisão. Cada consulta usa apenas um namespace, e uma futura visão consolidada precisará de contrato próprio. Mudanças de estrutura comuns devem ser aplicadas aos dois namespaces; a cobertura será verificada nos testes de migração.

O código das Edge Functions continua único. `scripts/build-operation-functions.mjs` gera artefatos temporários da Giracasa com schema e variáveis de ambiente prefixadas, evitando bifurcar a regra de negócio ou reutilizar credenciais de MG.
