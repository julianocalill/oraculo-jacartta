#!/usr/bin/env node

// Backfill único do controle de acesso por aba.
//
// Antes desta feature, qualquer usuário autenticado enxergava todas as abas
// (só /usuarios checava perfil). Depois dela, quem não tem `app_metadata.tabs`
// fica sem nenhuma aba. Este script grava as 13 abas do grupo "Principal" em
// todo usuário que ainda não tem a chave — preservando exatamente o que essas
// pessoas já viam — e deixa Usuários/Status sync de fora, que era a intenção
// original do grupo "Admin".
//
// Os administradores fixos (juliano@oliverhome.com.br e
// oliveiros_cardoso@hotmail.com) não precisam de nada: têm acesso total por
// email, independente do metadata.
//
// Uso: node scripts/backfill-tab-access.js [--dry-run]

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const MAIN_TABS = [
  "analytics",
  "pedidos",
  "mais-vendidos",
  "skus",
  "curva-de-venda",
  "curva-de-estoque",
  "shopee",
  "mercado-livre",
  "devolucoes",
  "importacoes",
  "calculadora",
  "alertas",
  "parametros"
];

const MASTER_EMAILS = ["juliano@oliverhome.com.br", "oliveiros_cardoso@hotmail.com"];

function loadEnv() {
  const file = readFileSync(join(process.cwd(), ".env"), "utf8");
  const env = {};

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }

  return env;
}

function requireEnv(env, key) {
  const value = process.env[key] || env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

async function authFetch(baseUrl, serviceKey, path, init = {}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  return { response, text };
}

async function listAllUsers(baseUrl, serviceKey) {
  const users = [];
  const perPage = 200;

  for (let page = 1; ; page += 1) {
    const { response, text } = await authFetch(
      baseUrl,
      serviceKey,
      `admin/users?page=${page}&per_page=${perPage}`
    );
    if (!response.ok) {
      throw new Error(`Falha ao listar usuários (${response.status}): ${text.slice(0, 300)}`);
    }

    const parsed = JSON.parse(text);
    const batch = Array.isArray(parsed.users) ? parsed.users : [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }

  return users;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = loadEnv();
  const baseUrl = requireEnv(env, "SUPABASE_URL");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const users = await listAllUsers(baseUrl, serviceKey);
  console.log(`${users.length} usuários encontrados.${dryRun ? " (dry-run)" : ""}`);

  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    const email = String(user.email || "").toLowerCase();
    const metadata = user.app_metadata || {};
    const isMaster = MASTER_EMAILS.includes(email);

    if (Array.isArray(metadata.tabs)) {
      skipped += 1;
      console.log(`- ${email}: já tem ${metadata.tabs.length} abas, mantido.`);
      continue;
    }

    if (isMaster) {
      skipped += 1;
      console.log(`- ${email}: administrador fixo, acesso total por email.`);
      continue;
    }

    if (dryRun) {
      updated += 1;
      console.log(`- ${email}: receberia ${MAIN_TABS.length} abas (Principal).`);
      continue;
    }

    const { response, text } = await authFetch(baseUrl, serviceKey, `admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ app_metadata: { tabs: MAIN_TABS } })
    });

    if (!response.ok) {
      throw new Error(`Falha ao atualizar ${email} (${response.status}): ${text.slice(0, 300)}`);
    }

    updated += 1;
    console.log(`- ${email}: ${MAIN_TABS.length} abas liberadas (Principal).`);
  }

  console.log(`\nConcluído: ${updated} atualizados, ${skipped} inalterados.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
