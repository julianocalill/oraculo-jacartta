# Relatório Shopee de separação em caixas no WhatsApp

## Resumo executivo

Esta automação consulta as quatro lojas diretamente na Shopee Open Platform,
converte as quantidades vendidas em caixas completas e unidades avulsas e envia
o consolidado pelo n8n e pela Evolution API.

```text
Shopee Open Platform
        ↓
n8n + catálogo operacional de cubagem
        ↓
Evolution API — instância MKT Espaço
        ↓
WhatsApp operacional
```

O banco operacional do n8n guarda tokens, lojas, perfis de cubagem, componentes
e vínculos com as variações Shopee. O relatório não consulta pedidos, itens,
views, RPCs ou caches do Oráculo durante a execução.

## Horários e janelas

Fuso: `America/Sao_Paulo`.

| Envio | Início do corte | Fim do corte |
|---|---|---|
| `07:00` | dia anterior às `14:00` | dia atual às `06:30` |
| `13:30` | dia atual às `08:00` | dia atual às `13:00` |
| segunda-feira `13:30` | sábado às `13:30` | segunda-feira às `13:00` |

Os intervalos `06:30–08:00` e `13:00–14:00` não pertencem a nenhum relatório,
por decisão operacional. Os limites são fixos: atraso na execução não amplia a
janela.

A execução de segunda-feira às `13:30` é uma exceção deliberada: consolida
sábado, domingo e segunda-feira desde sábado às `13:30`. A execução de segunda
às `07:00` continua usando a janela diária normal e, portanto, seus pedidos
também aparecem no consolidado das `13:30`.

## Conversão em caixas

O vínculo de cubagem usa a chave explícita `shop_id + item_id + model_id`.
O SKU fica como apoio de auditoria, não como chave operacional única.

Para cada variação mapeada:

```text
quantidade física = quantidade vendida × unidades por venda
caixas completas  = floor(quantidade física / itens por caixa)
unidades avulsas  = quantidade física % itens por caixa
```

`unidades por venda` resolve anúncios como kit de 30 cabides: duas unidades
vendidas representam 60 cabides físicos. Perfis que já representam um kit
logístico usam multiplicador 1.

A saída mostra apenas caixas completas e eventual sobra. Produtos sem vínculo
inequívoco nunca desaparecem: permanecem em unidades e recebem o aviso
`⚠️ sem cubagem mapeada`.

### Produtos Destampado

As tampas da planilha são componentes dos perfis que têm `DESTAMPADO` no nome.
Elas repetem exatamente a quantidade de caixas e a sobra do pote:

- perfil `370 + 640`: Pote 370, Tampa 370, Pote 640 e Tampa 640;
- perfil `370 + 640 + 1040`: Pote e Tampa de 370, 640 e 1040;
- exemplo: `10 cx + 1 un` do perfil gera `10 cx + 1 un` para cada componente;
- produtos marcados `TAMPADO` permanecem uma única linha.

Assim, 10 caixas do perfil destampado 370 + 640 contam como 40 volumes
logísticos: 10 caixas de cada um dos quatro componentes. A expansão só ocorre
quando a variação Shopee estiver vinculada ao perfil destampado correto; não se
infere esse vínculo apenas pelo título do anúncio.

## Consolidação e saída

- Escopo: quatro lojas ativas, consolidadas sem subtotais por loja.
- Exclusões: pedidos `UNPAID`, `CANCELLED` e `IN_CANCEL`.
- Ordenação: caixas decrescentes, depois unidades avulsas e nome.
- Totais: pedidos, unidades vendidas na Shopee, caixas logísticas, unidades
  avulsas físicas e quantidade de grupos sem cubagem.
- Componentes derivados, inclusive tampas, entram no total de caixas.
- Paginação: até 3.400 caracteres por mensagem, em `Parte N/Total`, sem cortar
  linha de produto.
- Depois de todas as partes de texto, o fluxo envia um CSV único. O slot só é
  marcado como concluído se o documento também for aceito pela Evolution.

