# Logística — Separação operacional

## Objetivo

`/logistica/separacao` é o ponto de impressão da lista multicanal que já era
enviada pelo n8n. O Oráculo passa a persistir cada resultado antes de qualquer
envio, permitindo alerta de atraso, recuperação manual, histórico, CSV e
reimpressão sem recalcular pedidos.

Esta entrega é separação por produto. O picking por endereço físico continua
dependendo da Fase 3 do plano de depósito.

## Regra do fechamento esperado

No fuso `America/Sao_Paulo`:

- antes de 07:15: fechamento de 13:30 do dia anterior;
- de 07:15 até 13:44: fechamento de 07:00 do dia atual;
- a partir de 13:45: fechamento de 13:30 do dia atual.

A tela fica verde quando esse slot está `ready`, amarela enquanto ele está em
`pending`, `syncing` ou `processing`, e vermelha quando está ausente,
`blocked`, `failed` ou abandonado há mais de 20 minutos.

## Fluxos

### Automático

O schedule de 07:00/13:30 cria a lista oficial, calcula o consolidado, congela
cabeçalho e itens via `logistica_picking_finalize` e só então segue para o
WhatsApp. O cursor durável avança na mesma transação que deixa a lista pronta.

### Atualizar agora

A Server Action valida a aba Logística, impede concorrência, cria ou reaproveita
o slot oficial esperado e chama o webhook protegido do n8n. O worker reserva a
lista atomicamente, sincroniza e hidrata pedidos Olist recentes, gera o
consolidado e persiste o documento. Esse caminho nunca envia WhatsApp.

### Personalizado

Qualquer usuário com acesso à Logística pode solicitar até sete dias. A geração
é assíncrona, hidrata a janela recente necessária e nunca altera o cursor
oficial nem envia WhatsApp.

## Persistência e segurança

- `logistica_picking_cursor`: cursor oficial; somente `service_role`;
- `logistica_picking_listas`: execução, origem, período, status, solicitante,
  erro, Olist e WhatsApp;
- `logistica_picking_itens`: fotografia imutável das linhas com no mínimo duas
  caixas;
- `logistica_picking_impressoes`: auditoria append-only do clique em Imprimir.

Leituras autenticadas exigem, por RLS, acesso ativo à operação Uberlândia e à
aba Logística. Escritas ficam nas Server Actions e no worker com service role.
O UUID da lista é a correlação auditável entre a interface e o n8n; a coluna
`operation_id` mantém o isolamento da operação.

## Contrato do documento

Impressão A4, CSV e WhatsApp derivam do mesmo relatório congelado. As colunas
são SKU, produto, descritivo, itens vendidos, caixas e unidades avulsas. Só
entram linhas com duas caixas ou mais. Pedidos candidatos com `itens = []`
bloqueiam a publicação e o avanço do cursor.

## Configuração e ativação controlada

Variáveis server-only do Oráculo:

```text
N8N_SEPARATION_WEBHOOK_URL
N8N_SEPARATION_WEBHOOK_SECRET
OLIST_SYNC_JOB_SECRET
```

Ordem de ativação, sempre com autorização explícita:

1. aplicar `20260909122557_logistica_separacao_operacional.sql`;
2. publicar `olist-sync-orders`, que trata `payload.itens = []` como incompleto;
3. configurar os três segredos no ambiente correto;
4. executar o instalador do workflow primeiro sem flags (dry-run) e depois com
   `--apply`; ele importa `staticData.global.last_cursor_end`, cria as
   credenciais Header Auth e faz backup antes do update;
5. publicar o frontend;
6. acionar um fechamento controlado e conferir igualdade entre tela, A4, CSV e
   WhatsApp antes de manter o schedule ativo.

### Ativação de 09/09/2026

Migration aplicada no projeto `bbtiipnmdxfxnxbemgjr`, `olist-sync-orders`
republicada, segredos configurados, cursor legado importado e workflow n8n
`UGLCLNS6oVCK87o3` atualizado e ativo com 34 nós. O frontend foi publicado nos
dois remotes que sustentam o Oráculo.

## Validação

- testes unitários cobrem exatamente 07:15 e 13:45;
- a migration foi executada contra o banco vinculado dentro de transação com
  `ROLLBACK`, exercitando cursor, bloqueio, claim concorrente e RLS;
- `EXPLAIN ANALYZE` da consulta real de sete dias levou cerca de 18 s, razão
  para manter o cálculo fora da renderização;
- domínio, integração n8n, typecheck e build precisam permanecer verdes antes
  da ativação;
- lint só pode ser considerado executado após o repositório ganhar configuração
  ESLint não interativa; hoje `next lint` abre o assistente de configuração.
