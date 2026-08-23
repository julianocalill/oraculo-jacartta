#!/usr/bin/env node

// Backfill das colunas materializadas de envio em olist_orders
// (forma_envio, frete_por_conta, codigo_rastreamento, valor_frete).
//
// `transportador_nome` existiu até 23/08 e foi removida: vinha 0% preenchida
// (o marketplace despacha, o ERP não grava transportadora). Ver a migration
// 20260823170000. O trigger oraculo_olist_order_logistics_fields() faz o
// trabalho; este script só o dispara em lotes com um no-op
// `set transportador = transportador`, andando por cursor de id — nunca por
// "where coluna is null", porque um pedido com transportador vazio produz
// NULL de novo e seria re-escolhido para sempre (armadilha documentada no
// AGENTS.md).
//
// Roda pela Management API (mesmo canal do apply-sql.js); cada lote fica bem
// abaixo do statement timeout de 2 min.
//
// uso: node scripts/backfill-olist-orders-transportador.js [--batch 20000]

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function loadEnv() {
  const env = { ...process.env };
  try {
    const file = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = env[key] || value;
    }
  } catch {}
  return env;
}

async function runSql(env, query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "curl/8.4.0"
      },
      body: JSON.stringify({ query })
    }
  );
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`Management API ${response.status}: ${text.slice(0, 400)}`);
  }
  return payload;
}

async function main() {
  const env = loadEnv();
  for (const key of ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN"]) {
    if (!env[key]) throw new Error(`Faltando ${key} no .env`);
  }

  const args = process.argv.slice(2);
  const batchIndex = args.indexOf("--batch");
  const batchSize = batchIndex !== -1 ? Number(args[batchIndex + 1]) : 20000;

  const totals = await runSql(env, "select count(*) as total from olist_orders");
  const total = Number(totals[0]?.total ?? 0);
  console.log(`olist_orders: ${total} linhas; lotes de ${batchSize}.`);

  let lastId = "";
  let processed = 0;

  for (;;) {
    const rows = await runSql(
      env,
      `with batch as (
         select id from olist_orders
         where id > '${lastId.replace(/'/g, "''")}'
         order by id
         limit ${batchSize}
       ),
       updated as (
         update olist_orders o
         set transportador = o.transportador
         from batch
         where o.id = batch.id
         returning o.id
       )
       select max(id) as last_id, count(*) as n from updated`
    );

    const n = Number(rows[0]?.n ?? 0);
    if (!n) break;
    lastId = String(rows[0].last_id);
    processed += n;
    console.log(`${processed}/${total} pedidos processados (ate id ${lastId}).`);
  }

  const check = await runSql(
    env,
    "select count(*) as com_forma_envio, count(valor_frete) as com_valor_frete from (select forma_envio, valor_frete from olist_orders where forma_envio is not null or valor_frete is not null) x"
  );
  console.log("Verificacao:", JSON.stringify(check[0] ?? {}));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