O total “unidades vendidas” mede quantidades de anúncios da Shopee. O total de
“unidades avulsas” é físico e já considera `unidades por venda`; portanto os
dois números não devem ser comparados como se tivessem a mesma unidade de
medida.

### CSV operacional

Nome: `separacao-shopee-YYYY-MM-DD-SLOT.csv`. O arquivo usa UTF-8 com BOM e
separador `;`, para abrir corretamente no Excel brasileiro.

Cada linha traz:

- período e status `MAPEADO` ou `PENDENTE`;
- produto e quantidade vendida unitariamente; para mapeados, já convertida em
  peças físicas;
- caixas completas e unidades avulsas;
- perfil de cubagem e itens por caixa, quando mapeado;
- `shop_id`, `item_id`, `model_id` e SKU para corrigir os pendentes;
- orientação explícita de mapeamento nas linhas pendentes.

Enquanto um item estiver pendente, não é possível conhecer seu multiplicador
físico com segurança. Nessas linhas, a quantidade é a informada pela Shopee e
a observação pede também o cadastro das unidades físicas por venda.

Nos perfis destampados, cada pote e tampa ocupa sua própria linha, repetindo a
quantidade física e as caixas do componente conforme a regra logística.

## Coleta direta da Shopee

Para cada loja ativa, o n8n:

1. lê tokens e cadastro da loja no banco operacional;
2. rejeita token ausente ou com menos de cinco minutos de validade;
3. assina a chamada com HMAC-SHA256;
4. pagina `GET /api/v2/order/get_order_list` por `create_time`;
5. remove números de pedido duplicados;
6. busca detalhes em lotes por `GET /api/v2/order/get_order_detail`;
7. exclui os status não considerados venda;
8. cruza cada item com o catálogo de cubagem e consolida a separação.

Se qualquer loja, página ou lote falhar, o workflow falha por inteiro e não
envia um consolidado parcial. Falhas transitórias de rede, respostas `429` e
erros `5xx` recebem tentativas com espera progressiva.

## Catálogo operacional

Tabelas no banco operacional do n8n:

- `shopee_box_profiles`: 77 linhas importadas da planilha de cubagem;
- `shopee_box_profile_components`: componentes dos dois perfis destampados;
- `shopee_box_mappings`: vínculos explícitos entre variações Shopee e perfis.

Fonte da carga inicial: `/Users/julianocalil/Downloads/CUBAGEM - PRODUTOS.xlsx`,
coluna C (`QTD/CX`). A carga valida que todas as 77 linhas tenham quantidade
positiva e não modifica a planilha original.

Na reconciliação de 13/08/2026, 440 das 3.954 variações foram vinculadas com
regra determinística; seis ficaram ambíguas e 3.508 permaneceram sem vínculo.
Essa cobertura é deliberadamente conservadora. As vendas não vinculadas
continuam visíveis com alerta até revisão manual.

## Workflows em produção

### Relatório e envio

- Nome: `Shopee API Direta - Separação em Caixas WhatsApp 07h e 13h30`
- ID: `GJHOwusnuXgaxVaT`
- Status documentado: ativo
- Cron: `0 7 * * *` e `30 13 * * *`
- Preview: `GET /webhook/shopee-api-direct-sales-whatsapp-preview`
- Preview explícito: `?date=YYYY-MM-DD&slot=0700|1330`
- Evolution: instância `MKT Espaço`
- Destino: número operacional terminado em `5847`
- Proteção contra repetição: `last_sent_slot` nos dados estáticos do workflow

O preview executa coleta e formatação reais, mas não chama a Evolution API.

### Renovação primária de tokens

- Nome: `Shopee - Renovar Tokens (n8n primário)`
- ID: `Zeptn7GL4bOOsGKj`
- Cron: `5 1-23/2 * * *`

