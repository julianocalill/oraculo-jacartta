# Analisador local de prints Shopee Ads

Aplicação para `localhost` que recebe um print da tela **Performance** de uma
campanha Shopee Ads, lê os cards com o OCR nativo do macOS e apresenta sugestões
revisáveis para campanhas de orçamento ilimitado. A matriz original da Aula 09
do `Software-Shopee-ADS-2.0.html` foi adaptada para comparar ROAS e crescimento
de impressões. O arquivo enviado é gravado só em um temporário durante a leitura e
apagado imediatamente. Não há chamada à API Shopee, IA externa, banco ou
alteração de campanha.

## Iniciar

Na raiz do repositório:

```sh
python3 tools/ads-print-analyzer/server.py
```

Abrir `http://127.0.0.1:8765`. Para trocar a porta:

```sh
ADS_PRINT_PORT=8766 python3 tools/ads-print-analyzer/server.py
```

Requer macOS com Command Line Tools (`swiftc`), Python 3 e Node.js. Na primeira leitura,
o servidor compila `ocr.swift` em `/tmp`; as seguintes usam o binário em cache.
O app escuta somente em `127.0.0.1`. As sugestões usam a mesma regra JS da
versão web (`packages/domain/ads-print.js`), sem duplicar a matriz em Python.

## Fluxo

1. Anexar PNG ou JPEG da tela de desempenho e conferir as métricas lidas.
2. Informar meta de ROAS, data da última mudança, margem antes de Ads e
   impressões do mesmo anúncio em um período anterior de igual duração. Os
   cliques anteriores completam o diagnóstico de CTR.
3. Atualizar recomendações. O cenário 1–4 exige ao menos sete dias completos
   após a última mudança e uma comparação anterior com a mesma quantidade de
   dias. O critério operacional de crescimento de impressões é +10%.

O print sozinho **não** prova qual meta valia no período nem a tendência de
entrega. A matriz assume a regra operacional informada pelo usuário:
orçamento sempre ilimitado. O limiar de +10% é do Oráculo, não da Shopee.
`Itens vendidos` são unidades, não pedidos. ROAS não é lucro. A estimativa de
equilíbrio usa `100 / margem de contribuição (%)` e bloqueia sugestões de
redução de meta quando o novo alvo ficaria nesse equilíbrio ou abaixo dele.

## Verificação

```sh
python3 -m unittest discover -s tools/ads-print-analyzer -p 'test_*.py' -v
node --check tools/ads-print-analyzer/app.js
```

O OCR foi validado nos dois prints de Performance fornecidos nesta conversa:
`21/09–28/09` (R$ 2.437,69 / R$ 21.278,11 / 8,73×) e “Último mês”
(R$ 7.702,47 / R$ 49.947,95 / 6,48×). Capturas de outros layouts podem exigir
correção manual dos campos.
