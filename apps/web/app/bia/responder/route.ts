import { biaRequestsWrite, BIA_READ_ONLY, resolveBiaPlan } from '@oraculo/domain/bia.js';
import { biaUserName } from '@oraculo/domain/bia-sources.js';
import { canAccessRequest } from '../../../lib/auth/access';
import { getCurrentUser } from '../../../lib/auth/session';
import { getSaoPauloToday } from '../../../lib/date';
import { buildBiaAnswer } from '../../../lib/bia/answer';
import { interpretBia } from '../../../lib/bia/ollama';
import { queryBia } from '../../../lib/bia/queries';
import { answerBiaAcrossOraculo } from '../../../lib/bia/oraculo';
import type { BiaPlan, BiaReply } from '../../../lib/bia/types';
import { getRequestOperation } from '../../../lib/operation-context';

export const dynamic='force-dynamic';
export const maxDuration=60;
const active=new Set<string>();
const requests=new Map<string,{start:number;count:number}>();
const responseJson=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user)return responseJson({error:'Sua sessão expirou. Entre novamente para conversar com a B.ia.'},401);
  const name=biaUserName(user);
  const json=(value: BiaReply|{error:string},status=200)=>responseJson({...value,...('text' in value?{text:`${name}, ${value.text.charAt(0).toLocaleLowerCase('pt-BR')}${value.text.slice(1)}`}:{error:`${name}, ${value.error.charAt(0).toLocaleLowerCase('pt-BR')}${value.error.slice(1)}`})},status);
  const message=(text:string):BiaReply=>({text,mode:'verified'});
  if(!(await canAccessRequest(user,'bia')))return json({error:'Seu acesso à B.ia não está liberado nesta operação.'},403);
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Origem da solicitação inválida.'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Envie uma pergunta em JSON.'},415);
  let body:unknown;
  try{const raw=await request.text();if(raw.length>8_000)return json({error:'A conversa enviada é muito longa. Comece uma nova conversa.'},413);body=JSON.parse(raw);}
  catch{return json({error:'Não foi possível ler sua pergunta.'},400);}
  if(!body||typeof body!=='object'||Object.keys(body).some(key=>key!=='questions'))return json({error:'Envie apenas as perguntas da conversa.'},400);
  const questions=(body as {questions?:unknown}).questions;
  if(!Array.isArray(questions)||questions.length<1||questions.length>8||questions.some(q=>typeof q!=='string'||!q.trim()||q.length>700))return json({error:'Envie de uma a oito perguntas, com até 700 caracteres cada.'},400);
  const question=String(questions.at(-1)).trim();
  if(biaRequestsWrite(question))return json(message(BIA_READ_ONLY));
  const operation=await getRequestOperation();const key=`${user.id}:${operation}`;const now=Date.now();
  for(const [entry,value]of requests)if(now-value.start>=60_000)requests.delete(entry);
  const rate=requests.get(key)??{start:now,count:0};
  if(active.has(key)||rate.count>=6)return json({error:'Aguarde a resposta atual ou tente novamente em um minuto.'},429);
  rate.count++;requests.set(key,rate);active.add(key);
  try{
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(45_000)]);const today=getSaoPauloToday();
    const across=await answerBiaAcrossOraculo(request,user,questions,today,signal);
    if(across)return json(across);
    // The commercial recipe keeps its separate source permission and client.
    if(!(await canAccessRequest(user,'analise-comercial')))return json(message('Os dados de Análise Comercial não estão liberados para o seu usuário nesta operação. Solicite essa liberação ao administrador em Usuários.'));
    let previous:BiaPlan|null=null;let unresolvedContext=false;
    for(const old of questions.slice(0,-1)){
      const resolved=resolveBiaPlan(String(old),today,previous);
      if(resolved.kind==='query'){previous=resolved.plan;unresolvedContext=false;}
      else if(!/^(oi|ol[aá]|bom dia|boa tarde|boa noite|ajuda)[!?.\s]*$/i.test(String(old).trim())){previous=null;unresolvedContext=true;}
    }
    let resolved=resolveBiaPlan(question,today,previous);
    if(resolved.kind==='message')return json(message(resolved.message));
    if(unresolvedContext&&/^(e\b|compare\b|comparar\b|agora\b|ness[ea]\b|dest[ea]\b|deles\b|delas\b|somente\b|apenas\b|na\b|no\b|em\b)/i.test(question))return json(message('Repita a pergunta completa com o período e a loja. Não consegui recuperar com segurança os filtros anteriores.'));
    const hint=await interpretBia(question,signal);
    resolved=resolveBiaPlan(question,today,previous,hint);
    if(resolved.kind==='message')return json(message(resolved.message));
    if(signal.aborted)return json({error:'Consulta cancelada.'},499);
    if(!(await canAccessRequest(user,'analise-comercial')))return json({error:'Os dados de Análise Comercial não estão liberados.'},403);
    const result=await queryBia(resolved.plan,signal);
    if('message' in result)return json(message(result.message??'Consulta indisponível.'));
    const reply=buildBiaAnswer(resolved.plan,result.current,result.previous,today);reply.mode=hint?'local':'verified';
    reply.explanations=[{label:'Como interpretar',text:'Faturamento vem das NFs válidas emitidas no período. Unidades correspondem aos itens disponíveis. Margem considera somente a receita com custo e comissão calculáveis; não é lucro líquido total.'}];
    if(reply.source&&result.channels.length){
      reply.source.channel=result.channels.join(' · ');
      const filters=new URLSearchParams({start:resolved.plan.start,end:resolved.plan.end,...(resolved.plan.search?{q:resolved.plan.search}:{})});
      if(result.channels.length===1)filters.set('canal',result.channels[0]);
      reply.source.href=`/analise-comercial?${filters}`;
      if(result.channels.length>1){reply.source.links=result.channels.map(channel=>{const individual=new URLSearchParams(filters);individual.set('canal',channel);return{label:channel,href:`/analise-comercial?${individual}`};});reply.notices?.push(`Filtro consolidado: ${result.channels.join(', ')}. Os links da fonte mostram cada parcela individualmente.`);}
    }
    return json(reply);
  }catch(error){
    if(error instanceof Error&&error.message==='BIA_SESSION_REQUIRED')return json({error:'Entre com uma sessão real para consultar dados. A B.ia não usa o login de demonstração para ler informações.'},401);
    if(error instanceof Error&&error.message==='BIA_SOURCE_DENIED')return json(message('Os dados dessa fonte não estão liberados para o seu usuário nesta operação. Solicite a liberação ao administrador em Usuários.'));
    console.error('[bia] consulta indisponível');
    return json({error:'Não consegui confirmar os dados da fonte agora. Tente novamente em instantes; nenhum dado foi alterado.'},503);
  }finally{active.delete(key);}
}
