const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '../apps/web')] }));

function load(relative, imports, globals = {}) {
  const filename = path.join(__dirname, '..', relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports,
    require: (name) => { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name]; },
    Date, Intl, Map, Set, URL, URLSearchParams, AbortSignal, AbortController, Response, Request, Headers, Buffer,
    setTimeout, clearTimeout, console: { error() {} }, ...globals
  }, { filename });
  return module.exports;
}
const domain = import('../packages/domain/bia.js');
const commercial = import('../packages/domain/commercial-analysis.js');
test('chat fora do menu preserva permissão e não vira destino de login quando há outra página', () => {
  const tabs = load('apps/web/lib/auth/tabs.ts', {});
  const access = load('apps/web/lib/auth/access.ts', {
    'next/navigation': { redirect() { throw new Error('Unexpected redirect'); } },
    '../operation-status': { operationIsReady: () => true },
    '../operation-context': { getRequestOperation: async () => 'uberlandia' },
    './path-tabs': { tabForPath: () => null },
    './session': { readEnvValue: () => undefined, requireCurrentUser: async () => null },
    './tabs': tabs
  }, { process: { env: { NODE_ENV: 'production' } } });
  const user = { id: 'ordinary-user', email: 'ordinary@example.test', app_metadata: { tabs: ['bia', 'analise-comercial'] } };
  assert.equal(access.canAccess(user, 'bia'), true);
  assert.equal(access.canAccess(user, 'analise-comercial'), true);
  assert.equal(access.firstAllowedHref(user), '/analise-comercial');
  const onlyChat = { ...user, app_metadata: { tabs: ['bia'] } };
  assert.equal(access.firstAllowedHref(onlyChat), '/bia');
  assert.equal(access.canAccess(onlyChat, 'analise-comercial'), false);
  assert.equal(access.firstAllowedHref({ ...user, oraculo_operation_allowed: false }), null);
});
const fixture = () => ({
  products: [
    { sku: '1', product_name: 'Com custo', units: 2, revenue: 100, covered_revenue: 100, covered_profit: 20, cost: 50, taxes: 10, fees: 20, missing_cost_lines: 0, missing_fee_lines: 0 },
    { sku: '2', product_name: 'Sem custo', units: 9, revenue: 900, covered_revenue: 0, covered_profit: 0, cost: 0, taxes: 0, fees: 0, missing_cost_lines: 1, missing_fee_lines: 0 },
    { sku: '3', product_name: 'Margem negativa', units: 1, revenue: 20, covered_revenue: 20, covered_profit: -10, cost: 25, taxes: 2, fees: 3, missing_cost_lines: 0, missing_fee_lines: 0 }
  ], daily: [{ day: '2026-09-01', revenue: 1100, invoices: 10 }], channels: ['Shopee Jacartta'], processed_days: 30,
  latest_refresh: '2026-10-02T12:00:00Z', oldest_refresh: '2026-09-30T12:00:00Z', recent_refresh: null
});
async function builder() {
  return load('apps/web/lib/bia/answer.ts', {
    '@oraculo/domain/commercial-analysis.js': await commercial,
    '@oraculo/domain/bia.js': await domain,
    '../date': load('apps/web/lib/date.ts', {}),
    '../column-hints': { HINTS: {} }
  }).buildBiaAnswer;
}
async function route(options = {}) {
  const calls = { query: 0, model: 0, page: 0, plan: null };
  const canAccessRequest = async (_, tab) => tab === 'bia' ? options.chat !== false : options.allowedTabs ? options.allowedTabs.includes(tab) : options.data !== false;
  const sources = await import('../packages/domain/bia-sources.js');
  const across = load('apps/web/lib/bia/oraculo.ts', {
    'server-only': {}, '@oraculo/domain/bia-sources.js': sources, '@oraculo/domain/bia.js': await domain, '@oraculo/domain/commercial-analysis.js': await commercial,
    '../auth/access': { canAccessRequest, isMaster: () => false }, '../auth/tabs': { isTabKey: () => true },
    '../operation-context': { getRequestOperation: async () => 'uberlandia' },
    './page-source': { readBiaPage: async (_, sourceId, __, params) => { calls.page++; return {sourceId,label:sources.biaSourceById(sourceId).label,href:'/devolucoes?'+params,filters:[],notices:[],facts:[{id:'returns:0',kind:'metric',label:'Devoluções abertas',value:'42'}]}; } },
    './evidence-selection': {rankSourceFacts: (_, facts) => facts, selectBiaEvidence: async (_, facts) => ({facts,local:false})}
  });
  const implementation = load('apps/web/app/bia/responder/route.ts', {
    '@oraculo/domain/bia.js': await domain,
    '@oraculo/domain/bia-sources.js': sources,
    '../../../lib/bia/oraculo': across,
    '../../../lib/auth/session': { getCurrentUser: async () => options.anonymous ? null : { id: 'test-user', user_metadata: {full_name:'Juliano Calil'} } },
    '../../../lib/auth/access': { canAccessRequest },
    '../../../lib/date': { getSaoPauloToday: () => '2026-10-02' },
    '../../../lib/bia/answer': { buildBiaAnswer: await builder() },
    '../../../lib/bia/ollama': { interpretBia: async () => { calls.model++; return options.hint ?? null; } },
    '../../../lib/bia/queries': { queryBia: async (plan) => { calls.query++; calls.plan = plan; return { current: fixture(), previous: null, channels: [] }; } },
    '../../../lib/operation-context': { getRequestOperation: async () => 'uberlandia' }
  });
  return { calls, post: (body, headers = {}) => implementation.POST(new Request('https://oraculo.example/o/uberlandia/bia/responder', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
  })) };
}

