import 'server-only';
import { BIA_SOURCES, biaSourceById, resolveBiaSources } from '@oraculo/domain/bia-sources.js';
import { commercialPeriod } from '@oraculo/domain/commercial-analysis.js';
import { extractBiaPeriods, normalizeBia } from '@oraculo/domain/bia.js';
import { canAccessRequest, isMaster } from '../auth/access';
import { isTabKey } from '../auth/tabs';
import { getRequestOperation } from '../operation-context';
import { readBiaPage, type PageEvidence } from './page-source';
import { rankSourceFacts, selectBiaEvidence } from './evidence-selection';
import type { BiaReply } from './types';

type User=NonNullable<Awaited<ReturnType<typeof import('../auth/session').getCurrentUser>>>;
const message=(text:string):BiaReply=>({text,mode:'verified'});
export async function answerBiaAcrossOraculo(request:Request,user:User,questions:string[],today:string,signal:AbortSignal):Promise<BiaReply|null> {
  const question=questions.at(-1)!;const text=normalizeBia(question);
  if(/^(oi|ola|bom dia|boa tarde|boa noite|ajuda|quem e voce|o que voce faz|como funciona)[!?.\s]*$/.test(text))return message('Sou a B.ia, sua assistente de dados do Oráculo. Posso consultar e explicar os setores liberados para você, indicando a tela de origem e os filtros. Meu acesso acompanha as permissões de Usuários. Apenas consulto; não altero dados.');
  if(/\b(quais|meus|meu)\b.*\b(acessos|permissoes|setores|dados liberados)\b/.test(text)){
    const tabs=[...new Set(BIA_SOURCES.map(s=>s.tab))];const permitted:string[]=[];
    for(const tab of tabs)if(isTabKey(tab)&&await canAccessRequest(user,tab))permitted.push(tab);
    const sources=BIA_SOURCES.filter(s=>permitted.includes(s.tab) && (s.id!=='usuarios'||isMaster(user)));
    return {...message('Posso consultar as fontes abaixo nesta operação. A autorização é conferida novamente em cada pergunta.'),actions:sources.map(s=>({label:s.label,href:s.path}))};
  }
  let previous:string[]=[];let priorRange:{start:string;end:string}|null=null;
  for(const old of questions.slice(0,-1)){
    const ids=resolveBiaSources(old,previous);
    if(ids.length)previous=ids;else if(!/^(oi|ola|ajuda)[!?.\s]*$/.test(normalizeBia(old)))previous=[];
    const period=extractBiaPeriods(normalizeBia(old),today);
    if(ids.length&&!period.error&&period.ranges?.length===1)priorRange=period.ranges[0];
  }
  const ids=resolveBiaSources(question,previous);
  if(!ids.length)return null;
  const sources=ids.map(id=>biaSourceById(id)!);
  // All gates precede every data read, including compound and follow-up requests.
  for(const source of sources)if(!isTabKey(source.tab)||(source.id==='usuarios'&&!isMaster(user))||!(await canAccessRequest(user,source.tab)))return message(`Os dados de ${source.label} não estão liberados para o seu usuário nesta operação. Solicite ao administrador a liberação dessa aba em Usuários para que eu possa consultar e explicar essas informações.`);
  if(ids.length>3)return message('Para manter a análise clara, consulte até três assuntos por pergunta. Informe os setores e os indicadores que deseja conferir.');
  // Preserve the mature structured commercial tool and its exact SKU arithmetic.
  if(ids.length===1&&ids[0]==='analise-comercial')return null;
  const periods=extractBiaPeriods(text,today);if(periods.error)return message(periods.error);
  if(periods.ranges&&periods.ranges.length>1)return message('Informe um período por consulta a esses setores. Para comparação, use a janela comparada mostrada na própria tela ou consulte cada período separadamente.');
  const explicit=periods.ranges?.[0];const range=explicit??(ids.join(',')===previous.join(',')?priorRange:null);
  if(range){const checked=commercialPeriod(range.start,range.end,today);if(checked.error)return message(checked.error);}
  if(/\b(exceto|excluindo|sem|acima de|abaixo de|maior que|menor que)\b/.test(text))return message('Esse filtro precisa ser aplicado na tela de origem para uma resposta segura. Informe um período ou consulte os indicadores gerais do setor; não vou descartar o filtro silenciosamente.');
  const family=/\bshopee\b/.test(text)?'shopee':/\bmercado livre\b/.test(text)?'mercadolivre':/\btiktok\b/.test(text)?'tiktok':'';
  const shop=text.match(/\b(donacor|jacartta|oliverhome|oliver|toca|gira casa|vari util)\b/)?.[0];
  if(shop)return message(`Para isolar a loja ${shop}, preciso do filtro específico da tela. Abra a fonte e selecione a loja; não vou substituir essa parcela por todo o canal.`);
  const operation=await getRequestOperation();const evidence:PageEvidence[]=[];
  for(const source of sources){
    if(range&&!source.dates)return {...message(`${source.label} usa a posição ou janela própria da tela e não oferece esse filtro de datas nesta consulta. Posso mostrar o estado disponível ou você pode conferir a janela na fonte.`),actions:[{label:`Conferir ${source.label}`,href:source.path}]};
    const params=new URLSearchParams();
    if(source.dates){const defaultEnd=source.id==='ads'?new Date(Date.parse(`${today}T12:00:00Z`)-86400000).toISOString().slice(0,10):today;const effective=range??{start:`${defaultEnd.slice(0,7)}-01`,end:defaultEnd};params.set(source.dates[0],effective.start);params.set(source.dates[1],effective.end);}
    if(family&&source.id==='devolucoes')params.set('canal',family);
    else if(family&&!['shopee','shopee-estoque','shopee-reposicao','shopee-precos','ads','reconciliacao','mercado-livre'].includes(source.id))return {...message(`Ainda não consigo aplicar o filtro de canal nessa leitura de ${source.label}. Selecione o canal na fonte; não vou responder com o total de todas as lojas.`),actions:[{label:`Conferir ${source.label}`,href:source.path}]};
    // A second live page request checks the same user's operation/permission.
    evidence.push(await readBiaPage(request,source.id,operation,params,signal,question));
  }
  const candidates=rankSourceFacts(question,evidence.flatMap(e=>e.facts));
  const selected=await selectBiaEvidence(question,candidates,signal);
  const facts=selected.facts;
  const notices=[...new Set(evidence.flatMap(e=>e.notices))];
  const causes=/\b(por que|porque|causa|motivo da queda)\b/.test(text);
  if(causes)notices.unshift('Esses dados mostram o que ocorreu. Para afirmar a causa, é preciso uma evidência específica; a consulta não prova causalidade.');
  const first=evidence[0];
  return {
    text:facts.length?`Consultei ${evidence.map(e=>e.label).join(' e ')} na sua operação. ${facts[0].kind==='metric'?`${facts[0].label}: ${facts[0].value}. `:''}${causes?'Separei os dados disponíveis para apoiar a análise.':'Estes são os dados disponíveis mais relacionados à sua pergunta.'}`:'A tela consultada não apresentou dados suficientes para responder esse recorte. Isso não significa que o valor seja zero.',
    mode:selected.local?'local':'verified',
    findings:facts.filter(f=>f.kind!=='metric').map(f=>({label:f.label,text:f.value})),
    metrics:facts.filter(f=>f.kind==='metric').map(f=>({label:f.label,value:f.value,caption:f.caption})),
    explanations:sources.map(s=>({label:s.label,text:s.explanation})),
    source:{label:first.label,href:first.href,period:first.filters.join(' · ')||'Janela e posição indicadas na tela de origem',channel:'Operação selecionada',updatedAt:null,links:evidence.map(e=>({label:`Conferir ${e.label}`,href:e.href}))},
    notices
  };
}
