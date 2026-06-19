const fs = require("node:fs/promises");
const path = require("node:path");

const workflowName = "codex - Monitor Oraculo Olist Supabase";
const n8nEnvPath = "/Users/julianocalil/espacodebicho-integracoes/.env";
const telegramEnvPath = "/Users/julianocalil/zebra-agent/.env";

function parseEnv(contents) {
  const values = {};

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }

  return values;
}

function requireValue(name, value) {
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
}

async function requestJson(baseUrl, apiKey, pathName, options = {}) {
  const url = new URL(pathName, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": apiKey,
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`n8n ${options.method ?? "GET"} ${pathName} falhou (${response.status}): ${text.slice(0, 500)}`);
  }

  return data;
}

async function findExistingWorkflow(baseUrl, apiKey) {
  let cursor;

  do {
    const query = cursor ? `/api/v1/workflows?cursor=${encodeURIComponent(cursor)}` : "/api/v1/workflows";
    const data = await requestJson(baseUrl, apiKey, query);
    const found = (data.data ?? []).find((workflow) => workflow.name === workflowName);
    if (found) return found;
    cursor = data.nextCursor;
  } while (cursor);

  return null;
}

function backupFileName(workflow) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = workflow.name.replace(/[^a-z0-9._-]+/gi, "_");
  return path.resolve("backups/n8n", `${timestamp}_${workflow.id}_${safeName}.json`);
}

function buildWorkflow({ supabaseUrl, syncSecret, botToken, chatId }) {
  const healthUrl = new URL("/functions/v1/olist-sync-health", supabaseUrl).toString();

  return {
    name: workflowName,
    nodes: [
      {
        id: "4f6de143-6ce2-4279-a111-7eb98c49c001",
        name: "Todo dia 07:05",
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [-760, 0],
        parameters: {
          rule: {
            interval: [
              {
                field: "cronExpression",
                expression: "5 7 * * *"
              }
            ]
          }
        }
      },
      {
        id: "4f6de143-6ce2-4279-a111-7eb98c49c002",
        name: "Consultar saude Supabase",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [-520, 0],
        parameters: {
          method: "POST",
          url: healthUrl,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              {
                name: "x-sync-secret",
                value: syncSecret
              }
            ]
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody: "={{ {} }}",
          options: {
            response: {
              response: {
                neverError: true
              }
            }
          }
        }
      },
      {
        id: "4f6de143-6ce2-4279-a111-7eb98c49c003",
        name: "Precisa alertar?",
        type: "n8n-nodes-base.if",
        typeVersion: 2.2,
        position: [-280, 0],
        parameters: {
          conditions: {
            combinator: "or",
            conditions: [
              {
                leftValue: "={{ $json.ok }}",
                rightValue: false,
                operator: {
                  type: "boolean",
                  operation: "equals"
                }
              },
              {
                leftValue: "={{ Array.isArray($json.alerts) ? $json.alerts.length : 0 }}",
                rightValue: 0,
                operator: {
                  type: "number",
                  operation: "gt"
                }
              }
            ]
          },
          options: {}
        }
      },
      {
        id: "4f6de143-6ce2-4279-a111-7eb98c49c004",
        name: "Preparar mensagem",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [-20, -100],
        parameters: {
          jsCode: `const payload = $json;
const alerts = Array.isArray(payload.alerts) && payload.alerts.length ? payload.alerts : [payload.error || 'Falha sem mensagem detalhada.'];

const lines = [
  'ORACULO - ALERTA SYNC OLIST',
  'Status: ' + (payload.ok ? 'ok' : 'falha'),
  'Verificado em: ' + (payload.checked_at || new Date().toISOString()),
  '',
  ...alerts.map((alert) => '- ' + alert),
  '',
  payload.latest_orders_run ? 'Pedidos: ' + payload.latest_orders_run.status + ' em ' + payload.latest_orders_run.started_at : 'Pedidos: sem execucao registrada',
  payload.latest_stock_run ? 'Estoque: ' + payload.latest_stock_run.status + ' em ' + payload.latest_stock_run.started_at : 'Estoque: sem execucao registrada',
  payload.latest_daily_sales ? 'Ultima venda no BI: ' + payload.latest_daily_sales.order_date : '',
  payload.needs_reauth && payload.oauth_authorize_url ? 'Reautorizar Olist: ' + payload.oauth_authorize_url : ''
].filter((line) => line !== '').join('\\n');

return [{ json: { text: lines.slice(0, 3900) } }];`
        }
      },
      {
        id: "4f6de143-6ce2-4279-a111-7eb98c49c005",
        name: "Enviar Telegram",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [220, -100],
        parameters: {
          method: "POST",
          url: `https://api.telegram.org/bot${botToken}/sendMessage`,
          sendBody: true,
          specifyBody: "json",
          jsonBody: `={{ { chat_id: "${chatId}", text: $json.text } }}`,
          options: {
            response: {
              response: {
                neverError: true
              }
            }
          }
        }
      }
    ],
    connections: {
      "Todo dia 07:05": {
        main: [[{ node: "Consultar saude Supabase", type: "main", index: 0 }]]
      },
      "Consultar saude Supabase": {
        main: [[{ node: "Precisa alertar?", type: "main", index: 0 }]]
      },
      "Precisa alertar?": {
        main: [
          [{ node: "Preparar mensagem", type: "main", index: 0 }],
          []
        ]
      },
      "Preparar mensagem": {
        main: [[{ node: "Enviar Telegram", type: "main", index: 0 }]]
      }
    },
    settings: {
      executionOrder: "v1",
      timezone: "America/Sao_Paulo"
    }
  };
}

