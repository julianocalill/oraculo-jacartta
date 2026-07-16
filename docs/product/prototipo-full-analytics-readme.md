> **Proveniência (2026-07-16):** README do protótipo standalone (`~/full`,
> Next.js + Prisma/SQLite) que validou as telas de ruptura/cobertura/parado
> antes da decisão de construir dentro do Oráculo. O OAuth e o sync próprios
> do protótipo foram aposentados (regra: uma única implementação OAuth, a do
> Oráculo). Arquivado como registro; não executar em produção.

# Full Analytics — BI para Mercado Livre Full

MVP V1 (validação). Plataforma **somente leitura** que conecta contas do Mercado Livre e mostra:

- 🚨 **Ruptura** — itens que vendem mas estão sem estoque no Full, com **perda estimada em R$/dia**
- 📦 **Cobertura** — quantos dias o estoque Full de cada item dura (semáforo 7/15 dias)
- 🧊 **Estoque Parado** — capital imobilizado no Full (sem venda em 30d ou anúncio pausado)
- 🔗 **Multi-conta** — várias contas ML no mesmo painel

Ver [PRD.md](PRD.md) para o plano completo do produto.

## Rodando localmente

```bash
npm install
npx prisma migrate dev   # cria o banco SQLite (prisma/dev.db)
npm run db:seed          # (opcional) dados fictícios para ver as telas
npm run dev              # http://localhost:3000
```

Para remover os dados de demonstração: `npm run db:seed -- --clean`

## Conectando sua conta real do Mercado Livre

1. Crie/acesse seu app em https://developers.mercadolivre.com.br/
2. Preencha no `.env`:
   - `ML_CLIENT_ID` — App ID
   - `ML_CLIENT_SECRET` — Secret Key
   - `ML_REDIRECT_URI` — a URI de redirect **cadastrada no app** (ex: `https://SEU-DOMINIO/api/ml/callback`)
3. ⚠️ O ML exige **HTTPS** na redirect URI. Em desenvolvimento, use um túnel:
   ```bash
   ngrok http 3000
   # cadastre https://xxxx.ngrok.app/api/ml/callback no painel do app ML
   # e use essa mesma URL no ML_REDIRECT_URI do .env
   ```
4. Acesse **Contas ML → Conectar conta do Mercado Livre** e autorize.
5. O primeiro sync dispara automaticamente; depois use **Sincronizar agora** no Dashboard.

## Arquitetura (resumo)

| Camada | Onde |
|---|---|
| OAuth ML (auth + callback + refresh) | `src/app/api/ml/*`, `src/lib/ml.ts` |
| Ingestão (anúncios, estoque Full, pedidos 30d, snapshots) | `src/lib/sync.ts`, `POST /api/sync` |
| Regras analíticas (ruptura, cobertura, parado) | `src/lib/reports.ts` |
| Telas (Server Components) | `src/app/{page,ruptura,cobertura,parado,contas}` |
| Banco (SQLite dev / Postgres em prod) | `prisma/schema.prisma` |

### Notas
- Acesso à API do ML é **somente leitura** — o app não altera nada na conta.
- `SalesDaily` e `InventorySnapshot` acumulam histórico desde o 1º sync — são a base
  das análises futuras (evolução, elasticidade).
- Para deploy (Vercel): trocar o datasource do Prisma para Postgres (Neon) e agendar
  `POST /api/sync` via Vercel Cron (diário).
