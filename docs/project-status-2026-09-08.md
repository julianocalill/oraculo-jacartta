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

## Estado operacional

- Uberlândia permanece ativa nas rotas originais.
- Giracasa permanece `enabled=false`, sem usuários, credenciais, jobs ou carga.
- O schema isolado, o motor `gira-casa-v1` e as 26 Edge Functions já publicadas
  continuam preservados.
- Nenhuma credencial de Uberlândia pode ser usada como fallback pela Giracasa.
- O primeiro uso das credenciais Giracasa será uma janela fechada de um dia;
  os 40 dias só serão carregados após a conferência dessa amostra.

## Próximos gates

1. Cadastrar as credenciais próprias da Olist/Tiny com prefixo `GIRACASA_`.
2. Carregar e reconciliar uma janela fechada de um dia.
3. Executar os 40 dias e medir volume, duração e cobertura.
4. Conferir nacional, importado, kit, créditos, SP interno e destinos
   interestaduais contra o Financeiro.
5. Construir as rotas reais da Giracasa em preview e validar com uma conta real.
6. Conceder o piloto e ativar jobs somente depois dos gates anteriores.

Decisão arquitetural: `docs/adr/ADR-007-giracasa-progressive-rollout.md`.
Runbook: `docs/giracasa-onboarding.md`.