async function main() {
  const [oraculoEnv, n8nEnv, telegramEnv] = await Promise.all([
    fs.readFile(".env", "utf8").then(parseEnv),
    fs.readFile(n8nEnvPath, "utf8").then(parseEnv),
    fs.readFile(telegramEnvPath, "utf8").then(parseEnv)
  ]);

  requireValue("SUPABASE_URL", oraculoEnv.SUPABASE_URL);
  requireValue("OLIST_SYNC_JOB_SECRET", oraculoEnv.OLIST_SYNC_JOB_SECRET);
  requireValue("N8N_BASE_URL", n8nEnv.N8N_BASE_URL);
  requireValue("N8N_API_KEY", n8nEnv.N8N_API_KEY);
  requireValue("TELEGRAM_BOT_TOKEN", telegramEnv.TELEGRAM_BOT_TOKEN);
  requireValue("TELEGRAM_CHAT_ID", telegramEnv.TELEGRAM_CHAT_ID);

  const workflowPayload = buildWorkflow({
    supabaseUrl: oraculoEnv.SUPABASE_URL,
    syncSecret: oraculoEnv.OLIST_SYNC_JOB_SECRET,
    botToken: telegramEnv.TELEGRAM_BOT_TOKEN,
    chatId: telegramEnv.TELEGRAM_CHAT_ID
  });

  const existing = await findExistingWorkflow(n8nEnv.N8N_BASE_URL, n8nEnv.N8N_API_KEY);
  let workflow;
  let created = false;
  let backupPath = null;

  if (existing) {
    workflow = await requestJson(n8nEnv.N8N_BASE_URL, n8nEnv.N8N_API_KEY, `/api/v1/workflows/${existing.id}`);
    backupPath = backupFileName(workflow);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, JSON.stringify(workflow, null, 2));

    workflow = await requestJson(n8nEnv.N8N_BASE_URL, n8nEnv.N8N_API_KEY, `/api/v1/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: workflowPayload.name,
        nodes: workflowPayload.nodes,
        connections: workflowPayload.connections,
        settings: workflowPayload.settings
      })
    });
  } else {
    workflow = await requestJson(n8nEnv.N8N_BASE_URL, n8nEnv.N8N_API_KEY, "/api/v1/workflows", {
      method: "POST",
      body: JSON.stringify(workflowPayload)
    });
    created = true;
  }

  if (!workflow.active) {
    await requestJson(n8nEnv.N8N_BASE_URL, n8nEnv.N8N_API_KEY, `/api/v1/workflows/${workflow.id}/activate`, {
      method: "POST",
      body: "{}"
    });
  }

  console.log(JSON.stringify({
    ok: true,
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    created,
    active: true,
    backup_path: backupPath,
    schedule: "Diario as 07:05 America/Sao_Paulo"
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
