// Uses the existing production login on localhost, with no mocked identity.
// Run next build first; keep ollama-ssh-local.py running separately.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const local = readFileSync(resolve(root, '.env'), 'utf8');
const settings = { ...process.env, NODE_ENV: 'production', OLLAMA_URL: 'http://127.0.0.1:11435',
  OLLAMA_MODEL: 'qwen2.5-coder:7b', OLLAMA_TOKEN: '' };
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) {
  const match = local.match(new RegExp(`^${key}=(.*)$`, 'm'));
  settings[key] ||= match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!settings[key]) throw new Error(`Configuração local ausente: ${key}`);
}
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', 'localhost', '--port', '3012'],
  { cwd: resolve(root, 'apps/web'), env: settings, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
