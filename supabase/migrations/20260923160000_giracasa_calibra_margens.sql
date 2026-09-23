-- Giracasa: calibra margem alvo e mínima com a realidade da operação.
--
-- Os valores vieram de Uberlândia (alvo 25%, mínimo 12%) e não descrevem a
-- Giracasa. Distribuição medida em 23/09/2026, sobre os 86 SKUs com venda e
-- custo nos últimos 30 dias:
--
--   mínima -28,0% · p25 0,2% · mediana 5,0% · p75 15,1% · máxima 25,4%
--   margem ponderada pela receita: 5,5%
--
-- O alvo de 25% ficava acima do melhor SKU da operação e o mínimo de 12%
-- reprovava dois terços do catálogo, o que torna o sinal inútil: quando quase
-- tudo é crítico, nada é.
--
-- Novos valores: alvo 15% (quartil superior, alcançável hoje) e mínimo 5%
-- (mediana). São provisórios: a margem real de TikTok e Mercado Livre, 19% da
-- receita, ainda não é calculável por falta das tarifas, e o comercial pode
-- ajustar direto na tela /parametros.
--
-- A margem fiscal por canal no mesmo período, para referência:
--   Shopee Gira Casa 7,87% · Shopee Vari Útil 4,91%.

update giracasa.oraculo_margin_channel_params
set target_margin_rate = 0.15,
    minimum_margin_rate = 0.05,
    notes = coalesce(notes, '') || ' Alvo e mínimo calibrados em 23/09/2026 pela distribuição real (p75 e mediana); provisórios até TikTok e Mercado Livre terem tarifa.',
    updated_at = now()
where channel_key = '*';