O n8n é o único proprietário da renovação. O espelho para o Oráculo é
unidirecional, opcional e não bloqueante. O workflow legado
`1. Shopee - Renovar Tokens` (`Dc6cFKsiWmI2kDJk`) deve permanecer desativado.

## Código e comandos

```text
/Users/julianocalil/espacodebicho-integracoes/
  scripts/setup-shopee-box-catalog.js
  scripts/reconcile-shopee-box-mappings.js
  scripts/setup-n8n-shopee-sales-direct-whatsapp.js
  scripts/run-n8n-shopee-sales-whatsapp-test.js
  src/workflows/shopee-sales-whatsapp.js
  src/workflows/shopee-sales-whatsapp.test.js
```

```bash
cd /Users/julianocalil/espacodebicho-integracoes
npm run test:shopee-sales-whatsapp
npm run n8n:setup-shopee-sales-whatsapp
npm run shopee:setup-box-catalog
npm run shopee:reconcile-box-mappings
```

`n8n:setup-shopee-sales-whatsapp -- --activate` atualiza e ativa o workflow. O
teste real de WhatsApp exige `--send` e um `--to=...`; não deve ser executado
como validação rotineira. Os scripts de setup fazem backup local antes de
atualizar workflows.

## Validação de 13/08/2026

Dois previews reais, sem envio ao WhatsApp, terminaram com sucesso:

- slot `07:00`: 2.180 pedidos, 2.317 unidades vendidas, 194 caixas logísticas,
  1.506 unidades avulsas, 139 grupos sem cubagem e seis mensagens;
- slot `13:30`: 1.011 pedidos, 1.085 unidades vendidas, 95 caixas logísticas,
  779 unidades avulsas, 116 grupos sem cubagem e cinco mensagens.

São evidências históricas dos testes, não indicadores atuais. Todas as partes
ficaram abaixo de 3.400 caracteres.

Após a inclusão do CSV, uma nova prévia do slot `13:30` gerou
`separacao-shopee-2026-08-13-1330.csv`: 136 linhas de dados, 41.173 bytes e 116
linhas pendentes. O documento não foi enviado nessa prévia.

## Runbook de diagnóstico

### Relatório não chegou

1. Conferir se `GJHOwusnuXgaxVaT` está ativo.
2. Conferir a execução das `07:00` ou `13:30` no n8n.
3. Identificar no erro a loja, página ou lote que falhou.
4. Conferir o workflow primário de tokens sem imprimir credenciais.
5. Se a coleta terminou, conferir o node Evolution e a instância `MKT Espaço`.
6. Rodar o preview explícito para separar coleta/formatação de entrega.

### Contagem ou caixas parecem erradas

1. Confirmar a janela fixa e os dois intervalos deliberadamente excluídos.
2. Confirmar o fuso `America/Sao_Paulo`.
3. Localizar o vínculo `shop_id + item_id + model_id` em
   `shopee_box_mappings`.
4. Conferir `units_per_sale` e `units_per_box`.
5. Para `Destampado`, conferir o perfil e seus componentes; não criar tampas
   para um produto `TAMPADO`.
6. Se não houver vínculo inequívoco, manter o item como não mapeado em vez de
   escolher um perfil por aproximação.

### Token inválido ou expirando

1. Não ativar outro renovador.
2. Conferir `Zeptn7GL4bOOsGKj` e a validade dos quatro tokens.
3. Confirmar a partner key correspondente sem exibir seu valor.
4. Renovar pelo webhook operacional somente se necessário.

## Segurança

- Nunca registrar tokens, partner keys ou service roles em documentação, Git
  ou mensagens.
- Backups de workflows podem conter metadados internos; revisar antes de
  compartilhar.
- Preview faz chamadas reais e deve ser tratado como acesso operacional.
- Não alterar o destino do WhatsApp sem confirmação explícita.
- Não reativar workflows antigos de renovação.

## Decisão arquitetural

Ver `docs/adr/ADR-003-shopee-direct-sales-whatsapp.md`.
