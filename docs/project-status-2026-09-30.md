# Estado do projeto — 2026-09-30

## Protótipo local de prints Shopee Ads

Foi criado `tools/ads-print-analyzer`, aplicativo local para macOS iniciado com
`python3 tools/ads-print-analyzer/server.py` e aberto em
`http://127.0.0.1:8765`. Ele usa Vision/Swift para OCR de prints Shopee Ads,
permite corrigir as métricas e calcula recomendações determinísticas a partir
dos quatro cenários da Aula 09 do treinamento fornecido pelo usuário.

A versão Python/Swift é **local**, fora da aplicação Next.js e sem deploy. Não acessa a
API Shopee, não envia a imagem a IA externa, não salva o print e não altera
campanhas. A separação é deliberada: o usuário solicitou localhost, e o OCR
nativo depende do macOS. O Oráculo de produção continua com `/ads` e sua coleta
API existente; não há mudança no schema ou na navegação web.

O resultado só confirma cenário quando há limite diário positivo, informação
de consumo do limite, meta, e janela de dias completos inteiramente posterior
à última otimização. Orçamento ilimitado fica fora da matriz. ROAS de equilíbrio
é estimado apenas quando a margem de contribuição antes de Ads é informada.
Dados incompletos geram pendências explícitas em vez de recomendações de escala.

Validação: 7 testes de análise e sintaxe JS passaram; OCR nativo leu os dois
prints anteriores do usuário, incluindo valores de R$ 2.437,69/8,73× e
R$ 7.702,47/6,48×. Execução e limites em
`tools/ads-print-analyzer/README.md`.

Este protótipo permanece local; a integração web publicada é descrita abaixo.

## Integração à aba Shopee Ads

O fluxo também foi incorporado ao Next.js em `/ads/analisar-print`, acessível
por botão na aba `/ads`. Esta é a versão indicada para uso no Oráculo; a
ferramenta Python/Swift local permanece como protótipo. A versão web usa
Tesseract.js no navegador e arquivos OCR locais preparados em `dev`/`build`,
sem upload do print nem dependência de macOS. A análise determinística foi
portada para `packages/domain/ads-print.js` com testes e a mesma exigência de
dados para confirmar cenário. Nenhuma mudança de banco ou integração Shopee.

Validação local: página autenticada abriu em
`/o/uberlandia/ads/analisar-print`; o print de 21/09–28/09 foi lido com os
sete indicadores corretos e o Cenário 2 foi confirmado após informar meta,
limite, consumo e última otimização. Publicada em produção no deploy
`dpl_7dDZ8b4TzM1TBLZQUC6ZgRRp4SDi` em 30/09, a partir do commit `0f75899`.
Os arquivos estáticos do OCR são públicos para carregamento pelo navegador; a
rota de análise continua autenticada e sujeita à permissão `ads`.
