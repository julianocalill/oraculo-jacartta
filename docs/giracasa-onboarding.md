# Ativação da Giracasa no Oráculo

Giracasa/SP existe como operação isolada e começa com `enabled=false`. A tela informa “em preparação” enquanto faltarem credenciais ou validação. Nunca ative para substituir ausência de fonte por zeros.

## Credenciais

Configure secrets próprios com prefixo `GIRACASA_`. São obrigatórios ao menos os equivalentes atuais de Olist/Tiny, Shopee, Mercado Livre e demais fontes usadas. Mesmo que endpoint ou segredo tenham o mesmo valor, cadastre-o com o prefixo; o builder não possui fallback para o nome de Uberlândia.

Gere as funções em diretório temporário:

```bash
node scripts/build-operation-functions.mjs --operation=giracasa --out=/tmp/giracasa-functions
```

Revise `MANIFEST.json`, faça o deploy de cada pasta com seu nome `giracasa-*` e cadastre os callbacks OAuth com esses nomes. Cada cliente escreve no schema `giracasa`. Tokens, lojas, cursores e runs começam vazios.

## Carga de 90 dias

Primeiro conecte Olist/Tiny e faça um teste de uma janela fechada de um dia. Depois execute:

```bash
SUPABASE_URL=... GIRACASA_OLIST_SYNC_JOB_SECRET=... node scripts/giracasa-backfill-90d.mjs
```

O script trabalha em blocos de 14 dias, sequencialmente, e para no primeiro erro. Retome o bloco informado depois de corrigir a causa. Importe outras fontes também em janelas limitadas pelos respectivos contratos; Shopee continua sendo executada por loja.

## Validação e ativação

1. Execute `supabase/tests/operation-isolation.sql` num banco descartável.
2. Compare uma janela fechada com Olist/Tiny: NFs válidas, receita, pedidos, itens e estoque.
3. Compare exemplos do Financeiro: nacional/importado, SP interno, venda interestadual, crédito explícito e transferência importada. Lucro deve ficar pendente sem custo, tarifa, UF ou regra necessária.
4. Valide Agenda, RPA, etiquetas, importações, devoluções, reconciliação, exports, status e usuários autorizados.
5. Cadastre crons com nomes `giracasa-*`, mesmos limites da fonte e horários defasados dos jobs de Uberlândia. Não programe um cache sem expor seu `refreshed_at` no status.
6. Somente então marque `public.oraculo_operations.enabled=true` e registre `activated_at=now()` em nova migration. A migration de ativação também deve criar os jobs.

Para rollback operacional, desative a linha e remova/pausa os jobs `giracasa-*`. Preserve o schema para diagnóstico; não apague nem copie dados para `public`.

## Motor financeiro

Versão inicial `gira-casa-v1`: origem SP; ICMS nacional de 18% para SP, 12% para MG/PR/RJ/RS/SC e 7% para as demais UFs; importado de 18% para SP e 4% fora; PIS/COFINS de 9,25% com crédito quando aplicável; DIFAL somente interestadual; receita pela NF válida.

Custos seguem o Financeiro: líquido explícito, créditos recuperáveis explícitos, transferência comprovada de importado (4% + 11,75%) e custo bruto. Sem comprovação, Giracasa conserva o custo bruto. Exceções ficam em `giracasa.oraculo_financial_product_rules` por SKU e vigência.

## Registro da implantação inicial

Em 04/09/2026 somente `20260904173904_operation_access_foundation.sql` foi executada em produção. Pós-check: 7 usuários migrados para Uberlândia, zero concessões Giracasa e operação desativada. As migrations de isolamento e motor financeiro estão validadas localmente e aguardam autorização explícita para a alteração ampla. Web, Edge Functions, carga e crons não foram publicados.
