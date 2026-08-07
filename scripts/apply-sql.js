#!/usr/bin/env node

// Aplica SQL em produção pela Management API do Supabase.
//
// Existe porque o ambiente não tem Supabase CLI nem Docker (mesma restrição que
// levou o deploy de Edge Function a ir por multipart na Management API — ver
// docs/deployment-map.md). O `User-Agent: curl/8.4.0` é obrigatório: sem ele o
// Cloudflare da api.supabase.com responde 403.
//
// uso:
//   node scripts/apply-sql.js docs/runbook-fix-fiscal-coverage-2026-08-04.sql
//   node scripts/apply-sql.js --query "select count(*) from olist_orders"

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
  return { ok: response.ok, status: response.status, payload };
}

async function main() {
  const env = loadEnv();
  for (const key of ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN"]) {
    if (!env[key]) {
      console.error(`Faltando ${key} no .env`);
      process.exit(1);
    }
  }

  const args = process.argv.slice(2);
  const queryIndex = args.indexOf("--query");
  const query =
    queryIndex !== -1 ? args[queryIndex + 1] : readFileSync(args[0], "utf8");

  if (!query || !query.trim()) {
    console.error("uso: node scripts/apply-sql.js <arquivo.sql> | --query \"<sql>\"");
    process.exit(1);
  }

  const { ok, status, payload } = await runSql(env, query);
  console.log(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));

  if (!ok) {
    console.error(`\nFalhou com status ${status}.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
