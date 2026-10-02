import 'server-only';
import { parseHTML } from 'linkedom';
import { operationHref } from '@oraculo/domain/operations.js';
import { biaSourceById } from '@oraculo/domain/bia-sources.js';
import { normalizeBia } from '@oraculo/domain/bia.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/session';

export type SourceFact = { id: string; kind: 'metric' | 'row' | 'note'; label: string; value: string; caption?: string };
export type PageEvidence = { sourceId: string; label: string; href: string; facts: SourceFact[]; notices: string[]; filters: string[] };
const clean = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g,' ').trim();

export function extractPageEvidence(html: string, sourceId: string, href: string, question: string): PageEvidence {
  const source = biaSourceById(sourceId);
  if (!source) throw new Error('BIA_SOURCE_INVALID');
  const { document } = parseHTML(html);
  // Do not read Next RSC payloads, navigation, credentials, actions or hidden DOM.
  const root = document.querySelector('main.workspace');
  if (!root) throw new Error('BIA_SOURCE_UNAVAILABLE');
  root.querySelectorAll('script,style,template,svg,iframe,noscript,[hidden],[aria-hidden="true"],.sr-only,.chart-tip,.bia-dock,input[type="hidden"],input[type="password"],input[type="file"]').forEach(el => el.remove());
  if (/acesso negado|acesso nao liberado|sem acesso|voce nao tem acesso a esta aba|voce nao tem acesso a aba/i.test(normalizeBia(root.textContent ?? ''))) throw new Error('BIA_SOURCE_DENIED');
  const failures = [...root.querySelectorAll('[role="alert"],.full-error,.error,.warning,p')];
  if (failures.some(el => /nao foi possivel carregar|falha ao carregar|dados indisponiveis|erro ao consultar/i.test(normalizeBia(el.textContent ?? '')))) throw new Error('BIA_SOURCE_UNAVAILABLE');
  const filters: string[] = [];
  const settings: Array<Omit<SourceFact, 'id'>> = [];
  if (sourceId === 'parametros') root.querySelectorAll('form label').forEach(label => {
    const input = label.querySelector('input[type="number"]');
    const value = input?.getAttribute('value');
    const title = clean(label.querySelector('span')?.textContent ?? label.textContent);
    if (title && value && /^-?\d+(\.\d+)?$/.test(value)) settings.push({kind:'row',label:title,value,caption:'Valor configurado na tela Parâmetros.'});
  });
  root.querySelectorAll('form label').forEach(label => {
    if ((label.closest('form')?.getAttribute('method') ?? 'get').toLowerCase() !== 'get') return;
    const input = label.querySelector('input:not([type="checkbox"]):not([type="radio"]),select');
    if (!input || /token|senha|password|secret|cnpj|cpf|email|endereco/i.test(input.getAttribute('name') ?? '')) return;
    const value = input.tagName === 'SELECT' ? input.querySelector('option[selected]')?.textContent : input.getAttribute('value');
    if (value) filters.push(`${clean(label.querySelector('span')?.textContent ?? label.textContent)}: ${clean(value)}`.slice(0,240));
  });
  // Forms may contain public read tables; strip only interactive controls.
  root.querySelectorAll('input,select,textarea,form button,form nav').forEach(el => el.remove());
  const facts: SourceFact[] = [];
  const add = (fact: Omit<SourceFact,'id'>) => {
    if (!fact.value || facts.some(f => f.kind === fact.kind && f.label === fact.label && f.value === fact.value)) return;
    if (facts.length < 150) facts.push({ ...fact, id: `${sourceId}:${facts.length}` });
  };
  settings.forEach(add);
  root.querySelectorAll('.metric').forEach(el => {
    const value = clean(el.querySelector('strong')?.textContent);
    const label = clean(el.querySelector('.label,span,h2,h3')?.textContent);
    if (label && value) add({ kind:'metric',label,value,caption:clean(el.querySelector('small')?.textContent) });
  });
  const sku = normalizeBia(question).match(/\bsku\s*[:#]?\s*([a-z0-9_-]+)\b/)?.[1];
  let omittedRows = 0;
  root.querySelectorAll('table').forEach(table => {
    const columns = [...table.querySelectorAll('thead th')].map(el=>clean(el.textContent));
    const title = clean(table.closest('section')?.querySelector('h2,h3')?.textContent) || source.label;
    const rows = [...table.querySelectorAll('tbody tr')];
    let selected = 0;
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')].map(el=>clean(el.textContent));
      if (!cells.length) continue;
      if (sku && !cells.some(cell=>normalizeBia(cell)===sku)) continue;
      if (selected++ >= 30) { omittedRows++; continue; }
      add({kind:'row',label:title,value:cells.map((cell,index)=>`${columns[index] || `Campo ${index+1}`}: ${cell}`).join(' · ').slice(0,2200)});
    }
  });
  const notices: string[] = [];
  root.querySelectorAll('[role="alert"],.fiscal-note,.commercial-warning,.full-error,.notice,.warning').forEach(el=> {
    const text=clean(el.textContent);if(text && text.length<2400) notices.push(text);
  });
  root.querySelectorAll('p,summary,h1,h2,h3').forEach(el => {
    if (el.closest('table,.metric,form')) return;
    const text = clean(el.textContent);
    if (text.length >= 12 && text.length <= 1200) add({kind:'note',label:source.label,value:text});
  });
  if (sku) {
    // Page-wide cards never describe a single SKU. Only matched rows are safe.
    const rows=facts.filter(f=>f.kind==='row');
    facts.splice(0,facts.length,...rows);
    notices.push('Busca por SKU: os cards globais foram excluídos da resposta. As linhas disponíveis podem ser um ranking ou uma página, não o catálogo inteiro.');
  }
  if (omittedRows || facts.length===150) notices.push('A resposta usa um recorte das linhas exibidas. Não some essas linhas para inferir o total da operação.');
  notices.push('Valores reproduzidos da tela de origem. Listas podem ser paginadas ou limitadas; ausência de uma linha não comprova ausência de registros.');
  return {sourceId,label:source.label,href,facts,notices:[...new Set(notices)],filters:[...new Set(filters)]};
}

export function assertBiaPageRequest(url: string, origin: string, operation: string, sourceId: string) {
  const source=biaSourceById(sourceId); const target=new URL(url);
  const keys=new Set([...(source?.dates??[]),...(sourceId==='devolucoes'?['canal']:[])]);
  if([...target.searchParams.keys()].some(key=>!keys.has(key)))throw new Error('BIA_SOURCE_INVALID');
  if (!source || target.origin!==origin || target.pathname!==operationHref(source.path,operation) || target.username || target.password) throw new Error('BIA_SOURCE_INVALID');
}

export function biaInternalOrigin(requestUrl: string): string {
  const origin=new URL(requestUrl).origin;
  const approved=new Set(['https://oraculo.oliverhome.com.br','https://oraculo-jacartta-web.vercel.app', ...[process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host=>`https://${host}`)]);
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) && !process.env.VERCEL) return origin;
  if (!approved.has(origin)) throw new Error('BIA_SOURCE_ORIGIN');
  return origin;
}

