#!/usr/bin/env node

// Deploy de Edge Function pela Management API do Supabase.
//
// Existe pelo mesmo motivo do apply-sql.js: o ambiente não tem Supabase CLI nem
// Docker. O `User-Agent: curl/8.4.0` é obrigatório — sem ele o Cloudflare da
// api.supabase.com responde 403.
//
// As funções deste projeto são chamadas pelo pg_net (não por usuário logado),
// então sobem com `verify_jwt = false` e se protegem sozinhas pelo header
// `x-sync-secret`.
//
// uso:
//   node scripts/deploy-edge-function.js importacoes-ais-sync
//   node scripts/deploy-edge-function.js importacoes-ais-sync --secret AISSTREAM_API_KEY=abc123
//
// `--secret NOME=valor` (repetível) grava/atualiza a env var da função antes do
// deploy. O valor não é ecoado no stdout.

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const API = "https://api.supabase.com/v1";

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

function headers(env, extra = {}) {
  return {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    "User-Agent": "curl/8.4.0",
    ...extra
  };
}

async function setSecrets(env, secrets) {
  const response = await fetch(`${API}/projects/${env.SUPABASE_PROJECT_REF}/secrets`, {
    method: "POST",
    headers: headers(env, { "Content-Type": "application/json" }),
    body: JSON.stringify(secrets)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha ao gravar secrets (${response.status}): ${text.slice(0, 300)}`);
  }
  console.log(`Secrets gravados: ${secrets.map((secret) => secret.name).join(", ")}`);
}

async function deployFunction(env, slug) {
  const source = readFileSync(join(process.cwd(), "supabase", "functions", slug, "index.ts"), "utf8");

  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          name: slug,
          entrypoint_path: "index.ts",
          verify_jwt: false
        })
      ],
      { type: "application/json" }
    )
  );
  form.append("file", new Blob([source], { type: "application/typescript" }), "index.ts");

  const response = await fetch(
    `${API}/projects/${env.SUPABASE_PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    { method: "POST", headers: headers(env), body: form }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha no deploy de ${slug} (${response.status}): ${text.slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return payload;
}

async function main() {
  const env = loadEnv();
  for (const key of ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN"]) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }

  const args = process.argv.slice(2);
  const slug = args.find((arg) => !arg.startsWith("--"));
  if (!slug) throw new Error("Informe o slug da função. Ex.: node scripts/deploy-edge-function.js importacoes-ais-sync");

  const secrets = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--secret") continue;
    const pair = args[index + 1] ?? "";
    const eq = pair.indexOf("=");
    if (eq === -1) throw new Error("--secret espera NOME=valor");
    secrets.push({ name: pair.slice(0, eq), value: pair.slice(eq + 1) });
  }

  if (secrets.length > 0) await setSecrets(env, secrets);

  const result = await deployFunction(env, slug);
  console.log(`Deploy de ${slug} concluído.`);
  if (result && typeof result === "object") {
    console.log(
      JSON.stringify(
        { id: result.id, slug: result.slug, status: result.status, version: result.version },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
