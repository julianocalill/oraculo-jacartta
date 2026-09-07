# Status do projeto — 2026-09-01

Este registro complementa o panorama de produção de
[`project-status-2026-08-28.md`](project-status-2026-08-28.md). A entrega abaixo
foi publicada na aplicação web sem alterar banco, sincronizações ou automações
de produção.

## Inteligência de Mercado — primeira versão em produção

A nova rota `/inteligencia` testa quatro blocos de decisão comercial em uma
única experiência:

1. **Radar de Ações:** prioriza reprecificação, reposição, aceleração,
   liquidação e investigação, com filtros e impacto indicativo.
2. **Produto 360:** reúne preço, margem estimada, vendas, estoque, cobertura,
   tendência e uma recomendação automática por anúncio.
3. **Concorrentes:** demonstra a comparação de preço, venda aparente, avaliação
   e movimento, além do fluxo de inclusão de um monitor.
4. **Precificação:** simula um novo preço e mostra lucro unitário, margem e
   impacto mensal sem alterar anúncios.

A aba aparece no setor Comercial e respeita o controle de acesso existente por
aba (`requireTabAccess("inteligencia")`).

## Contrato dos dados desta versão

- **Interno — real:** produtos Shopee, venda em 30/60 dias, receita, estoque e
  preço. O custo vem ao vivo de `oraculo_sku_unit_cost`, o livro canônico com
  prioridade override manual > cadastro Olist > kit pelos componentes.
- **Externo — demonstração:** concorrentes, preço mediano, venda aparente,
  avaliações e tendência externa são cenários visuais, identificados como tal
  na tela.
- O cadastro de um concorrente existe somente no estado local do navegador:
  não consulta a Shopee e não grava no banco.
- As recomendações e oportunidades são heurísticas do protótipo. Estoque a
  liquidar é apresentado como **capital em estoque** e não entra no card de
  oportunidade de ganho.
- A precificação usa a carga efetiva de taxas inferida do preço atual. Não
  substitui o motor fiscal nem toca a Calculadora independente.

## Decisões técnicas

- A leitura de `shopee_products` é paginada e seleciona somente as colunas
  necessárias. Isso evita colocar uma carga superior a 2 MB no cache do Next.
- Não houve migration, tabela nova, scraper, chamada a marketplace ou gravação
  externa.
- O bloco interativo é um Client Component; a carga e a autorização permanecem
  no servidor.
- O layout segue o tema e o shell existentes e possui reorganização responsiva.

## Double-check de custos em Parâmetros

A seção **Conferência de custos** foi acrescentada dentro de `/parametros`. Ela
mostra uma linha por SKU do catálogo com:

- custo cadastrado e custo médio do ERP;
- custo bruto efetivamente escolhido pelo resolvedor;
- custo líquido depois dos créditos recuperáveis;
- origem da decisão (`override`, Olist ou kit calculado);
- situação: conferido, sem custo, divergência, correção manual ou kit;
- correção manual inline e opção de voltar ao ERP.

A busca aceita SKU ou nome, há filtros por situação e a tabela limita a
renderização a 250 linhas por vez. O link no Produto 360 abre diretamente o SKU
correspondente nessa conferência.

Medição local em 01/09: 3.329 SKUs únicos, 2.132 com custo resolvido, 1.197 sem
custo, 7 correções manuais e 4 divergências de pelo menos 20% entre custo
cadastrado e custo médio. O universo inclui itens inativos/históricos do
catálogo; “sem custo” aqui não implica que o produto tenha venda atual.

Uma correção passa a alimentar a Inteligência imediatamente. O motor fiscal já
usa a mesma view canônica e seus snapshots continuam sendo recalculados em até
1 minuto pelo mecanismo existente. Nenhum custo foi alterado durante a
validação e nenhuma migration foi necessária.

## Novidades pós-login — em produção

O shell autenticado agora consulta um manifesto versionado de publicações e
abre um pop-up quando há uma ou mais novidades com menos de 48 horas. A janela
resume a mudança, pode oferecer atalhos para a área correspondente e informa o
horário exato em que o aviso deixa de aparecer.

O comportamento é por evento de login:

- uma autenticação bem-sucedida cria um identificador aleatório com a mesma
  duração da sessão de uma hora;
- o aviso aparece uma vez para aquele login, mesmo que o usuário navegue entre
  páginas ou abra outra aba;
- sair e entrar novamente cria outro identificador e mostra as novidades outra
  vez enquanto elas estiverem dentro das 48 horas;
