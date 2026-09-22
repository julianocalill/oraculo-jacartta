import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workflowId = 'UGLCLNS6oVCK87o3';
const baseUrl = process.env.N8N_BASE_URL?.replace(/\/+$/, '');
const apiKey = process.env.N8N_API_KEY;
if (!baseUrl || !apiKey) throw new Error('N8N_BASE_URL e N8N_API_KEY são obrigatórios.');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/v1/${path}`, {
    ...options,
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`n8n ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

const workflow = await request(`workflows/${workflowId}`);
const originalWorkflow = structuredClone(workflow);
if (!workflow.active) throw new Error('Workflow de separação não está ativo.');
const compose = workflow.nodes.find((node) => node.name === 'Montar consolidado multicanal');
const persisted = workflow.nodes.find((node) => node.name === 'Montar WhatsApp da lista persistida');
if (!compose?.parameters?.jsCode || !persisted?.parameters?.jsCode) {
  throw new Error('Nós esperados não encontrados; atualização cancelada.');
}
const marker = 'const contextCandidates =';
const tailAt = compose.parameters.jsCode.indexOf(marker);
if (tailAt < 0) throw new Error('Ponto de entrada do consolidado não encontrado.');

const library = (await readFile(new URL('./olist-multichannel-separation.mjs', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');
compose.parameters.jsCode = `${library}\n${compose.parameters.jsCode.slice(tailAt)}`;
new Function(compose.parameters.jsCode);

const oldPersisted = persisted.parameters.jsCode;
let updatedPersisted = oldPersisted.replaceAll('Itens vendidos', 'Unidades a separar');
updatedPersisted = updatedPersisted.replaceAll(
  '.filter((row) => asNumber(row.boxes) >= 1)',
  '.filter((row) => true)',
);
updatedPersisted = updatedPersisted
  .replace("'Produto', 'Descritivo',", "'Produto',")
  .replace('      row.product,\n      row.description,', '      displaySeparationProduct(row),')
  .replace('truncate(row.product, 70)} | Descritivo: ${truncate(row.description, 100)}', 'displaySeparationProduct(row)}');
if (!updatedPersisted.includes('function displaySeparationProduct(row)')) {
  const helper = library.match(/function displaySeparationProduct\(row\) \{[\s\S]*?\n\}/)?.[0];
  if (!helper) throw new Error('Formatador de produto não encontrado.');
  updatedPersisted = `${helper}\n\n${updatedPersisted}`;
}
if (updatedPersisted.includes('Descritivo') || !updatedPersisted.includes('displaySeparationProduct(row),')) {
  throw new Error('Contrato CSV/WhatsApp do nó de reenvio mudou; atualização cancelada.');
}
if (updatedPersisted === oldPersisted && !oldPersisted.includes('Unidades a separar')) {
  throw new Error('Contrato do nó de reenvio mudou; atualização cancelada.');
}
persisted.parameters.jsCode = updatedPersisted;
new Function(persisted.parameters.jsCode);

const apply = process.argv.includes('--apply');
console.log(JSON.stringify({ workflowId, active: workflow.active, nodes: workflow.nodes.length,
  apply, changed: ['Montar consolidado multicanal', 'Montar WhatsApp da lista persistida'] }));
if (!apply) process.exit(0);

const backupDir = resolve('tmp/n8n-backups');
await mkdir(backupDir, { recursive: true });
const backupPath = resolve(backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_${workflowId}.json`);
await writeFile(backupPath, JSON.stringify(originalWorkflow, null, 2), { mode: 0o600 });
console.log(`Backup salvo em ${backupPath}`);

const payload = { name: workflow.name, nodes: workflow.nodes,
  connections: workflow.connections, settings: workflow.settings };
await request(`workflows/${workflowId}`, { method: 'PUT', body: JSON.stringify(payload) });
const verified = await request(`workflows/${workflowId}`);
const current = verified.nodes.find((node) => node.name === 'Montar consolidado multicanal');
if (!verified.active || current?.parameters?.jsCode !== compose.parameters.jsCode) {
  throw new Error('Workflow atualizado, mas verificação de leitura divergiu. Consulte o backup.');
}
console.log('Workflow ativo atualizado e verificado.');
