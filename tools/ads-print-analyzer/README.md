# Analisador local de prints Shopee Ads

Aplicação para `localhost` que recebe um print da tela **Performance** de uma
campanha Shopee Ads, lê os cards com o OCR nativo do macOS e apresenta sugestões
revisáveis conforme a Aula 09 do `Software-Shopee-ADS-2.0.html` fornecido pelo
usuário. O arquivo enviado é gravado só em um temporário durante a leitura e
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

Requer macOS com Command Line Tools (`swiftc`) e Python 3. Na primeira leitura,
o servidor compila `ocr.swift` em `/tmp`; as seguintes usam o binário em cache.
O app escuta somente em `127.0.0.1`.

## Fluxo

1. Anexar PNG ou JPEG da tela de desempenho e conferir as métricas lidas.
2. Informar meta de ROAS, tipo de orçamento, consumo do limite, datas do print
   e data da última otimização. A margem de contribuição **antes de Ads** é
   opcional, mas necessária para estimar o ROAS de equilíbrio.
3. Atualizar recomendações. O cenário 1–4 só é confirmado se o período é
   inteiramente posterior à otimização e termina antes do dia atual.

O print sozinho **não** prova qual meta valia no período, se o orçamento era
ilimitado ou se o limite diário foi consumido. Valor 0 em configuração não
prova orçamento ilimitado. Se o orçamento é ilimitado, a matriz de consumo da
Aula 09 não se aplica. `Itens vendidos` são unidades, não pedidos. ROAS não é
lucro. A estimativa de equilíbrio usa `100 / margem de contribuição (%)`.

## Verificação

```sh
python3 -m unittest discover -s tools/ads-print-analyzer -p 'test_*.py' -v
node --check tools/ads-print-analyzer/app.js
```

O OCR foi validado nos dois prints de Performance fornecidos nesta conversa:
`21/09–28/09` (R$ 2.437,69 / R$ 21.278,11 / 8,73×) e “Último mês”
(R$ 7.702,47 / R$ 49.947,95 / 6,48×). Capturas de outros layouts podem exigir
correção manual dos campos.