test('B.ia preserva receita sem itens e margem parcial ponderada', async () => {
  const build = await builder();
  const plan = (await domain).resolveBiaPlan('Quais produtos têm margem em setembro?', '2026-10-02').plan;
  const result = build(plan, fixture(), null, '2026-10-02');
  assert.equal(result.metrics[0].value, 'R$ 1.100,00');
  assert.equal(result.metrics[2].value, '8,3%');
  assert.equal(result.table.rows.length, 3);
  assert.ok(result.table.rows.some(row => row[1].text === '3'));
  assert.ok(result.notices.some((notice) => notice.includes('80,00') && notice.includes('sem itens')));
  assert.ok(result.notices.some((notice) => notice.includes('pendente')));
});
test('ranking mantém vendas sem custo, com margem pendente', async () => {
  const build = await builder();
  const plan = (await domain).resolveBiaPlan('Top 10 produtos em setembro', '2026-10-02').plan;
  const result = build(plan, fixture(), null, '2026-10-02');
  const pending = result.table.rows.find((row) => row[1].text === '2');
  assert.equal(pending[4].text, 'Pendente');
  assert.equal(pending[5].text, 'Pendente');
  assert.equal(result.table.initialSort, 3);
});
test('SKU é exato e a resposta de um produto não apresenta a receita global como sendo dele', async () => {
  const build = await builder();
  const data = fixture();
  data.products.push({ ...data.products[0], sku: '10', product_name: 'Outro produto', revenue: 5000, units: 40 });
  const plan = (await domain).resolveBiaPlan('Faturamento do SKU 1 em setembro', '2026-10-02').plan;
  const result = build(plan, data, null, '2026-10-02');
  assert.equal(result.metrics[0].value, 'R$ 100,00');
  assert.equal(result.metrics[1].value, '2');
  assert.equal(result.table.rows.length, 1);
  assert.equal(result.table.rows[0][1].text, '1');
  assert.ok(result.text.includes('SKU 1'));
  assert.ok(!result.text.includes('1.100'));
  assert.ok(result.notices.some(n => n.includes('NFs') && n.includes('produto')));
});
test('produto ausente não ganha cards com números de outros produtos', async () => {
  const build = await builder();
  const plan = (await domain).resolveBiaPlan('Margem do SKU 999 em setembro', '2026-10-02').plan;
  const result = build(plan, fixture(), null, '2026-10-02');
  assert.equal(result.metrics.length, 0);
  assert.ok(result.text.includes('999'));
});
test('SKU sem custo mantém margem e resultado pendentes, com receita própria', async () => {
  const build = await builder();
  const plan = (await domain).resolveBiaPlan('Margem do SKU 2 em setembro', '2026-10-02').plan;
  const result = build(plan, fixture(), null, '2026-10-02');
  assert.equal(result.metrics[0].value, 'R$ 900,00');
  assert.equal(result.metrics[2].value, 'Pendente');
  assert.equal(result.metrics[3].value, 'Pendente');
});
test('comparação de SKU usa somente o mesmo SKU nos dois períodos', async () => {
  const build = await builder();
  const plan = (await domain).resolveBiaPlan('Compare faturamento do SKU 1 em setembro com agosto', '2026-10-02').plan;
  const previous = fixture();
  previous.processed_days = 31;
  previous.products[0].revenue = 50;
  previous.daily[0].revenue = 9999;
  const result = build(plan, fixture(), previous, '2026-10-02');
  assert.equal(result.metrics[0].value, 'R$ 100,00');
  assert.equal(result.metrics[1].value, 'R$ 50,00');
  assert.equal(result.metrics[2].value, 'R$ 50,00');
});
test('pergunta de quantidade responde unidades, sem chamar receita de quantidade', async () => {
  const build = await builder();
  const plan = (await domain).resolveBiaPlan('Quantas unidades vendemos em setembro?', '2026-10-02').plan;
  const result = build(plan, fixture(), null, '2026-10-02');
  assert.ok(result.text.includes('12 unidades'));
});
test('período ausente não produz faturamento zero nem comparação inventada', async () => {
  const build = await builder();
  const empty = { ...fixture(), products: [], daily: [], processed_days: 0, latest_refresh: null };
  const plan = (await domain).resolveBiaPlan('Quanto faturamos em setembro?', '2026-10-02').plan;
  assert.equal(build(plan, empty, null, '2026-10-02').metrics.length, 0);
  const compare = (await domain).resolveBiaPlan('Compare setembro com agosto', '2026-10-02').plan;
  const result = build(compare, fixture(), empty, '2026-10-02');
  assert.equal(result.metrics.length, 0);
  assert.ok(result.text.includes('não é faturamento zero'));
});
test('comparação divulga duração desigual e ausência de base percentual', async () => {
  const build = await builder();
  const plan = (await domain).resolveBiaPlan('Compare setembro com agosto', '2026-10-02').plan;
  const zero = { ...fixture(), products: [], daily: [], processed_days: 31 };
  const result = build(plan, fixture(), zero, '2026-10-02');
  assert.ok(result.text.includes('não há variação percentual'));
  assert.ok(result.notices.some((notice) => notice.includes('30 e 31 dias')));
});
test('endpoint exige sessão, aba B.ia e acesso à Análise Comercial', async () => {
  for (const [options, status] of [[{ anonymous: true }, 401], [{ chat: false }, 403], [{ data: false }, 200]]) {
    const api = await route(options);
    const response = await api.post({ questions: ['Quanto faturamos este mês?'] });
    assert.equal(response.status, status);
    assert.equal(api.calls.query, 0);
    assert.equal(api.calls.model, 0);
    if (options.data === false) assert.ok((await response.json()).text.includes('Análise Comercial'));
  }
});
test('pedido de alteração é recusado antes da IA e do banco', async () => {
  const api = await route();
  const response = await api.post({ questions: ['Altere o custo para R$ 20'] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, 'Juliano Calil, eu'+(await domain).BIA_READ_ONLY.slice(2));
  assert.equal(api.calls.model, 0);
  assert.equal(api.calls.query, 0);
});
test('devolução consulta sua fonte mesmo repetida ou depois de vendas; nunca mostra receita comercial', async () => {
  const variants = ['Olá, me traga um relatório de devoluções de ontem', 'Qual a quantidade de devolução?', 'Qual a quantidade de devoluções?', 'Quantas devoluções tivemos em setembro?', 'Total de reembolsos hoje?', 'Quantidade de estornos'];
  for (const question of variants) for (const questions of [[question], [question, question], ['Quanto faturamos em setembro?', question]]) {
    const api=await route({hint:{intent:'summary',order:'revenue'}});
    const reply=await (await api.post({questions})).json();
    assert.ok(reply.text.startsWith('Juliano Calil,'));
    assert.equal(reply.metrics[0].label,'Devoluções abertas');
    assert.equal(reply.metrics[0].value,'42');
    assert.ok(reply.source.href.startsWith('/devolucoes'));
    assert.equal(api.calls.query,0);
    assert.equal(api.calls.page,1);
  }
});
test('escopo não resolvido continua sem consultas quando o modelo sugeriria faturamento', async () => {
  const api = await route({ hint: { intent: 'summary', order: 'revenue' } });
  for (const question of ['Qual foi nosso desempenho?', 'Vendas da loja Acme em setembro', 'Qual indicador desconhecido?']) {
    const reply = await (await api.post({ questions: [question, question] })).json();
    assert.equal(reply.metrics, undefined);
    assert.equal(reply.source, undefined);
  }
  assert.equal(api.calls.query, 0);
  assert.equal(api.calls.model, 0);
});
test('endpoint rejeita SQL, operação, plano forjado e origem externa', async () => {
  const api = await route();
  for (const extra of [{ sql: 'delete from products' }, { operation: 'giracasa' }, { plan: { intent: 'summary' } }, { tool: 'refresh' }]) {
    assert.equal((await api.post({ questions: ['Quanto faturamos?'], ...extra })).status, 400);
  }
  assert.equal((await api.post({ questions: ['Quanto faturamos?'] }, { origin: 'https://evil.example' })).status, 403);
  assert.equal(api.calls.query, 0);
});
test('cada turno é validado e a resposta usa a consulta fixa', async () => {
  const api = await route({ hint: { intent: 'summary', order: 'revenue' } });
  const response = await api.post({ questions: ['Quanto faturamos na Shopee em setembro?', 'E a margem?'] });
  assert.equal(response.status, 200);
  assert.equal(api.calls.query, 1);
  assert.equal(api.calls.plan.intent, 'margin');
  assert.equal(api.calls.plan.channel, 'shopee');
  assert.equal(api.calls.plan.start, '2026-09-01');
  assert.equal((await response.json()).mode, 'local');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('falso positivo de escrita do modelo não recusa uma consulta válida de unidades', async () => {
  const api = await route({ hint: { intent: 'write' } });
  const response = await api.post({ questions: ['Quantas unidades do SKU 1 vendemos hoje?'] });
  const reply = await response.json();
  assert.equal(api.calls.query, 1);
  assert.equal(api.calls.plan.measure, 'units');
  assert.equal(api.calls.plan.search, '1');
  assert.ok(reply.text.includes('2 unidades'));
  assert.notEqual(reply.text, (await domain).BIA_READ_ONLY);
});
test('cliente de leitura exige JWT real mesmo em desenvolvimento e bloqueia outras chamadas', async () => {
  let network = 0;
  let config;
  const imports = {
    'server-only': {}, 'next/headers': { cookies: async () => ({ get: () => ({ value: 'user-jwt' }) }) },
    '@supabase/supabase-js': { createClient: (_, __, options) => { config = options; return {}; } },
    '@oraculo/domain/bia.js': await domain,
    '../auth/session': { ACCESS_COOKIE: 'access', getSupabaseAnonKey: () => 'anon', getSupabaseUrl: () => 'https://example.supabase.co' },
    '../supabase/operation-fetch': { operationFetch: () => async () => { network++; return new Response('{}'); } }
  };
  const reader = load('apps/web/lib/bia/read-client.ts', imports);
  await reader.createBiaReadClient(new AbortController().signal);
  await assert.rejects(config.global.fetch('https://example.supabase.co/rest/v1/olist_products', { method: 'PATCH' }));
  await assert.rejects(config.global.fetch('https://example.supabase.co/rest/v1/rpc/refresh_anything', { method: 'POST' }));
  assert.equal(network, 0);
  await config.global.fetch('https://example.supabase.co/rest/v1/rpc/oraculo_commercial_analysis', { method: 'POST' });
  assert.equal(network, 1);
  const noSession = load('apps/web/lib/bia/read-client.ts', { ...imports, 'next/headers': { cookies: async () => ({ get: () => undefined }) } });
  await assert.rejects(noSession.createBiaReadClient(new AbortController().signal), /BIA_SESSION_REQUIRED/);
});
test('contexto que dependeu de interpretação desconhecida pede pergunta completa', async () => {
  const api = await route({ hint: { intent: 'summary', order: 'revenue' } });
  const response = await api.post({ questions: ['Qual foi nosso desempenho?', 'E a margem?'] });
  assert.match((await response.json()).text, /repita a pergunta completa/i);
  assert.equal(api.calls.query, 0);
  assert.equal(api.calls.model, 0);
});
test('Ollama só classifica: entrada curta, sem ferramentas e fallback em resposta inválida', async () => {
  let sent;
  let answer = { intent: 'ranking', order: 'units', sql: 'delete from anything' };
  const interpreter = load('apps/web/lib/bia/ollama.ts', {
    'server-only': {}, '@oraculo/domain/bia.js': await domain,
    '../../app/documentacao/ask': { ollamaConfig: () => ({ enabled: true, url: 'https://local-model.example/ollama', model: 'qwen2.5-coder:7b', token: '' }) }
  }, { fetch: async (url, options) => { sent = { url, ...JSON.parse(options.body) }; return Response.json({ response: JSON.stringify(answer) }); } });
  const signal = new AbortController().signal;
  const result = await interpreter.interpretBia('Top produtos', signal);
  assert.equal(result.intent, 'ranking');
  assert.equal(result.sql, undefined);
  assert.equal(sent.url, 'https://local-model.example/ollama/api/generate');
  assert.equal(sent.options.num_predict, 64);
  assert.equal(sent.stream, false);
  assert.equal(sent.tools, undefined);
  answer = { intent: 'execute_sql', order: 'revenue' };
  assert.equal(await interpreter.interpretBia('Top produtos', signal), null);
  answer = null;
  assert.equal(await interpreter.interpretBia('Top produtos', signal), null);
});
test('consolidação por canal soma parcelas exclusivas, mantém margem e reutiliza cliente restrito', async () => {
  const calls = [];
  const client = {};
  const query = load('apps/web/lib/bia/queries.ts', {
    'server-only': {}, '@oraculo/domain/bia.js': await domain,
    './read-client': { createBiaReadClient: async () => client },
    '../../app/analise-comercial/data': { loadCommercialAnalysis: async (start, end, channel, supplied) => {
      calls.push({ channel, supplied });
      const part = fixture();
      part.channels = ['Shopee Jacartta', 'Shopee Donacor', 'Mercado Livre'];
      if (channel) { part.products = [part.products[0]]; part.daily = [{ day: start, invoices: 1, revenue: 100 }]; }
      return part;
    } }
  }).queryBia;
  const plan = (await domain).resolveBiaPlan('Vendas Shopee em setembro', '2026-10-02').plan;
  const result = await query(plan, new AbortController().signal);
  assert.equal(result.current.daily[0].revenue, 200);
  assert.equal(result.current.products[0].covered_profit, 40);
  assert.equal(result.current.products[0].units, 4);
  assert.equal(result.channels.length, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.supplied === client));
});
