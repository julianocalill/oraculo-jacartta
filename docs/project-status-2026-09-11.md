# Estado do projeto — 11/09/2026

## Shopee Ads no Comercial

Nova aba `/ads` com filtros por loja e período, investimento, ROAS direto,
receita e pedidos atribuídos; gráfico diário em barras/linha; análise diária
por regras; prioridades e relação completa de campanhas acionáveis; tabelas
ordenáveis por loja, campanha e dia. Permissão própria na matriz de Usuários.

A coleta foi ampliada de campanhas ativas a **todas as campanhas**, incluindo
pausadas. O fluxo n8n mantém o contrato e os envios a cada três dias. Quatro
crons independentes do dashboard rodam diariamente e revisam 30 dias de
atribuição. Sem alteração de campanhas ou renovação adicional de tokens.

A migração `20260911194344_shopee_ads_dashboard.sql` já está aplicada e a Edge
Function `shopee-ads-report-data` está na versão 17. Os quatro crons estão
ativos. Consulta agregada SECURITY INVOKER com RLS de operação e grants apenas
para as colunas necessárias, sem payload bruto ou mensagens.

## Validações

- Duas coletas completas das quatro lojas; a segunda já exige todas as
  combinações de campanha/dia na resposta. 509 campanhas e 15.270 linhas,
  duração por loja entre 6,2 s e 17 s, sem erros.
- 12/08–10/09: gasto **R$ 376.249,71**, GMV direto **R$ 4.078.297,80**,
  ROAS **10,84×**; gasto do dashboard confere exatamente com a série de origem.
- Todas as 120 combinações de loja/dia da janela inicial cobertas. A janela
  anterior fica marcada como parcial, sem deltas que confundam falta de dados
  com queda de desempenho.
- Consulta máxima de 90 dias sob authenticated: **163 ms**, com limite de 8 s; identidade sem
  acesso retorna zero campanhas. Anon sem SELECT, authenticated sem INSERT e
  sem SELECT em raw_settings. Advisors sem achados novos relativos aos dois
  objetos criados; avisos anteriores continuam fora do escopo desta entrega.
- 82 testes de domínio aprovados; TypeScript e build de produção aprovados.
- Prévia navegável conferida em navegador: filtros, card, gráfico e análise;
  largura móvel 390×844 sem transbordamento horizontal do documento.

Contrato, limites e recuperação: [Shopee Ads](shopee-ads-dashboard.md).

## Publicação

Frontend publicado em produção no commit `2397f98`, enviado para `origin` e
`personal`. Vercel confirmou **READY** no deploy
`dpl_9EQHbARE2XHEVBh3bBpJ5vfwoSPi`.

Endereço: `https://oraculo.oliverhome.com.br/o/uberlandia/ads`.
A navegação anônima redirecionou corretamente para o login com `next` apontando
para a nova aba. A validação visual e de filtros foi feita na prévia local com
os dados reais; a leitura autenticada do banco foi validada separadamente por
SQL, sem criar sessão de usuário em produção.

## Continuidade

Mantém as correções de Home/Pedidos para fonte Olist, já registradas no
CHANGELOG de hoje, e a correção de taxas TikTok na calculadora documentada em
[10/09](project-status-2026-09-10.md). Para os fluxos anteriores: Separação em
[09/09](project-status-2026-09-09.md) e Full em
[08/09](project-status-2026-09-08.md).
