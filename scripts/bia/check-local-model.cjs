// Live smoke check of the actual classifier using the temporary SSH bridge.
// Synthetic question only; no JWT, database values or credentials.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '../../apps/web')] }));

(async () => {
  const domain = await import('../../packages/domain/bia.js');
  const filename = path.join(__dirname, '../../apps/web/lib/bia/ollama.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  const imports = { 'server-only': {}, '@oraculo/domain/bia.js': domain,
    '../../app/documentacao/ask': { ollamaConfig: () => ({ enabled: true,
      url: 'http://127.0.0.1:11435', model: 'qwen2.5-coder:7b', token: '' }) } };
  vm.runInNewContext(output, { module, exports: module.exports,
    require: (name) => { if (!(name in imports)) throw new Error('Import inesperado'); return imports[name]; },
    fetch, AbortSignal, Buffer, JSON }, { filename });
  const started = Date.now();
  const result = await module.exports.interpretBia('Quanto faturamos este mês?', new AbortController().signal);
  console.log(JSON.stringify({ intent: result?.intent ?? null, order: result?.order ?? null,
    elapsed_seconds: (Date.now() - started) / 1000, passed: result?.intent === 'summary' }));
  if (result?.intent !== 'summary') process.exitCode = 1;
})().catch(() => { console.error('Teste do classificador indisponível.'); process.exitCode = 1; });