- uma publicação nova, adicionada durante uma sessão já aberta, também volta a
  abrir o pop-up porque altera o conjunto de versões ativas;
- ao marcar **Não mostrar novamente esta atualização**, os IDs exibidos ficam
  silenciados também nos próximos logins; somente um ID de publicação ainda
  não visto torna o pop-up elegível outra vez;
- depois das 48 horas, a publicação expira automaticamente, sem banco, cron ou
  limpeza manual.

A primeira edição reúne Inteligência de Mercado, Conferência de custos e a
explicação do próprio aviso. Desktop e viewport de 390 × 844 px foram
revisados; fechamento, recarga, navegação e múltiplas abas foram exercitados.
O build de produção e os 55 testes de domínio foram aprovados. A mudança foi
publicada nos dois remotes no commit `7f2fa78`; o deploy Vercel
`dpl_3ZtT1c3R8ey1Q9eqcBDYtLooV64h` chegou a `Ready` e recebeu o alias
`https://oraculo.oliverhome.com.br`.

A primeira publicação começa em 01/09/2026 às 17:00 BRT e expira em 03/09/2026
às 17:00 BRT. Não houve migration, tabela, cron ou alteração de dados.

Runbook: [`release-notes.md`](release-notes.md).

## Validação e publicação

- TypeScript sem erros;
- build de produção do Next concluído com a rota `/inteligencia`;
- quatro blocos navegados no browser;
- filtro do Radar, troca de produto, inclusão demonstrativa de concorrente e
  simulação por mediana externa exercitados;
- busca por SKU, filtros de custo, ligação Produto 360 → Parâmetros e exibição
  de overrides exercitados sem gravar alterações;
- 55 testes de domínio aprovados;
- revisão visual em desktop e viewport móvel de 390 × 844 px.
- push realizado nos remotes `origin` e `personal`; a Vercel acompanha o
  `personal/main`.

Publicação confirmada:

- commit: `fb62105` (`feat: add market intelligence and cost audit`);
- GitHub: `origin/main` e `personal/main` apontando para o mesmo commit;
- Vercel: deployment `dpl_2TDLGF4iHarBbxmddAzjWD4zJtZy`, status `Ready`;
- domínio: `https://oraculo.oliverhome.com.br`;
- `/inteligencia` e `/parametros?secao=custos` redirecionam visitantes sem
  sessão para `/login`, preservando a proteção esperada. O conteúdo autenticado
  foi exercitado no localhost antes do push.

Arquivos centrais:

- `apps/web/app/inteligencia/page.tsx`;
- `apps/web/app/inteligencia/data.ts`;
- `apps/web/app/inteligencia/intelligence-dashboard.tsx`;
- `apps/web/app/parametros/page.tsx`;
- `apps/web/app/globals.css`;
- `apps/web/lib/auth/tabs.ts`.

## Próximo passo recomendado

Validar com usuários quais ações e explicações são úteis. Só depois dessa
validação vale persistir monitores e escolher uma fonte externa compatível com
os termos do marketplace. Até lá, qualquer número externo deve continuar
claramente marcado como demonstração.

## Separação multicanal — produção

Em 01/09, o fechamento de separação deixou de depender exclusivamente da API
Shopee. A nova automação lê os pedidos de marketplace sincronizados da Olist,
roda diariamente às 07:00 e 13:30 (America/Sao_Paulo) e entrega mensagens
paginadas mais um CSV completo. A regra de consolidação soma somente linhas com
o mesmo SKU, produto e descritivo.

A migration `20260901181241_olist_multichannel_separation_cursor.sql` adiciona
o cursor de primeira observação em `olist_orders` e a RPC agregada
`olist_multichannel_separation_report`, executável apenas por `service_role`.
O cursor só avança depois do envio de todas as mensagens e do CSV; pedidos sem
itens interrompem o fechamento para não criar perda silenciosa.

A prévia de validação processou 525 pedidos novos, 12 marketplaces e 588
unidades Olist. O relatório gerou 112 linhas após desmembrar kits mistos, com
50 linhas cubadas e 62 explicitamente sem cubagem. O reconhecimento adicional
dos potes usa apenas perfis existentes: kits marmita conhecidos e potes de
bambu por formato, volume e quantidade. Dez variações de potes marmita ainda
não possuem capacidade correspondente no catálogo e, por segurança, continuam
marcadas como sem cubagem.

Após a validação, o workflow n8n multicanal `UGLCLNS6oVCK87o3` ficou ativo e o
workflow legado Shopee `GJHOwusnuXgaxVaT` foi desativado com backup local.
