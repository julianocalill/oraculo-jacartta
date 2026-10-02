import { biaRequestsWrite, BIA_HELP, BIA_READ_ONLY, resolveBiaPlan } from '@oraculo/domain/bia.js';
import { canAccessRequest } from '../../../lib/auth/access';
import { getCurrentUser } from '../../../lib/auth/session';
import { getSaoPauloToday } from '../../../lib/date';
import { buildBiaAnswer } from '../../../lib/bia/answer';
import { interpretBia } from '../../../lib/bia/ollama';
import { queryBia } from '../../../lib/bia/queries';
import type { BiaPlan, BiaReply } from '../../../lib/bia/types';
import { getRequestOperation } from '../../../lib/operation-context';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const active = new Set<string>();
const requests = new Map<string, { start: number; count: number }>();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });
const message = (text: string): BiaReply => ({ text, mode: 'verified' });

export async function POST(request: Request) {
  // Scoped route (/o/<operation>/bia/responder), covered by the middleware.
  // Never accept operation, SQL, tool names or previous results from the body.
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Sua sessão expirou. Entre novamente para conversar com a B.ia.' }, 401);
  if (!(await canAccessRequest(user, 'bia'))) return json({ error: 'Sem acesso à B.ia nesta operação.' }, 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origem da solicitação inválida.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Envie uma pergunta em JSON.' }, 415);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 8_000) return json({ error: 'A conversa enviada é muito longa. Comece uma nova conversa.' }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: 'Não foi possível ler sua pergunta.' }, 400); }
  if (!body || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'questions')) return json({ error: 'Envie apenas as perguntas da conversa.' }, 400);
  const questions = (body as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 8 || questions.some((question) => typeof question !== 'string' || !question.trim() || question.length > 700)) return json({ error: 'Envie de uma a oito perguntas, com até 700 caracteres cada.' }, 400);
  const question = String(questions.at(-1)).trim();
  if (biaRequestsWrite(question)) return json(message(BIA_READ_ONLY));
  // The chat grant never widens underlying data permissions.
  if (!(await canAccessRequest(user, 'analise-comercial'))) return json(message('Para consultar faturamento, produtos e margem, seu acesso à Análise Comercial também precisa estar liberado nesta operação.'));
  const today = getSaoPauloToday();
  let previous: BiaPlan | null = null;
  let unresolvedContext = false;
  // Recompute from user text, without trusting client-supplied plans/history.
  for (const old of questions.slice(0, -1)) {
    const resolved = resolveBiaPlan(String(old), today, previous);
    if (resolved.kind === 'query') { previous = resolved.plan; unresolvedContext = false; }
    else if (resolved.message === BIA_HELP && !/^(oi|ol[aá]|bom dia|boa tarde|boa noite|ajuda)[!?.\s]*$/i.test(String(old).trim())) { previous = null; unresolvedContext = true; }
  }
  if (unresolvedContext && /^(e\b|compare\b|comparar\b|agora\b|ness[ea]\b|dest[ea]\b|deles\b|delas\b|somente\b|apenas\b|na\b|no\b|em\b)/i.test(question)) return json(message('Repita a pergunta completa com o período e a loja. Não consegui recuperar com segurança os filtros da pergunta anterior.'));
  let resolved = resolveBiaPlan(question, today, previous);
  // Requests already identified as unsafe/outside scope never reach the LLM.
  if (resolved.kind === 'message' && resolved.message !== BIA_HELP) return json(message(resolved.message));
  const operation = await getRequestOperation();
  const key = `${user.id}:${operation}`;
  const now = Date.now();
  for (const [entry, value] of requests) if (now - value.start >= 60_000) requests.delete(entry);
  const rate = requests.get(key) ?? { start: now, count: 0 };
  if (active.has(key) || rate.count >= 6) return json({ error: 'Aguarde a resposta atual ou tente novamente em um minuto.' }, 429);
  rate.count++;
  requests.set(key, rate);
  active.add(key);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    const hint = await interpretBia(question, signal);
    if (hint?.intent === 'write') return json(message(BIA_READ_ONLY));
    resolved = resolveBiaPlan(question, today, previous, hint);
    if (resolved.kind === 'message') return json(message(resolved.message));
    if (signal.aborted) return json({ error: 'Consulta cancelada.' }, 499);
    // Recheck grants immediately before touching the data, on every turn.
    if (!(await canAccessRequest(user, 'analise-comercial'))) return json({ error: 'Sem acesso à Análise Comercial.' }, 403);
    const result = await queryBia(resolved.plan, signal);
    if ('message' in result) return json(message(result.message ?? 'Consulta indisponível.'));
    const reply = buildBiaAnswer(resolved.plan, result.current, result.previous, today);
    reply.mode = hint ? 'local' : 'verified';
    if (reply.source && result.channels.length) {
      reply.source.channel = result.channels.join(' · ');
      const filters = new URLSearchParams({ start: resolved.plan.start, end: resolved.plan.end, ...(resolved.plan.search ? { q: resolved.plan.search } : {}) });
      if (result.channels.length === 1) filters.set('canal', result.channels[0]);
      reply.source.href = `/analise-comercial?${filters}`;
      if (result.channels.length > 1) {
        reply.source.links = result.channels.map((channel) => {
          const individual = new URLSearchParams(filters); individual.set('canal', channel);
          return { label: channel, href: `/analise-comercial?${individual}` };
        });
        reply.notices?.push(`Filtro consolidado: ${result.channels.join(', ')}. Os links da fonte mostram cada parcela individualmente.`);
      }
    }
    return json(reply);
  } catch (error) {
    if (error instanceof Error && error.message === 'BIA_SESSION_REQUIRED') return json({ error: 'Entre com uma sessão real para consultar dados. A B.ia não usa credenciais administrativas, mesmo em desenvolvimento.' }, 401);
    console.error('[bia] consulta indisponível');
    return json({ error: 'Não consegui consultar os dados agora. Tente novamente em instantes; nenhum dado foi alterado.' }, 503);
  } finally { active.delete(key); }
}
