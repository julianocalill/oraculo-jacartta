import { getCurrentUser } from '../../../../lib/auth/session';
import { canAccessRequest } from '../../../../lib/auth/access';
import { parseOrderTaxFilters,orderTaxCsv } from '@oraculo/domain/tax-ledger.js';
import { loadOrderTaxPage,type TaxRow } from '../data';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await getCurrentUser();if(!user)return new Response('Autenticação necessária',{status:401});if(!await canAccessRequest(user,'pedidos'))return new Response('Sem acesso',{status:403});
 try{
  const params=Object.fromEntries(new URL(request.url).searchParams);const filters=parseOrderTaxFilters({...params,page:'1'});
  const first=await loadOrderTaxPage(filters,500);if(first.totalOrders>5000)return new Response('Selecione um filtro com até 5.000 pedidos para exportar.',{status:413});
  const rows:TaxRow[]=[...first.rows];for(let page=2;rows.length<first.totalOrders;page++){
   const next=await loadOrderTaxPage({...filters,page},500);if(!next.rows.length)throw new Error('A coleta mudou durante a exportação. Consulte novamente.');rows.push(...next.rows);
  }
  return new Response(orderTaxCsv(rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="impostos-pedidos-${filters.start}-${filters.end}.csv"`,'Cache-Control':'private, no-store'}});
 }catch(error){return new Response(error instanceof Error?error.message:'Não foi possível exportar.',{status:400});}
}
