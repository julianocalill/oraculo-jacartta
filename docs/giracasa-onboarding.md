# Ativação da Giracasa no Oráculo

Giracasa/SP existe como operação isolada e começa com `enabled=false`. A tela informa “em preparação” enquanto faltarem credenciais ou validação. Nunca ative para substituir ausência de fonte por zeros.

## Credenciais

Configure secrets próprios com prefixo `GIRACASA_`. São obrigatórios ao menos os equivalentes atuais de Olist/Tiny, Shopee, Mercado Livre e demais fontes usadas. Mesmo que endpoint ou segredo tenham o mesmo valor, cadastre-o com o prefixo; o builder não possui fallback para o nome de Uberlândia.

Gere as funções em diretório temporário:

```bash
node scripts/build-operation-functions.mjs --operation=giracasa --out=/tmp/giracasa-functions
```

Revise `MANIFEST.json` e faça o deploy de cada pasta com seu nome
`giracasa-*`. Cada cliente escreve no schema `giracasa`. Tokens, lojas,
cursores e runs começam vazios.

### Olist/Tiny pelo Aplicativo API OAuth

A Giracasa usa um **Aplicativo API** próprio na Olist, com OAuth e API V3. A URL
de redirecionamento cadastrada no aplicativo deve ser exatamente:

```text
https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/giracasa-olist-oauth-callback
```

Configure os secrets exclusivos abaixo:

| Grupo | Variáveis |
| --- | --- |
| Aplicativo | `GIRACASA_OLIST_API_CLIENT_ID`, `GIRACASA_OLIST_API_CLIENT_SECRET` |
| OAuth | `GIRACASA_OLIST_API_TOKEN_URL`, `GIRACASA_OLIST_OAUTH_AUTHORIZE_URL`, `GIRACASA_OLIST_OAUTH_REDIRECT_URI`, `GIRACASA_OLIST_OAUTH_SCOPE`, `GIRACASA_OLIST_OAUTH_STATE_SECRET` |
| API | `GIRACASA_OLIST_API_BASE_URL=https://api.tiny.com.br/public-api/v3/` |
| Execução | `GIRACASA_OLIST_SYNC_JOB_SECRET` |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` pertencem ao projeto compartilhado
e são as únicas variáveis sem prefixo permitidas nos artefatos gerados. Os
testes falham se uma função Giracasa tentar ler outro secret sem `GIRACASA_`.
O Client ID e o Client Secret devem ser cadastrados diretamente no Supabase e
nunca enviados por chat, gravados no Git ou expostos ao navegador. Marketplace,
AIS, Bip e demais fontes entram em gates posteriores.

Depois dos secrets, gere a URL de autorização com
`giracasa-olist-sync-health`, conclua o consentimento na conta Giracasa e
confirme que o refresh token foi salvo no schema `giracasa`. Valide a identidade
da empresa antes de iniciar qualquer escrita de dados de negócio.

## Carga inicial de 40 dias

Primeiro conecte Olist/Tiny e faça um teste de uma janela fechada de um dia. Confira o plano sem acessar nenhuma conta:

```bash
node scripts/giracasa-backfill.mjs --plan
```

Depois execute a carga:

```bash
SUPABASE_URL=... GIRACASA_OLIST_SYNC_JOB_SECRET=... node scripts/giracasa-backfill.mjs
```

O padrão é uma janela inclusiva de 40 dias terminando hoje. O script divide a
carga em blocos de no máximo 14 dias e limita cada chamada às Edge Functions a
poucas páginas. Enquanto um bloco estiver incompleto, ele faz outra chamada com
`resume=true`, reutilizando o cursor gravado no banco. Isso evita uma execução
longa disputar recursos com Uberlândia ou exceder o tempo de vida da função.

Em caso de erro, retome da primeira data ainda não concluída:

```bash
node scripts/giracasa-backfill.mjs --start=2026-08-20 --end=2026-09-08 --plan
```

Revise o plano e repita o comando com as variáveis de ambiente, removendo
`--plan`. Importe outras fontes também em janelas limitadas pelos respectivos
contratos; Shopee continua sendo executada por loja.

## Validação e ativação

1. Execute `supabase/tests/operation-isolation.sql` num banco descartável.
2. Compare primeiro uma janela fechada de um dia com Olist/Tiny; depois confira os 40 dias: NFs válidas, receita, pedidos, itens e estoque.
3. Compare exemplos do Financeiro: nacional/importado, SP interno, venda interestadual, crédito explícito e transferência importada. Lucro deve ficar pendente sem custo, tarifa, UF ou regra necessária.
4. Valide Agenda, RPA, etiquetas, importações, devoluções, reconciliação, exports, status e usuários autorizados.
5. Cadastre crons com nomes `giracasa-*`, mesmos limites da fonte e horários defasados dos jobs de Uberlândia. Não programe um cache sem expor seu `refreshed_at` no status.
6. Somente então marque `public.oraculo_operations.enabled=true` e registre `activated_at=now()` em nova migration. A migration de ativação também deve criar os jobs.

Para rollback operacional, desative a linha e remova/pausa os jobs `giracasa-*`. Preserve o schema para diagnóstico; não apague nem copie dados para `public`.

## Motor financeiro

Versão inicial `gira-casa-v1`: origem SP; ICMS nacional de 18% para SP, 12% para MG/PR/RJ/RS/SC e 7% para as demais UFs; importado de 18% para SP e 4% fora; PIS/COFINS de 9,25% com crédito quando aplicável; DIFAL somente interestadual; receita pela NF válida.

Custos seguem o Financeiro: líquido explícito, créditos recuperáveis explícitos, transferência comprovada de importado (4% + 11,75%) e custo bruto. Sem comprovação, Giracasa conserva o custo bruto. Exceções ficam em `giracasa.oraculo_financial_product_rules` por SKU e vigência.

O contrato completo, inclusive a diferença deliberada na base de receita e o
controle para evitar crédito duplicado de PIS/COFINS, está em
`docs/giracasa-financial-contract.md`.

## Registro da implantação

Em 05/09/2026 as migrations de cadastro, isolamento, motor financeiro e exposição controlada do schema foram executadas em produção. Pós-check: 101 tabelas, 94 funções e 34 views no schema Giracasa; zero pedidos, zero notas, zero concessões e `enabled=false`. As 26 Edge Functions `giracasa-*` foram publicadas.

Em 08/09/2026 o OAuth exclusivo foi configurado e o callback armazenou o token
no schema `giracasa`. As leituras iniciais de `/info`, `/produtos` e `/pedidos`
responderam `401`; por isso nenhuma carga foi iniciada. A tela confirmou o
aplicativo na empresa CNPJ 42.033.601/0001-40 e os módulos selecionados. O gate
exige confirmar as permissões do usuário OAuth nessa empresa. As chaves devem
ser regeneradas e o consentimento repetido somente se alguma permissão for
alterada; `/info` deve
responder `200` antes do canário de um dia.

Em 08/09/2026 a janela inicial foi reduzida de 90 para 40 dias. A preparação
passou a ocorrer em branch isolada, sem reintroduzir rotas ou seletor no login
antes da validação dos dados e do motor financeiro.
