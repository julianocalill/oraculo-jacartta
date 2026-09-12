# Status da Giracasa — 08/09/2026

## Giracasa retomada com implantação progressiva

O trabalho da Giracasa foi retomado na branch isolada
`codex/giracasa-phase1`. O Oráculo de Uberlândia continua no código web estável
e no domínio `oraculo.oliverhome.com.br`; esta etapa não altera login, menu,
rotas nem o alias de produção.

A carga inicial foi reduzida de 90 para 40 dias. O novo
`scripts/giracasa-backfill.mjs` permite conferir o plano com `--plan`, divide o
período em blocos de até 14 dias e repete chamadas curtas com `resume=true` até
cada fonte confirmar `completed=true`. O limite por invocação evita manter uma
Edge Function processando milhares de detalhes em uma única execução e reduz a
disputa de recursos com Uberlândia.

A especificação executável do custo foi alinhada à precedência declarada pelo
Financeiro: custo líquido explícito, créditos recuperáveis medidos,
transferência importada comprovada e, por fim, custo bruto. Um crédito medido
agora prevalece mesmo quando a transferência também estiver marcada.

O gerador das 26 Edge Functions ganhou cobertura automatizada para o limite de
credenciais: somente as duas chaves compartilhadas do projeto Supabase podem
ficar sem prefixo; qualquer outra variável precisa começar com `GIRACASA_`.

O `gira-casa-v1` foi comparado novamente com a implementação local do
Financeiro. A matriz e a precedência do custo conferem. O contrato registra a
adaptação central do Oráculo: receita somente pela NF válida, sem fallback para
venda bruta, e controle por SKU para impedir crédito duplicado de PIS/COFINS.
Detalhes: `docs/giracasa-financial-contract.md`.

A tela real da Olist confirmou um **Aplicativo API OAuth/V3**, com URL de
redirecionamento, Client ID e Client Secret. A premissa anterior de Token API V2
foi corrigida antes de autorizar ou carregar a conta. O callback exclusivo
`giracasa-olist-oauth-callback` está publicado. Endpoints, state, segredo do job,
Client ID e Client Secret foram configurados; o consentimento administrativo
gerou refresh token no schema `giracasa`. A identidade foi validada por `/info`
como **GIRA CASA COMERCIO DE VARIEDADES LTDA**, SP, regime tributário 3, e as
leituras de conta, produtos e pedidos responderam `200`. Uma segunda abertura
do callback respondeu `invalid_grant` porque o código OAuth já havia sido usado;
o token salvo na primeira chamada continuou válido. Decisão:
`docs/adr/ADR-008-giracasa-olist-oauth-v3.md`.

O canário fechado de 07/09/2026 foi concluído em produção no schema isolado:
771 pedidos, 687 NFs válidas, R$ 44.042,64 de receita e 685 itens fiscais. Os
687 valores brutos e válidos conferem exatamente. O linker encontrou 659
pedidos (95,9% das NFs); os 28 restantes podem pertencer a pedidos de dias
anteriores e serão reavaliados na janela de 40 dias. A fila dos 659 pedidos
terminou sem pendência e gerou 660 linhas comerciais.

A varredura completa do catálogo trouxe 1.068 produtos; 484 SKUs têm custo
utilizável. No canário, 614 de 688 linhas financeiras têm custo completo. A
tarifa Shopee padrão do Financeiro foi cadastrada somente para Giracasa, com
470 NFs e R$ 30.524,01 de receita prontas para lucro. TikTok e Mercado Livre
somam 218 linhas ainda sem tarifa própria e permanecem pendentes. O motor
confirmou zero DIFAL nas vendas SP→SP.

A carga histórica foi iniciada dentro do próprio Supabase, sem processo local.
O controle `giracasa.olist_initial_backfill_control` percorre 30/07–07/09 em
três blocos de até 14 dias. O pg_cron
`giracasa-olist-initial-backfill-40d` chama uma página por vez das Edge Functions
de pedidos, notas e itens, com intervalo mínimo de quatro minutos e cursores no
banco. Ele se desagenda ao concluir ou após cinco falhas consecutivas observadas
em pedidos/notas. O primeiro request respondeu HTTP 200 e avançou para
100/9.022 pedidos no bloco 30/07–12/08.

Durante o canário, `olist-backfill-order-items` revelou que o sucesso gravava os
itens sem concluir a linha da fila. A função agora marca `completed` depois do
upsert; a versão isolada Giracasa foi republicada e validada nos 659 pedidos.

## Estado operacional

- Uberlândia permanece ativa nas rotas originais.
- Giracasa permanece `enabled=false` e sem usuários. OAuth, canário de um dia e
  catálogo Olist estão carregados; existe somente o job temporário da carga de
  40 dias, que se remove ao terminar.
- O schema isolado, o motor `gira-casa-v1` e as 26 Edge Functions já publicadas
  continuam preservados.
- Nenhuma credencial de Uberlândia pode ser usada como fallback pela Giracasa.
- A janela fechada de um dia foi aprovada tecnicamente; a carga de 40 dias é o
  próximo passo de dados.

## Próximos gates

1. Acompanhar a carga remota de 40 dias e medir volume, duração e cobertura ao
   término.
2. Obter e cadastrar as tarifas próprias de TikTok e Mercado Livre; até lá o
   lucro desses canais continua pendente.
3. Conferir nacional, importado, kit, créditos, SP interno e destinos
   interestaduais contra `docs/giracasa-financial-contract.md` e o Financeiro.
4. Conectar as contas próprias de marketplace e validar reconciliação.
5. Construir as rotas reais da Giracasa em preview e validar com uma conta real.
6. Conceder o piloto e ativar jobs somente depois dos gates anteriores.

Decisão arquitetural: `docs/adr/ADR-007-giracasa-progressive-rollout.md`.
Runbook: `docs/giracasa-onboarding.md`.
