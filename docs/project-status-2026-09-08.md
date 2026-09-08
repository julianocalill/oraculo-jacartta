# Status do projeto — 08/09/2026

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

A integração Olist/Tiny da Giracasa foi definida pelo aplicativo **Token API**
(API V2), conforme a credencial disponível para a empresa. O token terá secret
próprio e não será tratado como Bearer. O adaptador V2 será validado primeiro em
`info.php`; as funções V3 já publicadas permanecem sem execução. Decisão:
`docs/adr/ADR-008-giracasa-olist-token-api.md`.

## Estado operacional

- Uberlândia permanece ativa nas rotas originais.
- Giracasa permanece `enabled=false`, sem usuários, credenciais, jobs ou carga.
- O schema isolado, o motor `gira-casa-v1` e as 26 Edge Functions já publicadas
  continuam preservados.
- Nenhuma credencial de Uberlândia pode ser usada como fallback pela Giracasa.
- O primeiro uso das credenciais Giracasa será uma janela fechada de um dia;
  os 40 dias só serão carregados após a conferência dessa amostra.

## Próximos gates

1. Implementar e testar o adaptador Olist/Tiny V2 para o Token API.
2. Cadastrar `GIRACASA_OLIST_API_V2_TOKEN` e validar a identidade por `info.php`.
3. Carregar e reconciliar uma janela fechada de um dia.
4. Executar os 40 dias e medir volume, duração e cobertura.
5. Conferir nacional, importado, kit, créditos, SP interno e destinos
   interestaduais contra `docs/giracasa-financial-contract.md` e o Financeiro.
6. Construir as rotas reais da Giracasa em preview e validar com uma conta real.
7. Conceder o piloto e ativar jobs somente depois dos gates anteriores.

Decisão arquitetural: `docs/adr/ADR-007-giracasa-progressive-rollout.md`.
Runbook: `docs/giracasa-onboarding.md`.
