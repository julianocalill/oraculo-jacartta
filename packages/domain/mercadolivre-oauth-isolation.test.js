import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const ts=require('typescript');
const source=readFileSync(new URL('../../supabase/functions/mercadolivre-oauth-callback/index.ts',import.meta.url),'utf8');
async function callback(operation,{seller=1002,stateExists=true,expected='1002'}={}){
 const calls=[];let handler;
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-test',MERCADOLIVRE_APP_ID:'app',MERCADOLIVRE_CLIENT_SECRET:'test',MERCADOLIVRE_OAUTH_REDIRECT_URI:'https://example.supabase.co/functions/v1/mercadolivre-oauth-callback',MERCADOLIVRE_EXPECTED_SELLER_ID:operation==='giracasa'?expected:''};
 const client={from(table){
  const q={update(value){calls.push({table,action:'update',value});return q;},insert(){return q;},select(){return q;},eq(){return Promise.resolve({error:null});},is(){return q;},gt(){return q;},
   limit(){return Promise.resolve({data:stateExists?[{code_verifier:'pkce',redirect_uri:env.MERCADOLIVRE_OAUTH_REDIRECT_URI}]:[],error:null});},
   single(){return Promise.resolve({data:{id:1},error:null});},upsert(value){calls.push({table,action:'upsert',seller:value.seller_id});return Promise.resolve({error:null});},delete(){return q;},lt(){return Promise.resolve({error:null});}};
  if(table==='mercadolivre_oauth_states')q.eq=()=>q;
  return q;
 }};
 let code=source.replace(/^import .*;\n/m,'').replace('const CALLBACK_OPERATION: string = "uberlandia";',`const CALLBACK_OPERATION: string = "${operation}";`);
 code=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 vm.runInNewContext(code,{Response,URL,URLSearchParams,Date,Number,String,Error,console:{error(){}},Deno:{env:{get:k=>env[k]},serve:f=>{handler=f;}},createClient:()=>client,
  fetch:async url=>{calls.push({url});return new Response(JSON.stringify(url.endsWith('/oauth/token')?{access_token:'test',refresh_token:'test',user_id:seller,expires_in:3600}:{id:seller,nickname:'test',site_id:'MLB'}),{status:200});}});
 return {calls,run:state=>handler(new Request('https://example.supabase.co/functions/v1/callback?code=code&state='+encodeURIComponent(state)))};
}
test('root callback routes Gira state to fixed isolated endpoint without consuming or exchanging it',async()=>{
 const c=await callback('uberlandia');const r=await c.run('giracasa.random');assert.equal(r.status,303);
 const target=new URL(r.headers.get('location'));assert.equal(target.pathname,'/functions/v1/giracasa-mercadolivre-oauth-callback');assert.equal(target.searchParams.get('state'),'giracasa.random');assert.equal(c.calls.length,0);
});
test('Gira callback rejects wrong operation and expired state before any token exchange',async()=>{
 const c=await callback('giracasa');assert.equal((await c.run('legacy-state')).status,400);assert.equal(c.calls.length,0);
 const expired=await callback('giracasa',{stateExists:false});assert.equal((await expired.run('giracasa.expired')).status,401);assert.ok(!expired.calls.some(c=>c.url));
});
test('Gira callback never stores credentials of another seller',async()=>{
 const c=await callback('giracasa',{seller:1001});assert.equal((await c.run('giracasa.valid')).status,403);
 assert.ok(!c.calls.some(c=>c.action==='upsert'));assert.ok(c.calls.some(c=>c.value?.error_message==='seller_scope_mismatch'));
});
test('correct Gira seller is validated and stored; root legacy callback remains functional',async()=>{
 for(const [op,seller,state] of [['giracasa',1002,'giracasa.valid'],['uberlandia',1001,'legacy-valid']]){
  const c=await callback(op,{seller});assert.equal((await c.run(state)).status,200);
  assert.deepEqual(c.calls.filter(c=>c.action==='upsert').map(c=>[c.table,c.seller]),[['mercadolivre_accounts',seller],['mercadolivre_tokens',seller]]);
 }
});
test('Gira callback fails closed when expected seller configuration is absent',async()=>{
 const c=await callback('giracasa',{expected:''});assert.equal((await c.run('giracasa.valid')).status,500);assert.equal(c.calls.length,0);
});
