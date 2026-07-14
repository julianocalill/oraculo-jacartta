#!/usr/bin/env node

const { createHash, randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function loadEnv() {
  const env = { ...process.env };
  const file = readFileSync(join(process.cwd(), ".env"), "utf8");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in env)) env[key] = value;
  }
  return env;
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) throw new Error(`Variável ausente no .env: ${key}`);
  return value;
}

function base64Url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = requireEnv(env, "SUPABASE_URL");
  const serviceRoleKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const appId = requireEnv(env, "MERCADOLIVRE_APP_ID");
  const redirectUri = requireEnv(env, "MERCADOLIVRE_OAUTH_REDIRECT_URI");
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(64));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/mercadolivre_oauth_states`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ state, code_verifier: codeVerifier, redirect_uri: redirectUri, expires_at: expiresAt })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao registrar estado OAuth (${response.status}): ${text.slice(0, 300)}`);
  }

  const authorizationUrl = new URL("https://auth.mercadolivre.com.br/authorization");
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", appId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  console.log("Abra este link em até 10 minutos e autorize com a conta administradora da loja:\n");
  console.log(authorizationUrl.toString());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
