#!/usr/bin/env node

const WORKFLOW_NAME = "Giracasa - OAuth Shopee para Supabase";
const WEBHOOK_ID = "d544ac83-a9a2-4d11-acbb-1e85b52c154d";
const WEBHOOK_PATH = "giracasa-shopee-oauth/:state";
const CALLBACK_URL = "https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/giracasa-shopee-oauth-callback";

const baseUrl = String(process.env.N8N_BASE_URL ?? "").replace(/\/+$/, "");
const apiKey = String(process.env.N8N_API_KEY ?? "");
if (!baseUrl || !apiKey) throw new Error("N8N_BASE_URL/N8N_API_KEY ausentes.");

async function request(path, options = {}) {
  const response = await fetch(new URL(path, `${baseUrl}/`), {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`n8n ${options.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 400)}`);
  return data;
}

async function findWorkflow() {
  let cursor;
  do {
    const path = cursor ? `/api/v1/workflows?cursor=${encodeURIComponent(cursor)}` : "/api/v1/workflows";
    const page = await request(path);
    const found = (page.data ?? []).find((workflow) => workflow.name === WORKFLOW_NAME);
    if (found) return found;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

const redirectExpression = `={{ '${CALLBACK_URL}?code=' + encodeURIComponent($json.query.code || '') + '&shop_id=' + encodeURIComponent($json.query.shop_id || '') + '&state=' + encodeURIComponent($json.params.state || '') + '&error=' + encodeURIComponent($json.query.error || '') + '&message=' + encodeURIComponent($json.query.message || '') }}`;
const workflow = {
  name: WORKFLOW_NAME,
  nodes: [
    {
      id: "giracasa-shopee-oauth-webhook",
      webhookId: WEBHOOK_ID,
      name: "Receber retorno Shopee Giracasa",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [-260, 0],
      parameters: {
        httpMethod: "GET",
        path: WEBHOOK_PATH,
        responseMode: "responseNode",
        options: {}
      }
    },
    {
      id: "giracasa-shopee-oauth-redirect",
      name: "Encaminhar ao Supabase",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.4,
      position: [0, 0],
      parameters: {
        respondWith: "text",
        responseBody: "Concluindo autorizacao no Oraculo...",
        options: {
          responseCode: 302,
          responseHeaders: {
            entries: [{ name: "Location", value: redirectExpression }]
          }
        }
      }
    }
  ],
  connections: {
    "Receber retorno Shopee Giracasa": {
      main: [[{ node: "Encaminhar ao Supabase", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1" }
};

const existing = await findWorkflow();
let workflowId;
if (existing) {
  await request(`/api/v1/workflows/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify(workflow)
  });
  workflowId = existing.id;
  if (!existing.active) await request(`/api/v1/workflows/${workflowId}/activate`, { method: "POST", body: "{}" });
} else {
  const created = await request("/api/v1/workflows", { method: "POST", body: JSON.stringify(workflow) });
  workflowId = created.id;
  await request(`/api/v1/workflows/${workflowId}/activate`, { method: "POST", body: "{}" });
}

console.log(JSON.stringify({
  workflowId,
  workflowName: WORKFLOW_NAME,
  webhookUrl: `${baseUrl}/webhook/${WEBHOOK_ID}/${WEBHOOK_PATH.replace(":state", "<state>")}`,
  callbackUrl: CALLBACK_URL
}, null, 2));
