# ADR-002: Fronteira do funil de expedição

## Status

Accepted

## Contexto

O operacional precisa de telas imediatas no Bip e os gestores precisam de
histórico no Oráculo. Os sistemas usam bancos separados, e duplicar a integração
Shopee ou gravar em dois bancos durante o bip criaria risco operacional.

## Decisão

- Bip permanece fonte de verdade dos bipes Comercial e Logística.
- Oráculo permanece fonte de verdade da Shopee e da conciliação por pacote.
- O Oráculo puxa eventos do Bip de forma incremental e idempotente.
- TVs ficam no Bip; análise histórica fica no Oráculo.
- Comunicação servidor-servidor usa segredos específicos e endpoints de mínimo
  privilégio. Nenhuma service role vai para o navegador.

## Consequências

- Uma indisponibilidade do Oráculo não bloqueia a bipagem.
- TVs podem ter até dois minutos de atraso nos bipes e até quinze minutos nos
  estados da Shopee.
- Regras do funil vivem uma única vez no Oráculo.
- Ativação exige configuração coordenada de segredos nos dois ambientes.