export async function readBiaPage(request: Request, sourceId: string, operation: string, params: URLSearchParams, signal: AbortSignal, question: string) {
  const source=biaSourceById(sourceId); if(!source) throw new Error('BIA_SOURCE_INVALID');
  const origin=biaInternalOrigin(request.url);
  const href=`${source.path}${params.size ? `?${params}`:''}`;
  const target=new URL(operationHref(href,operation),origin);
  assertBiaPageRequest(target.href,origin,operation,sourceId);
  const cookies=(request.headers.get('cookie') ?? '').split(';').map(part=>part.trim()).filter(part=>[ACCESS_COOKIE,REFRESH_COOKIE,'oraculo_session_window','oraculo_theme'].includes(part.split('=')[0])).join('; ');
  if(!cookies.split(';').some(part=>part.trim().startsWith(`${ACCESS_COOKIE}=`))) throw new Error('BIA_SESSION_REQUIRED');
  // Only an authenticated GET to one audited render route. No actions, exports,
  // redirects, arbitrary destinations, shared cache or browser script execution.
  const response=await fetch(target,{method:'GET',headers:{Cookie:cookies,Accept:'text/html'},cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(25_000)])});
  if(!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('BIA_SOURCE_UNAVAILABLE');
  const reader=response.body?.getReader();if(!reader) throw new Error('BIA_SOURCE_UNAVAILABLE');
  let html='';let bytes=0;const decoder=new TextDecoder();
  try { while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>6_000_000)throw new Error('BIA_SOURCE_TOO_LARGE');html+=decoder.decode(next.value,{stream:true});}html+=decoder.decode(); }
  finally { await reader.cancel(); }
  return extractPageEvidence(html,sourceId,href,question);
}
