import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import { DOMParser } from 'npm:linkedom@0.18.12';
import { runOrderTaxBatch } from '../_shared/order-tax-worker.js';

Deno.serve(async request=>{
 const secret=Deno.env.get('OLIST_SYNC_JOB_SECRET')??'';
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!secret||request.headers.get('x-sync-secret')!==secret)return new Response('Unauthorized',{status:401});
 try{
  const body=await request.json();if(!['uberlandia','giracasa'].includes(body.operation))return new Response('Invalid operation',{status:400});
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await runOrderTaxBatch({client,operation:body.operation,DOMParser,limit:Number(body.limit)||10,invoiceIds:body.invoiceIds??null});
  return Response.json(result);
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const code=/^[a-z_0-9]+$/.test(message)?message:'order_tax_sync_failed';
  return Response.json({error:code},{status:500});
 }
});
